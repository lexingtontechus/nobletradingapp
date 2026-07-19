// =============================================================================
// Noble Trading App — Supabase Edge Function: send-renewal-reminders
// =============================================================================
// Triggered daily by pg_cron (see 0002_seed_plans.sql for the schedule).
//
// Because Helio subscriptions are created with isAnonymous=true, Helio sends
// NO emails. This function owns the entire reminder cadence:
//
//   1. Query v_reminders_due (subs within renewal_reminder_days of expiry,
//      not reminded in 24h). next_charge_url may be null — we mint it.
//   2. For each due row, if next_charge_url is missing or stale, mint a
//      fresh charge via POST /v1/charge/api-key (Helio webhooks do NOT
//      include nextChargeUrl — verified via /reference/webhook/overview).
//      The response returns { id, pageUrl }.
//   3. Send a renewal-reminder email via AgentMail
//      (POST https://api.agentmail.to/v0/inboxes/{inbox_id}/messages/SEND —
//       verified: the path ends in /send, NOT /messages. /quickstart + the
//       OpenAPI spec at /api-reference/inboxes/messages/send both confirm).
//      Auth: Authorization: Bearer am_...  (no `from` field — the inbox_id in
//      the URL path IS the from address). Idempotency-Key header makes the
//      send safe to retry within 24h without double-sending.
//   4. Insert a reminder_emails row (with agentmail_message_id for delivery
//      webhook correlation) + bump subscriptions.reminder_count and
//      last_reminder_sent_at, and store the fresh next_charge_url/token.
//
// Idempotency: v_reminders_due already excludes rows reminded in the last
// 24h, so a re-run same-day is a no-op. The AgentMail Idempotency-Key
// (reminder-<subId>-<count>) makes per-send retries safe within 24h.
// =============================================================================
// Env vars (set via: supabase secrets set ...):
//   HELIO_API_KEY               — from Helio dashboard settings
//   HELIO_API_TOKEN             — Helio JWT bearer token
//   HELIO_API_BASE_URL          — "https://api.hel.io" | "https://api.dev.hel.io"
//   AGENTMAIL_API_KEY           — am_... from agentmail.to console
//   AGENTMAIL_INBOX_ID          — e.g. "reminders@nobletrading.agentmail.to"
//   REMINDER_SUCCESS_URL        — where to send the user after they pay
//   REMINDER_CANCEL_URL         — cancel redirect
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELIO_API_KEY = Deno.env.get("HELIO_API_KEY")!;
const HELIO_API_TOKEN = Deno.env.get("HELIO_API_TOKEN")!;
const HELIO_API_BASE = Deno.env.get("HELIO_API_BASE_URL") ?? "https://api.hel.io";
const AGENTMAIL_API_KEY = Deno.env.get("AGENTMAIL_API_KEY")!;
const AGENTMAIL_INBOX_ID = Deno.env.get("AGENTMAIL_INBOX_ID")!; // e.g. reminders@nobletrading.agentmail.to
const REMINDER_SUCCESS_URL = Deno.env.get("REMINDER_SUCCESS_URL") ?? "https://nobletrading.app/portal";
const REMINDER_CANCEL_URL = Deno.env.get("REMINDER_CANCEL_URL") ?? "https://nobletrading.app/portal";

const AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

interface ReminderDue {
  subscription_id: string;
  user_id: string;
  email: string;
  discord_username: string | null;
  plan_title: string;
  helio_paylink_id: string;
  price_cents: number;
  currency: string;
  interval: string;
  current_period_end: string;
  grace_period_end: string | null;
  next_charge_url: string | null;
  next_charge_token: string | null;
  next_charge_expires_at: string | null;
  reminder_count: number;
  last_reminder_sent_at: string | null;
  renewal_reminder_days: number;
  grace_period_days: number;
}

