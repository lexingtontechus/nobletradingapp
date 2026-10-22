// =============================================================================
// Noble Trading App — Helio Subscription Reconciliation Edge Function
// =============================================================================
// Polls Helio's subscription list API for every active paylink and reconciles
// the data into the MODERN subscription tables:
//   - identifies the local user by email (users.email) and by the Discord
//     identity Helio captured at checkout (discordUser.id/username)
//   - updates/creates `subscriptions` rows (status active/expired,
//     current_period_start/end, grace_period_end, helio_* identity fields)
//   - inserts missing `payment_transactions` (deduped on helio_transaction_id)
//   - appends `subscription_events` (SYNC_STARTED / SYNC_RENEWED / SYNC_EXPIRED)
//   - syncs Clerk publicMetadata so the portal badge flips
//
// Why this exists (2026-08-09):
//   The Helio webhook is not robust — deliveries fail silently (Make.com
//   target, token mismatches) and, for subscription events, the payload does
//   NOT carry enough identity to reliably map to a local user. The
//   subscription list API DOES: it returns email + discordUser per
//   subscription, plus the full transaction history. This poller is the
//   backstop that reconciles whatever the webhook missed.
//
// Scheduling: pg_cron (see supabase/migrations/0007_helio_subscription_sync.sql)
//   every 15 minutes. Invoked with X-Internal-Secret or X-Supabase-Cron.
//
// Env required:
//   SUPABASE_URL, SUPABASE_SECRET_KEYS,
//   HELIO_API_KEY, HELIO_API_TOKEN, HELIO_API_BASE_URL (api.hel.io | api.dev.hel.io)
//   CLERK_SECRET_KEY (for metadata sync; missing -> skip sync)
//   INTERNAL_FUNCTION_SECRET (optional auth gate)
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

// -----------------------------------------------------------------------------
// Env
// -----------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
// Supabase's new secret key env var is a JSON object keyed by key name
const SUPABASE_SECRET_KEYS = JSON.parse(
  Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"
);
const SUPABASE_KEY =
  (SUPABASE_SECRET_KEYS.kairos ?? Object.values(SUPABASE_SECRET_KEYS)[0]) ?? "";
// Defensive env resolution: the project secrets expose several name variants
// (HELIO_API_KEY/DEV, HELIO_APIKEY, HELIO_API_BASE vs HELIO_API_BASE_URL).
// Prefer the devnet variants when present so test paylinks hit api.dev.hel.io.
const HELIO_API_KEY =
  Deno.env.get("HELIO_API_KEY") ??
  Deno.env.get("HELIO_API_KEY_DEV") ??
  Deno.env.get("HELIO_APIKEY") ??
  "";
const HELIO_API_TOKEN =
  Deno.env.get("HELIO_API_TOKEN") ??
  Deno.env.get("HELIO_API_TOKEN_DEV") ??
  Deno.env.get("HELIO_TOKEN_DEV") ??
  Deno.env.get("HELIO_TOKEN") ??
  "";
const HELIO_API_BASE_RAW =
  Deno.env.get("HELIO_API_BASE_URL") ??
  Deno.env.get("HELIO_API_BASE_DEV") ??
  Deno.env.get("HELIO_API_BASE") ??
  "https://api.hel.io";
// Normalize: strip inline comments, trailing whitespace, and a trailing /v1
// (project secrets historically stored "https://api.dev.hel.io/v1 #comment").
const HELIO_API_BASE = HELIO_API_BASE_RAW
  .split("#")[0]
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/v1$/, "");
const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
const SUPABASE_FUNCTIONS_BASE =
  SUPABASE_URL + "/functions/v1/redis-credentials-manager";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// -----------------------------------------------------------------------------
