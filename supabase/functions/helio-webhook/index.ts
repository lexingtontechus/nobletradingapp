// =============================================================================
// Noble Trading App — Supabase Edge Function: helio-webhook
// =============================================================================
// Receives MoonPay Commerce (Hel.io) subscription webhooks.
//
// VERIFIED API CONTRACT (https://docs.hel.io/reference/webhook/overview):
//
// Headers:
//   Authorization: Bearer <sharedToken>     — confirms origin = MoonPay Commerce
//   Content-Type:   application/json
//   X-Signature:    <hex HMAC-SHA256 of raw body, keyed with sharedToken>
//
// Payload shape (PaylinkEventPayload):
//   {
//     "event": "STARTED" | "RENEWED" | "ENDED",   // for subscriptions
//     "transaction": "<json string>",              // stringified transactionObject
//     "transactionObject": {
//       "id": "65e1df4d0ce08148bc333b62",          // transaction id
//       "paylinkId": "65dc9f9f1154beaac39976c8",
//       "createdAt": "2024-03-01T13:59:41.303Z",
//       "paymentType": "PAYLINK",
//       "meta": {
//         "id": "...",
//         "amount": "9900000",                     // MINIMAL units (lamports/sats/wei)
//         "totalAmountAsUSD": "9900000",           // USDC minimal (6 decimals) → $9.90
//         "senderPK": "<customer wallet>",
//         "recipientPK": "<merchant wallet>",
//         "transactionSignature": "<on-chain sig>",
//         "transactionStatus": "SUCCESS",
//         "submitGeolocation": "FR",               // ISO country from IP
//         "customerDetails": {
//           "email": "test@example.com",
//           "discordUser": { "id": "1234567890", "username": "..." } | null,
//           "fullName": "...", "country": "...",
//           "additionalJSON": "{\"subscription_id\":\"<uuid>\",...}",  // JSON STRING (may be double-encoded)
//         },
//         "tokenQuote": {
//           "from": "USDC", "fromAmountDecimal": "0.01",
//           "to": "USDC", "toAmountMinimal": "100000"
//         },
//         "currency": { "id": "...", "blockchain": null }
//       }
//     }
//   }
//
// IMPORTANT: additionalJSON lives at meta.customerDetails.additionalJSON and is
// a STRING — Helio runs JSON.stringify on whatever you pass at charge-create,
// so if you passed a string it ends up DOUBLE-encoded. We JSON.parse in a loop
// to recover the object in either case.
//
// The webhook does NOT include: nextChargeUrl, chargeToken, renewalDate, or
// the Helio subscription id. For renewalDate we call GET /v1/subscriptions/{id}
// (finding the id via GET /v1/subscriptions?paylink=<paylinkId> — note the
// query param is `paylink`, NOT `paylinkId`). For nextChargeUrl the reminder
// cron mints a fresh charge via POST /v1/charge/api-key.
//
// HYBRID AUTH PATTERN (Supabase = source of truth, Clerk publicMetadata = cache):
// After every status change we PATCH https://api.clerk.com/v1/users/{clerk_user_id}/metadata
// to mirror { subscriptionStatus, plan, discordId } into Clerk publicMetadata.
// This lets the Next.js frontend use <Show/> / <Protect/> for instant UI gating
// from the JWT claims with zero API calls, while Supabase remains authoritative.
// =============================================================================
// Env vars (set via: supabase secrets set ...):
//   HELIO_WEBHOOK_SHARED_TOKEN  — sharedToken from webhook creation (server-only)
//   HELIO_API_KEY               — Helio API key (from dashboard settings)
//   HELIO_API_TOKEN             — Helio JWT bearer token (from dashboard)
//   HELIO_API_BASE_URL          — "https://api.hel.io" (prod) | "https://api.dev.hel.io" (test)
//   CLERK_SECRET_KEY            — Clerk backend secret key (sk_...) for metadata sync
//   INTERNAL_FUNCTION_SECRET    — shared secret for calling redis-credentials-manager
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHARED_TOKEN = Deno.env.get("HELIO_WEBHOOK_SHARED_TOKEN")!;
const HELIO_API_KEY = Deno.env.get("HELIO_API_KEY")!;
const HELIO_API_TOKEN = Deno.env.get("HELIO_API_TOKEN")!;
const HELIO_API_BASE = Deno.env.get("HELIO_API_BASE_URL") ?? "https://api.hel.io";
const CLERK_SECRET_KEY = Deno.env.get("CLERK_SECRET_KEY")!;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// -----------------------------------------------------------------------------
// HMAC-SHA256 signature verification (timing-safe)
// -----------------------------------------------------------------------------
async function verifySignature(
  rawBody: string,
  receivedSignature: string,
  token: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const a = enc.encode(computed);
  const b = enc.encode(receivedSignature);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// -----------------------------------------------------------------------------
// Derive a stable event_id for idempotency.
// Helio's subscription webhooks do NOT include X-Webhook-Delivery-Id (that's
// deposit-only). We derive one from event + transactionId + subscription_id.
// -----------------------------------------------------------------------------
async function deriveEventId(
  event: string,
  transactionId: string | undefined,
  subscriptionId: string | undefined,
): Promise<string> {
  const seed = `${event}|${transactionId ?? ""}|${subscriptionId ?? ""}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// -----------------------------------------------------------------------------
// Helio API helpers
// -----------------------------------------------------------------------------
async function helioGet(path: string): Promise<any> {
  const url = new URL(`${HELIO_API_BASE}${path}`);
  url.searchParams.set("apiKey", HELIO_API_KEY);
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${HELIO_API_TOKEN}` },
  });
  if (!resp.ok) {
    throw new Error(`Helio GET ${path} ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

// Find the Helio subscription id for a paylink by listing subscriptions.
// The webhook gives us the transactionObject (with paylinkId) but not the
// subscription resource. We query GET /v1/subscriptions?paylink=<paylinkId>
// (verified: the query param is `paylink`, NOT `paylinkId` per
// /reference/subscriptions/list) and pick the most recent one matching our
// email (or just the latest).
async function findHelioSubscriptionId(
  paylinkId: string,
  buyerEmail?: string,
): Promise<{ id: string; renewalDate: string; status: string } | null> {
  try {
    const data = await helioGet(`/v1/subscriptions?paylink=${encodeURIComponent(paylinkId)}`);
    const subs: any[] = Array.isArray(data) ? data : data?.subscriptions ?? data?.data ?? [];
    if (subs.length === 0) return null;
    // Prefer one matching the buyer email; else take the most recent
    const match = buyerEmail
      ? subs.find((s) => s.email?.toLowerCase() === buyerEmail.toLowerCase())
      : null;
    const chosen = match ?? subs[0];
    return {
      id: chosen.id,
      renewalDate: chosen.renewalDate,
      status: chosen.status, // "ACTIVE" | "EXPIRED"
    };
  } catch (e) {
    console.error("findHelioSubscriptionId error:", e);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Convert Helio minimal-units amount to cents using token decimals.
// For USDC (6 decimals): 79_000_000 minimal = $79.00 = 7900 cents.
// -----------------------------------------------------------------------------
function minimalToCents(amountMinimal: string, decimals: number): number {
  const minimal = BigInt(amountMinimal);
  const cents = Number(minimal) / Math.pow(10, decimals) * 100;
  return Math.round(cents);
}

// -----------------------------------------------------------------------------
// Clerk publicMetadata sync (HYBRID AUTH PATTERN)
// -----------------------------------------------------------------------------
// Supabase is the source of truth for subscription state. We mirror a minimal
// role flag into Clerk publicMetadata so the Next.js frontend can use
// <Show/> / <Protect/> from JWT claims with zero API calls on first paint.
//
// PATCH https://api.clerk.com/v1/users/{user_id}/metadata
//   Authorization: Bearer <CLERK_SECRET_KEY>
//   Body: { "publicMetadata": { ...partial... } }
//
// The PATCH MERGES publicMetadata (does not replace). To delete a key, set
// it to null. We never delete `role` (it's an admin flag independent of
// subscription state) — we only write `subscriptionStatus` + `plan` +
// `discordId`.
//
// Best-effort: a failure here is logged but does NOT fail the webhook. The
// webhook's job is to record state in Supabase (already done by this point).
// A stale Clerk cache just means the portal shows a slightly outdated badge
// until the next /api/subscription-status fetch resolves.
// -----------------------------------------------------------------------------
interface ClerkMetadataSync {
  clerkUserId: string;
  subscriptionStatus: string; // 'pending' | 'active' | 'grace' | 'expired' | 'cancelled'
  plan?: string;              // plan title (display string)
  discordId?: string;         // Discord user id once captured
  role?: string | null;       // existing users.role (preserved)
}

async function syncClerkPublicMetadata(s: ClerkMetadataSync): Promise<void> {
  if (!CLERK_SECRET_KEY) {
    console.warn("CLERK_SECRET_KEY not set — skipping Clerk publicMetadata sync");
    return;
  }
  const publicMetadata: Record<string, string | null> = {
    subscriptionStatus: s.subscriptionStatus,
    plan: s.plan ?? null,
    discordId: s.discordId ?? null,
  };
  // Preserve the existing user role (admin / member) — do not overwrite.
  if (s.role) publicMetadata.role = s.role;

  try {
    const resp = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(s.clerkUserId)}/metadata`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${CLERK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publicMetadata }),
      },
    );
    if (!resp.ok) {
      console.error(`Clerk metadata sync ${resp.status}: ${await resp.text()}`);
    }
  } catch (e) {
    console.error("Clerk metadata sync error:", e);
  }
}