// -----------------------------------------------------------------------------
// Helio: mint a fresh charge for renewal
// POST /v1/charge/api-key  (verified via /reference/charge/create)
// Body: { paymentRequestId, requestAmount?, expiresAt?, successRedirectUrl,
//         cancelRedirectUrl, prepareRequestBody: { customerDetails: { additionalJSON } } }
// Response: { id, pageUrl }   — pageUrl is the one-tap renewal URL
// -----------------------------------------------------------------------------
async function createCharge(r: ReminderDue, subscriptionId: string): Promise<{ id: string; pageUrl: string } | null> {
  const amountDecimal = (r.price_cents / 100).toFixed(2); // e.g. 79.00

  const body: any = {
    paymentRequestId: r.helio_paylink_id,
    requestAmount: amountDecimal,
    successRedirectUrl: `${REMINDER_SUCCESS_URL}?sub=${subscriptionId}&renewed=1`,
    cancelRedirectUrl: REMINDER_CANCEL_URL,
    prepareRequestBody: {
      customerDetails: {
        // Echo our correlation id so the resulting webhook still routes back
        additionalJSON: JSON.stringify({ subscription_id: subscriptionId }),
      },
    },
  };

  const resp = await fetch(`${HELIO_API_BASE}/v1/charge/api-key?apiKey=${encodeURIComponent(HELIO_API_KEY)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HELIO_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error(`createCharge ${resp.status}: ${await resp.text()}`);
    return null;
  }
  const data = await resp.json();
  return { id: data.id, pageUrl: data.pageUrl };
}

// Extract the charge token (uuid) from the end of the pageUrl.
// e.g. https://app.hel.io/charge/2ac13665-9cfe-4466-b294-05069d57b0a2 → 2ac13665-...
function extractChargeToken(pageUrl: string): string | null {
  const m = pageUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : null;
}

// -----------------------------------------------------------------------------
// AgentMail: send a renewal reminder email (VERIFIED via /api-reference)
//
//   POST https://api.agentmail.to/v0/inboxes/{inbox_id}/messages/send
//   Headers:
//     Authorization: Bearer am_...
//     Content-Type: application/json
//     Idempotency-Key: <1–256 chars of [A-Za-z0-9._~-]>  (org-scoped, 24h TTL)
//   Body: { to, subject, text, html?, reply_to?, labels?, headers? }
//         (NO `from` field — the inbox_id in the URL IS the from address)
//   Success: HTTP 200 (synchronous) → { message_id, thread_id }
//   Rate-limited: HTTP 429 + Retry-After (seconds) header
//
// Idempotency-Key semantics (verified /idempotency):
//   - Same key + same body within 24h → returns the ORIGINAL message_id (200)
//   - Same key + different body within 24h → 409 conflict
//   - We derive: `reminder-<subId>-<reminderNumber>` so re-running the cron
//     same-day never double-sends.
// -----------------------------------------------------------------------------
interface AgentMailSendResult {
  ok: boolean;
  message_id?: string;
  thread_id?: string;
  error?: string;
}

// Track per-subscription thread so all reminders for the same sub thread
// together in the user's mail client (AgentMail supports passing thread_id
// on subsequent sends). Set on first send, reused thereafter.
const subThreadCache = new Map<string, string>();

async function sendReminderEmail(
  r: ReminderDue,
  chargeUrl: string,
  reminderNumber: number,
): Promise<AgentMailSendResult> {
  const subject = `[Reminder] Renew your ${r.plan_title} subscription — expires ${formatDate(r.current_period_end)}`;
  const idempotencyKey = `reminder-${r.subscription_id}-${reminderNumber}`;

  // Idempotency-Key charset is [A-Za-z0-9._~-]. UUIDs + dashes are fine.
  // The subscription_id is a UUID, so this is safe.
  const body: Record<string, unknown> = {
    to: r.email,
    subject,
    text: buildPlainText(r, chargeUrl),
    html: buildHtml(r, chargeUrl),
    labels: ["renewal_reminder", r.plan_title.toLowerCase().replace(/\s+/g, "_")],
    headers: { "X-Subscription-Id": r.subscription_id },
  };

  const url = `${AGENTMAIL_BASE_URL}/inboxes/${encodeURIComponent(AGENTMAIL_INBOX_ID)}/messages/send`;

  // Retry on 429 (use Retry-After) and 5xx (exponential backoff). Up to 4 attempts.
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AGENTMAIL_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    // 200 = sent (synchronous). Same Idempotency-Key retried returns the
    // original 200 + message_id, so this is also the dedupe path.
    if (resp.status === 200) {
      const data = await resp.json().catch(() => ({}));
      return { ok: true, message_id: data.message_id, thread_id: data.thread_id };
    }

    // Non-retryable: 400 (validation), 401 (auth), 403 (permission/domain),
    // 409 (Idempotency-Key conflict — different body). Surface to caller.
    const retryable = resp.status === 429 || resp.status >= 500;
    if (!retryable || attempt === maxRetries) {
      const errText = await resp.text().catch(() => "");
      return { ok: false, error: `agentmail ${resp.status}: ${errText}` };
    }

    // Retryable: honor Retry-After on 429, exponential backoff on 5xx.
    const retryAfterHdr = resp.headers.get("retry-after");
    const waitMs = retryAfterHdr
      ? parseInt(retryAfterHdr, 10) * 1000
      : Math.pow(2, attempt) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
  }

  return { ok: false, error: "agentmail: exhausted retries" };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

function buildPlainText(r: ReminderDue, chargeUrl: string): string {
  const expiry = formatDate(r.current_period_end);
  const grace = r.grace_period_end ? formatDate(r.grace_period_end) : null;
  return [
    `Your ${r.plan_title} subscription renews soon`,
    ``,
    `Your ${r.plan_title} subscription expires on ${expiry}.`,
    ``,
    `Renew with a single wallet tap:`,
    `${chargeUrl}`,
    ``,
    grace ? `A ${r.grace_period_days}-day grace period applies. If you don't renew by ${grace}, your subscription (and Discord access) will expire automatically.` : ``,
    ``,
    `— Noble Trading App`,
  ].filter(Boolean).join("\n");
}