// Auth gate — accept internal secret OR Supabase cron UA (like the sweep fn)
// -----------------------------------------------------------------------------
function authorized(req: Request): boolean {
  // pg_cron path (0007 migration sends X-Supabase-Cron; pg_net UA fallback)
  const ua = req.headers.get("user-agent") ?? "";
  const cron = req.headers.get("x-supabase-cron") ?? "";
  if (ua.includes("pg_net") || cron === "true") return true;
  // Internal service-to-service calls (webhook -> this fn, manual replay)
  if (INTERNAL_SECRET && req.headers.get("x-internal-secret") === INTERNAL_SECRET) {
    return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Date helpers (mirror helio-webhook)
// -----------------------------------------------------------------------------
function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86400000).toISOString();
}

function minimalToCents(amountMinimal: string, decimals: number): number {
  try {
    const minimal = BigInt(amountMinimal);
    const cents = Number(minimal) / Math.pow(10, decimals) * 100;
    return Math.round(cents);
  } catch {
    return 0;
  }
}

function deriveTokenDecimals(symbol: string): number {
  switch (symbol.toUpperCase()) {
    case "USDC": case "USDT": return 6;
    case "SOL": return 9;
    case "ETH": return 18;
    case "BTC": return 8;
    default: return 6;
  }
}