// -----------------------------------------------------------------------------
// Call the redis-credentials-manager Edge Function (internal HTTP).
// Best-effort: failures are logged but do NOT fail the webhook. Redis is
// downstream of billing — if provisioning fails, the daily sweep + the
// /api/redis-credentials/rotate endpoint can recover. We never want a Redis
// outage to break subscription state recording.
// -----------------------------------------------------------------------------
const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET")!;
const SUPABASE_FUNCTIONS_BASE =
  Deno.env.get("SUPABASE_URL")! + "/functions/v1/redis-credentials-manager";

async function callRedisManager(action: "provision" | "revoke", payload: any): Promise<void> {
  if (!INTERNAL_SECRET) {
    console.warn("INTERNAL_FUNCTION_SECRET not set — skipping Redis credential sync");
    return;
  }
  try {
    const resp = await fetch(SUPABASE_FUNCTIONS_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "X-Internal-Secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!resp.ok) {
      console.error(`redis-credentials-manager ${action} ${resp.status}: ${await resp.text()}`);
    }
  } catch (e) {
    console.error(`redis-credentials-manager ${action} error:`, e);
  }
}

// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 1. Read raw body BEFORE any JSON parsing (signature is over raw bytes)
  const rawBody = await req.text();

  // 2. Verify Bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${SHARED_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 3. Verify HMAC signature
  const signature = req.headers.get("x-signature") ?? "";
  if (!signature || !(await verifySignature(rawBody, signature, SHARED_TOKEN))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // 4. Parse payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // 5. Extract fields per verified API contract
  const event: string = payload?.event ?? "UNKNOWN";
  const txObj: any = payload?.transactionObject ?? {};
  const meta: any = txObj?.meta ?? {};
  const customerDetails: any = meta?.customerDetails ?? {};
  const tokenQuote: any = meta?.tokenQuote ?? {};

  const helioTransactionId: string | undefined = txObj?.id;
  const helioPaylinkId: string | undefined = txObj?.paylinkId;
  const createdAt: string = txObj?.createdAt ?? new Date().toISOString();
  const amountMinimal: string = String(meta?.amount ?? meta?.totalAmount ?? "0");
  const totalAmountAsUSD: string | undefined = meta?.totalAmountAsUSD;
  const senderWallet: string | undefined = meta?.senderPK;
  const txSignature: string | undefined = meta?.transactionSignature;
  const transactionStatus: string = meta?.transactionStatus ?? "SUCCESS";
  const submitGeo: string | undefined = meta?.submitGeolocation;
  const buyerEmail: string | undefined = customerDetails?.email;
  const discordUser: any = customerDetails?.discordUser; // { id, username } | null
  const tokenSymbol: string = tokenQuote?.from ?? "USDC";
  const tokenDecimals: number = deriveTokenDecimals(tokenSymbol);
  const amountDecimal: string | undefined = tokenQuote?.fromAmountDecimal;

  // additionalJSON lives at customerDetails.additionalJSON and is a STRING.
  // Helio runs JSON.stringify on whatever you pass at charge-create, so if you
  // passed a string it ends up DOUBLE-encoded. Parse in a loop to recover the
  // object in either case.
  let additionalJSON: any = {};
  const rawAdditional = customerDetails?.additionalJSON;
  if (rawAdditional) {
    try {
      let v: unknown = rawAdditional;
      // Loop until we have an object — handles single AND double encoding.
      let guard = 0;
      while (typeof v === "string" && guard++ < 4) v = JSON.parse(v);
      additionalJSON = (v && typeof v === "object") ? v : {};
    } catch {
      additionalJSON = {};
    }
  }

  const subscriptionId: string | undefined = additionalJSON?.subscription_id;
  const userIdFromCheckout: string | undefined = additionalJSON?.user_id;
  const planIdFromCheckout: string | undefined = additionalJSON?.plan_id;

  // 6. Idempotency check — Helio retries up to 12x
  const eventId = await deriveEventId(event, helioTransactionId, subscriptionId);
  const { data: existing } = await supabase
    .from("webhook_idempotency")
    .select("id, status")
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing?.status === "processed") {
    return new Response(JSON.stringify({ ok: true, deduplicated: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 7. We must have a subscription_id to correlate
  if (!subscriptionId) {
    await supabase.from("webhook_idempotency").upsert({
      event_id: eventId,
      event_type: event,
      status: "error",
      error_message: "missing additionalJSON.subscription_id",
    });
    return new Response("Missing subscription_id in additionalJSON", { status: 400 });
  }

  // 8. Fetch the plan row to get grace_period_days + interval (NOT hardcoded)
  const { data: subRow } = await supabase
    .from("subscriptions")
    .select("id, user_id, plan_id, plans(grace_period_days, interval, title)")
    .eq("id", subscriptionId)
    .maybeSingle();

  const planGraceDays: number = (subRow as any)?.plans?.grace_period_days ?? 3;
  const planInterval: string = (subRow as any)?.plans?.interval ?? "MONTH";
  const planTitle: string = (subRow as any)?.plans?.title ?? "Subscription";
  const planId: string = subRow?.plan_id ?? planIdFromCheckout;
  const userId: string = subRow?.user_id;

  // 9. Apply the state transition
  const now = new Date().toISOString();
  let patch: Record<string, any> = { updated_at: now };
  let newStatus: string | null = null;
  let isRenewal = false;
  let periodStart: string | undefined;
  let periodEnd: string | undefined;

  switch (event) {
    case "STARTED": {
      // Initial payment. Resolve the Helio subscription resource to get
      // renewalDate (the webhook doesn't carry it).
      const helioSub = await findHelioSubscriptionId(helioPaylinkId!, buyerEmail);
      periodStart = createdAt;
      periodEnd = helioSub?.renewalDate ?? addInterval(createdAt, planInterval);

      newStatus = "active";
      patch = {
        ...patch,
        status: "active",
        helio_subscription_id: helioSub?.id,
        helio_paylink_id: helioPaylinkId,
        helio_transaction_id: helioTransactionId,
        helio_renewal_date: periodEnd,
        helio_email: buyerEmail,
        helio_discord_id: discordUser?.id,
        helio_discord_username: discordUser?.username,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        grace_period_end: addDays(periodEnd, planGraceDays),
        next_charge_url: null,
        next_charge_token: null,
      };
      break;
    }

    case "RENEWED": {
      // Renewal payment success. Extend the period.
      isRenewal = true;
      const helioSub = await findHelioSubscriptionId(helioPaylinkId!, buyerEmail);
      periodStart = createdAt;
      periodEnd = helioSub?.renewalDate ?? addInterval(createdAt, planInterval);

      newStatus = "active";
      patch = {
        ...patch,
        status: "active",
        helio_subscription_id: helioSub?.id,
        helio_paylink_id: helioPaylinkId,
        helio_transaction_id: helioTransactionId,
        helio_renewal_date: periodEnd,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        grace_period_end: addDays(periodEnd, planGraceDays),
        // Clear the pending charge — it's been paid
        next_charge_url: null,
        next_charge_token: null,
        next_charge_expires_at: null,
      };
      break;
    }

    case "ENDED": {
      // Lapsed through grace period. Helio's Discord bot auto-removes the role.
      newStatus = "expired";
      patch = {
        ...patch,
        status: "expired",
        next_charge_url: null,
        next_charge_token: null,
        next_charge_expires_at: null,
      };
      break;
    }

    default:
      // Unknown event — log but don't fail (forward-compat)
      break;
  }

  // 10. Update the subscription row
  if (newStatus) {
    const { error } = await supabase
      .from("subscriptions")
      .update(patch)
      .eq("id", subscriptionId);
    if (error) {
      await supabase.from("webhook_idempotency").upsert({
        event_id: eventId,
        event_type: event,
        status: "error",
        error_message: `subscriptions update: ${error.message}`,
      });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 10b. Provision/revoke Redis credentials (best-effort, downstream of billing).
  //      STARTED + RENEWED → provision (idempotent; manager no-ops if already exists).
  //      ENDED             → revoke (ACL DELUSER + mark revoked_at).
  //      The daily sweep cron catches anything this misses.
  if (subscriptionId && userId && planId) {
    if (event === "STARTED" || event === "RENEWED") {
      await callRedisManager("provision", { subscriptionId, userId, planId });
    } else if (event === "ENDED") {
      await callRedisManager("revoke", { subscriptionId });
    }
  }

  // 11. Sync the users row with identity captured at checkout (discord_id etc.)
  //     Also fetch clerk_user_id + role for the Clerk metadata sync.
  let clerkUserId: string | undefined;
  let userRole: string | undefined;
  if (userId) {
    const userPatch: Record<string, any> = { updated_at: now };
    if (discordUser?.id) {
      userPatch.discord_id = discordUser.id;
      userPatch.discord_username = discordUser.username;
    }
    if (buyerEmail) userPatch.helio_email = buyerEmail;
    await supabase.from("users").update(userPatch).eq("id", userId);

    const { data: userRow } = await supabase
      .from("users")
      .select("clerk_user_id, role")
      .eq("id", userId)
      .maybeSingle();
    clerkUserId = userRow?.clerk_user_id;
    userRole = userRow?.role;
  }

  // 11b. Hybrid auth: mirror subscription status into Clerk publicMetadata so
  //      the frontend can use <Show/> / <Protect/> from JWT claims with no API
  //      call. Supabase remains the source of truth; Clerk is a cached role flag.
  if (clerkUserId && newStatus) {
    await syncClerkPublicMetadata({
      clerkUserId,
      subscriptionStatus: newStatus,
      plan: planTitle,
      discordId: discordUser?.id ?? undefined,
      role: userRole,
    });
  }

  // 12. Insert a payment_transactions row (on STARTED or RENEWED)
  if ((event === "STARTED" || event === "RENEWED") && helioTransactionId && userId && planId) {
    const amountCents = totalAmountAsUSD
      ? minimalToCents(totalAmountAsUSD, 6) // USDC is 6 decimals
      : (amountDecimal ? Math.round(parseFloat(amountDecimal) * 100) : 0);

    await supabase.from("payment_transactions").insert({
      subscription_id: subscriptionId,
      user_id: userId,
      plan_id: planId,
      helio_transaction_id: helioTransactionId,
      amount_minimal: amountMinimal,
      amount_decimal: amountDecimal ?? null,
      amount_cents: amountCents,
      token_symbol: tokenSymbol,
      token_decimals: tokenDecimals,
      currency: "USD",
      payment_method: "crypto",
      wallet_address: senderWallet ?? null,
      tx_signature: txSignature ?? null,
      submit_geolocation: submitGeo ?? null,
      status: transactionStatus.toLowerCase(),
      is_renewal: isRenewal,
      paid_at: createdAt,
      raw_payload: payload,
    });
  }

  // 13. Append to the audit log
  await supabase.from("subscription_events").insert({
    subscription_id: subscriptionId,
    event_type: event as any,
    helio_transaction_id: helioTransactionId ?? null,
    helio_paylink_id: helioPaylinkId ?? null,
    amount_minimal: amountMinimal,
    amount_cents: totalAmountAsUSD ? minimalToCents(totalAmountAsUSD, 6) : null,
    currency: tokenSymbol,
    sender_wallet: senderWallet ?? null,
    raw_payload: payload,
  });

  // 14. Mark idempotency processed
  await supabase.from("webhook_idempotency").upsert({
    event_id: eventId,
    event_type: event,
    status: "processed",
  });

  return new Response(JSON.stringify({ ok: true, status: newStatus, event }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// -----------------------------------------------------------------------------
// Date helpers
// -----------------------------------------------------------------------------
function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86400000).toISOString();
}
function addInterval(iso: string, interval: string): string {
  const d = new Date(iso);
  switch (interval) {
    case "MONTH":  d.setMonth(d.getMonth() + 1); break;
    case "QUARTER": d.setMonth(d.getMonth() + 3); break;
    case "YEAR":   d.setFullYear(d.getFullYear() + 1); break;
    default:       d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString();
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