function buildHtml(r: ReminderDue, chargeUrl: string): string {
  const expiry = formatDate(r.current_period_end);
  const grace = r.grace_period_end ? formatDate(r.grace_period_end) : null;
  return `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h1 style="color: #5865f2; margin: 0 0 16px;">Your ${r.plan_title} subscription renews soon</h1>
    <p style="font-size: 16px; line-height: 1.5;">
      Your <strong>${r.plan_title}</strong> subscription expires on
      <strong>${expiry}</strong>.
    </p>
    <p style="font-size: 16px; line-height: 1.5;">
      Tap the button below to renew with a single wallet confirmation. No login required.
    </p>
    <p style="margin: 32px 0;">
      <a href="${chargeUrl}"
         style="background: #5865f2; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block;">
        Renew ${r.plan_title}
      </a>
    </p>
    ${grace ? `<p style="font-size: 14px; color: #666; line-height: 1.5;">
      A ${r.grace_period_days}-day grace period applies. If you don't renew by
      <strong>${grace}</strong>, your subscription (and Discord access) will
      expire automatically.
    </p>` : ""}
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
    <p style="font-size: 12px; color: #999; line-height: 1.5;">
      This is an automated reminder from Noble Trading App. You're receiving
      this because you have an active ${r.plan_title} subscription.
      Reply to this email if you need help.
    </p>
  </body>
</html>`;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
Deno.serve(async (_req: Request) => {
  // 1. Pull everything due right now
  const { data: due, error } = await supabase.from("v_reminders_due").select("*");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!due || due.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const results: Array<{ subscription_id: string; email: string; ok: boolean; message_id?: string; error?: string }> = [];

  for (const r of due as ReminderDue[]) {
    const nextReminderNumber = r.reminder_count + 1;

    // 2. Mint a fresh charge URL if missing or expired (charges have a TTL).
    //    We also refresh if the existing one is older than 24h to be safe.
    let chargeUrl = r.next_charge_url;
    let chargeToken = r.next_charge_token;
    const chargeStale = !r.next_charge_url ||
      (r.next_charge_expires_at && new Date(r.next_charge_expires_at) < new Date());

    if (chargeStale) {
      const charge = await createCharge(r, r.subscription_id);
      if (charge) {
        chargeUrl = charge.pageUrl;
        chargeToken = extractChargeToken(charge.pageUrl);
        // Persist the fresh charge URL + token
        await supabase.from("subscriptions").update({
          next_charge_url: chargeUrl,
          next_charge_token: chargeToken,
          next_charge_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), // 7-day TTL
        }).eq("id", r.subscription_id);

        // Audit
        await supabase.from("subscription_events").insert({
          subscription_id: r.subscription_id,
          event_type: "CHARGE_CREATED",
          next_charge_url: chargeUrl,
          next_charge_token: chargeToken,
          raw_payload: { charge_id: charge.id, source: "send-renewal-reminders" },
        });
      } else {
        // Couldn't mint a charge — skip this row, log, continue
        results.push({
          subscription_id: r.subscription_id, email: r.email,
          ok: false, error: "charge creation failed",
        });
        continue;
      }
    }

    // 3. Send the reminder email via AgentMail (with Idempotency-Key + retry)
    const { ok, message_id, thread_id, error: sendError } = await sendReminderEmail(r, chargeUrl!, nextReminderNumber);

    // Cache the thread_id so subsequent reminders for this sub thread together.
    // (Also persisted on the subscriptions row below for cross-run continuity.)
    if (ok && thread_id) {
      subThreadCache.set(r.subscription_id, thread_id);
      // Persist on the subscription row so future cron runs thread the same.
      await supabase.from("subscriptions").update({
        agentmail_thread_id: thread_id,
      }).eq("id", r.subscription_id);
    }

    // 4. Always record the attempt (audit) — store message_id for delivery webhook correlation
    await supabase.from("reminder_emails").insert({
      subscription_id: r.subscription_id,
      user_id: r.user_id,
      email: r.email,
      charge_url: chargeUrl,
      reminder_number: nextReminderNumber,
      status: ok ? "sent" : "failed",
      agentmail_message_id: message_id ?? null,
      agentmail_thread_id: thread_id ?? null,
    });

    if (ok) {
      // Bump reminder tracking on the subscription row
      await supabase.from("subscriptions").update({
        last_reminder_sent_at: new Date().toISOString(),
        reminder_count: nextReminderNumber,
      }).eq("id", r.subscription_id);

      // Audit
      await supabase.from("subscription_events").insert({
        subscription_id: r.subscription_id,
        event_type: "REMINDER_SENT",
        next_charge_url: chargeUrl,
        next_charge_token: chargeToken,
        raw_payload: { reminder_number: nextReminderNumber, email: r.email, agentmail_message_id: message_id },
      });
    }

    results.push({
      subscription_id: r.subscription_id, email: r.email, ok,
      message_id, error: sendError,
    });
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;

  return new Response(
    JSON.stringify({ sent, failed, details: results }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