// -----------------------------------------------------------------------------
// Sync Clerk publicMetadata (best-effort, mirrors helio-webhook)
// -----------------------------------------------------------------------------
async function syncClerkMetadata(input: {
  clerkUserId: string;
  subscriptionStatus: string;
  planTitle: string;
  discordId?: string;
  role?: string;
}): Promise<void> {
  if (!CLERK_SECRET_KEY) return;
  try {
    const publicMetadata: Record<string, unknown> = {
      subscriptionStatus: input.subscriptionStatus,
      plan: input.planTitle,
    };
    if (input.discordId) publicMetadata.discordId = input.discordId;
    if (input.role) publicMetadata.role = input.role;
    const resp = await fetch(`https://api.clerk.com/v1/users/${input.clerkUserId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ public_metadata: publicMetadata }),
    });
    if (!resp.ok) {
      console.error(`Clerk metadata sync ${resp.status}: ${await resp.text()}`);
    }
  } catch (e) {
    console.error("Clerk metadata sync error:", e);
  }
}

// -----------------------------------------------------------------------------
// Provision Redis credentials (best-effort, mirrors helio-webhook)
// -----------------------------------------------------------------------------
async function provisionRedis(input: {
  subscriptionId: string;
  userId: string;
  planId: string;
}): Promise<void> {
  if (!INTERNAL_SECRET) return;
  try {
    const resp = await fetch(SUPABASE_FUNCTIONS_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ action: "provision", ...input }),
    });
    if (!resp.ok) {
      console.error(`redis provision ${resp.status}: ${await resp.text()}`);
    }
  } catch (e) {
    console.error("redis provision error:", e);
  }
}

// -----------------------------------------------------------------------------
// Main reconcile
// -----------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const summary = {
    plans: 0,
    subscriptionsSeen: 0,
    matchedUsers: 0,
    unknownUsers: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    transactionsInserted: 0,
    eventsInserted: 0,
    errors: [] as string[],
  };

  try {
    // 1. Active plans with a real paylink (DB = source of truth)
    const { data: plans, error: plansErr } = await supabase
      .from("plans")
      .select("id, title, helio_paylink_id, grace_period_days, interval")
      .eq("is_active", true)
      .not("helio_paylink_id", "is", null);
    if (plansErr) throw new Error(`plans fetch: ${plansErr.message}`);
    if (!plans || plans.length === 0) {
      return new Response(JSON.stringify({ ok: true, summary }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    summary.plans = plans.length;

    // 2. For each plan, poll Helio subscriptions
    for (const plan of plans) {
      const paylink = plan.helio_paylink_id;
      const url = `${HELIO_API_BASE}/v1/subscriptions?paylink=${encodeURIComponent(paylink)}&apiKey=${encodeURIComponent(HELIO_API_KEY)}`;
      let resp: Response;
      try {
        resp = await fetch(url, {
          headers: { Accept: "application/json", Authorization: `Bearer ${HELIO_API_TOKEN}` },
        });
      } catch (e) {
        summary.errors.push(`${plan.title}: fetch failed: ${String(e)}`);
        continue;
      }
      if (!resp.ok) {
        summary.errors.push(`${plan.title}: HTTP ${resp.status} ${await resp.text()}`);
        continue;
      }

      const subs: any[] = await resp.json().catch(() => []);
      if (!Array.isArray(subs)) {
        summary.errors.push(`${plan.title}: non-array response`);
        continue;
      }
      summary.subscriptionsSeen += subs.length;

      for (const sub of subs) {
        try {
          await reconcileSubscription(plan, sub, summary);
        } catch (e) {
          summary.errors.push(`${plan.title}/${sub.id}: ${String(e)}`);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("reconcile error:", e);
    return new Response(JSON.stringify({ error: String(e), summary }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// -----------------------------------------------------------------------------
// Reconcile a single Helio subscription against local rows
// -----------------------------------------------------------------------------
async function reconcileSubscription(plan: any, sub: any, summary: any): Promise<void> {
  const helioSubId: string | undefined = sub.id;
  const helioStatus: string = String(sub.status ?? "").toUpperCase(); // ACTIVE | EXPIRED
  const email: string | undefined = sub.email;
  const renewalDate: string | undefined = sub.renewalDate;
  const createdAt: string | undefined = sub.createdAt;

  // Latest transaction carries identity + payment info
  const txs: any[] = Array.isArray(sub.transactions) ? sub.transactions : [];
  const latest = txs[txs.length - 1] ?? txs[0] ?? {};
  const meta = latest?.meta ?? {};
  const customerDetails = meta?.customerDetails ?? {};
  const discordUser = customerDetails?.discordUser ?? null;
  const tokenQuote = meta?.tokenQuote ?? {};
  const tokenSymbol = tokenQuote?.from ?? "USDC";
  const amountDecimal = tokenQuote?.fromAmountDecimal;

  // --- Identify the local user ---
  // 1) by email (users.email unique)
  let localUser: { id: string; clerk_user_id: string; role?: string } | null = null;
  if (email) {
    const { data } = await supabase
      .from("users")
      .select("id, clerk_user_id, role")
      .ilike("email", email.trim())
      .maybeSingle();
    localUser = data ?? null;
  }
  // 2) by Discord id captured on an existing subscription (fallback)
  if (!localUser && discordUser?.id) {
    const { data: subRow } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("helio_discord_id", String(discordUser.id))
      .limit(1)
      .maybeSingle();
    if (subRow) {
      const { data: u } = await supabase
        .from("users")
        .select("id, clerk_user_id, role")
        .eq("id", subRow.user_id)
        .maybeSingle();
      localUser = u ?? null;
    }
  }
  if (!localUser) {
    summary.unknownUsers += 1;
    console.warn(`No local user for Helio sub ${helioSubId} (email=${email}, discord=${discordUser?.id})`);
    return;
  }
  summary.matchedUsers += 1;

  // --- Find or create the local subscription row ---
  const graceDays = plan.grace_period_days ?? 3;
  const status: "active" | "expired" =
    helioStatus === "ACTIVE" ? "active" : helioStatus === "EXPIRED" ? "expired" : "expired";

  const periodStart = createdAt ?? new Date().toISOString();
  const periodEnd = renewalDate ?? addDays(periodStart, plan.interval === "YEAR" ? 365 : plan.interval === "QUARTER" ? 91 : 30);
  const graceEnd = addDays(periodEnd, graceDays);

  // Existing row: by helio_subscription_id OR by (user, plan) active set
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id, status, user_id, current_period_end")
    .or(`helio_subscription_id.eq.${helioSubId},and(user_id.eq.${localUser.id},plan_id.eq.${plan.id},status.in.(pending,active,grace))`)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Skip if nothing changed
    if (existing.status === status && (existing as any).current_period_end === periodEnd) {
      summary.unchanged += 1;
    } else {
      const patch: Record<string, unknown> = {
        status,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        grace_period_end: graceEnd,
        helio_subscription_id: helioSubId,
        helio_renewal_date: periodEnd,
        helio_email: email ?? null,
        helio_discord_id: discordUser?.id ?? null,
        helio_discord_username: discordUser?.username ?? null,
        helio_transaction_id: latest?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("subscriptions").update(patch).eq("id", existing.id);
      if (error) throw new Error(`subscriptions update: ${error.message}`);
      summary.updated += 1;
    }
    // sync identity to users row
    if (discordUser?.id || email) {
      const userPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (discordUser?.id) userPatch.discord_id = String(discordUser.id);
      if (discordUser?.username) userPatch.discord_username = String(discordUser.username);
      await supabase.from("users").update(userPatch).eq("id", localUser.id);
    }
    await maybeInsertTransaction(existing.id, localUser.id, plan.id, latest, summary);
    await maybeInsertEvent(existing.id, status, latest, summary);
    if (status === "active") {
      await provisionRedis({ subscriptionId: existing.id, userId: localUser.id, planId: plan.id });
    }
    await syncClerkMetadata({
      clerkUserId: localUser.clerk_user_id,
      subscriptionStatus: status,
      planTitle: plan.title,
      discordId: discordUser?.id ? String(discordUser.id) : undefined,
      role: localUser.role,
    });
    return;
  }

  // No existing row — only create for ACTIVE subscriptions (don't fabricate expired history)
  if (status !== "active") {
    summary.unchanged += 1;
    return;
  }

  const { data: created, error: insErr } = await supabase
    .from("subscriptions")
    .insert({
      user_id: localUser.id,
      plan_id: plan.id,
      status: "active",
      helio_subscription_id: helioSubId,
      helio_paylink_id: plan.helio_paylink_id,
      helio_transaction_id: latest?.id ?? null,
      helio_renewal_date: periodEnd,
      helio_email: email ?? null,
      helio_discord_id: discordUser?.id ? String(discordUser.id) : null,
      helio_discord_username: discordUser?.username ?? null,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      grace_period_end: graceEnd,
    })
    .select("id")
    .single();
  if (insErr) {
    // Unique violation (one active per plan) — retry as update
    if (insErr.code === "23505") {
      const { data: dup } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("user_id", localUser.id)
        .eq("plan_id", plan.id)
        .in("status", ["pending", "active", "grace"])
        .limit(1)
        .maybeSingle();
      if (dup) {
        const patch = {
          status: "active",
          current_period_start: periodStart,
          current_period_end: periodEnd,
          grace_period_end: graceEnd,
          helio_subscription_id: helioSubId,
          helio_renewal_date: periodEnd,
          helio_email: email ?? null,
          helio_discord_id: discordUser?.id ? String(discordUser.id) : null,
          helio_discord_username: discordUser?.username ?? null,
          helio_transaction_id: latest?.id ?? null,
          updated_at: new Date().toISOString(),
        };
        const { error: upErr } = await supabase.from("subscriptions").update(patch).eq("id", dup.id);
        if (upErr) throw new Error(`dup update: ${upErr.message}`);
        summary.updated += 1;
        await maybeInsertTransaction(dup.id, localUser.id, plan.id, latest, summary);
        await maybeInsertEvent(dup.id, "active", latest, summary);
        await provisionRedis({ subscriptionId: dup.id, userId: localUser.id, planId: plan.id });
      }
      return;
    }
    throw new Error(`subscriptions insert: ${insErr.message}`);
  }
  summary.created += 1;

  // sync identity to users row (fresh create)
  if (discordUser?.id || email) {
    const userPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (discordUser?.id) userPatch.discord_id = String(discordUser.id);
    if (discordUser?.username) userPatch.discord_username = String(discordUser.username);
    await supabase.from("users").update(userPatch).eq("id", localUser.id);
  }
  await maybeInsertTransaction(created.id, localUser.id, plan.id, latest, summary);
  await maybeInsertEvent(created.id, "active", latest, summary);
  await provisionRedis({ subscriptionId: created.id, userId: localUser.id, planId: plan.id });
  await syncClerkMetadata({
    clerkUserId: localUser.clerk_user_id,
    subscriptionStatus: "active",
    planTitle: plan.title,
    discordId: discordUser?.id ? String(discordUser.id) : undefined,
    role: localUser.role,
  });
}

// -----------------------------------------------------------------------------
// Insert payment_transactions if the tx id isn't already recorded
// -----------------------------------------------------------------------------
async function maybeInsertTransaction(
  subscriptionId: string,
  userId: string,
  planId: string,
  tx: any,
  summary: any,
): Promise<void> {
  const txId = tx?.id;
  if (!txId) return;
  const meta = tx?.meta ?? {};
  const tokenQuote = meta?.tokenQuote ?? {};
  const tokenSymbol = tokenQuote?.from ?? "USDC";
  const amountDecimal = tokenQuote?.fromAmountDecimal;
  const totalUsd = meta?.totalAmountAsUSD;
  const amountMinimal = meta?.amount ?? "0";
  const amountCents = totalUsd
    ? minimalToCents(String(totalUsd), 6)
    : amountDecimal
      ? Math.round(parseFloat(amountDecimal) * 100)
      : 0;

  const { error } = await supabase.from("payment_transactions").upsert(
    {
      subscription_id: subscriptionId,
      user_id: userId,
      plan_id: planId,
      helio_transaction_id: txId,
      amount_minimal: String(amountMinimal),
      amount_decimal: amountDecimal ?? null,
      amount_cents: amountCents,
      token_symbol: tokenSymbol,
      token_decimals: deriveTokenDecimals(tokenSymbol),
      currency: "USD",
      payment_method: "crypto",
      wallet_address: meta?.senderPK ?? null,
      tx_signature: meta?.transactionSignature ?? null,
      submit_geolocation: meta?.submitGeolocation ?? null,
      status: String(meta?.transactionStatus ?? "SUCCESS").toLowerCase(),
      paid_at: tx?.createdAt ?? new Date().toISOString(),
      raw_payload: tx,
    },
    { onConflict: "helio_transaction_id", ignoreDuplicates: true },
  );
  if (error) {
    console.warn(`payment_transactions upsert: ${error.message}`);
    return;
  }
  summary.transactionsInserted += 1;
}

// -----------------------------------------------------------------------------
// Append audit event (dedupe: only if no event for this tx+type recently)
// -----------------------------------------------------------------------------
async function maybeInsertEvent(
  subscriptionId: string,
  status: string,
  tx: any,
  summary: any,
): Promise<void> {
  // Use dedicated sync event types (added to the enum by migration 0007).
  const eventType = status === "active" ? "SYNC_STARTED" : "SYNC_EXPIRED";
  const { data: dup } = await supabase
    .from("subscription_events")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("event_type", eventType)
    .eq("helio_transaction_id", tx?.id ?? null)
    .limit(1)
    .maybeSingle();
  if (dup) return;

  await supabase.from("subscription_events").insert({
    subscription_id: subscriptionId,
    event_type: eventType,
    helio_transaction_id: tx?.id ?? null,
    helio_paylink_id: tx?.paylinkId ?? null,
    amount_minimal: tx?.meta?.amount ?? null,
    amount_cents: tx?.meta?.totalAmountAsUSD
      ? minimalToCents(String(tx.meta.totalAmountAsUSD), 6)
      : null,
    currency: tx?.meta?.tokenQuote?.from ?? "USDC",
    sender_wallet: tx?.meta?.senderPK ?? null,
    raw_payload: tx ?? {},
  });
  summary.eventsInserted = (summary.eventsInserted ?? 0) + 1;
}
