// =============================================================================
// Noble Trading App — Supabase Edge Function: talaria-check
// =============================================================================
// Validates a Talaria client claim token and re-checks the LIVE subscriptions
// row on EVERY call. The token only proves identity; the subscription row
// decides access — this is the ongoing subscription security check.
//
//   POST /functions/v1/talaria-check
//   body: { token: "<64-hex claim token minted by /api/talaria-claim>" }
//
//   → 200 { ok: true, plan_slug, plan_uuid, sub_status, period_end,
//           grace_end, next_charge_url }
//   → 401 { ok: false, error: "invalid_claim" | "revoked" | "expired" }
//   → 400 { ok: false, error: "missing_token" | "invalid_json" }
//   → 405 { ok: false, error: "method_not_allowed" }
//
// Auth flow:
//   1. Hash the presented token (Web Crypto SHA-256) and look it up in
//      talaria_claims (joined to plans). Raw tokens are never stored — only
//      their hashes — so the lookup key is the hash.
//   2. Reject revoked / expired claims (401 with a distinct error).
//   3. Re-read the user's MOST RECENT subscriptions row live and derive
//      sub_status: 'active' | 'grace' | 'pending' | 'expired' | 'cancelled'
//      | 'none' (none = no subscription row). A valid token does NOT bypass a
//      lapsed subscription.
//   4. Best-effort: stamp last_validated_at on the claim. Never fails the
//      response.
//
// CORS: permissive (Access-Control-Allow-Origin: *) because the caller is a
// desktop client whose Origin may be null or a custom scheme (hermes://) —
// there is no browser origin allowlist to enforce. Mirrors the repo's other
// Edge Functions (helio-webhook / redis-credentials-manager) which read env
// via Deno.env.get and use esm.sh @supabase/supabase-js; unlike them this
// function is called from an external client, so it adds CORS headers +
// OPTIONS preflight handling (they are server-to-server and need none).
// =============================================================================
// Env vars (auto-injected by Supabase — no secrets to set):
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected (bypasses RLS)
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// -----------------------------------------------------------------------------
// CORS — permissive, for the desktop client (Origin may be null / hermes://)
// -----------------------------------------------------------------------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// sha256 hex digest of a string (Deno Web Crypto)
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  // 1. Parse { token }
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const token = body?.token;
  if (!token || typeof token !== "string") {
    return json({ ok: false, error: "missing_token" }, 400);
  }

  // 2. Hash the presented token and look the claim up (joined to plans)
  const tokenHash = await sha256Hex(token);
  const { data: claim, error: claimErr } = await supabase
    .from("talaria_claims")
    .select("user_id, plan_id, expires_at, revoked_at, plans(id, slug, title)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (claimErr || !claim) {
    return json({ ok: false, error: "invalid_claim" }, 401);
  }

  // 3. Revoked / expired checks
  if (claim.revoked_at) {
    return json({ ok: false, error: "revoked" }, 401);
  }
  if (new Date(claim.expires_at).getTime() < Date.now()) {
    return json({ ok: false, error: "expired" }, 401);
  }

  // 4. LIVE subscription re-check — on every call. This is the paywall: the
  //    token proves identity, the subscriptions row decides access.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, grace_period_end, next_charge_url")
    .eq("user_id", claim.user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const subStatus: string = sub?.status ?? "none";
  const chargeable = ["expired", "cancelled", "grace"].includes(subStatus);

  // 5. Best-effort last_validated_at stamp (never fails the response)
  await supabase
    .from("talaria_claims")
    .update({ last_validated_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  return json({
    ok: true,
    plan_slug: claim.plans.slug,
    plan_uuid: claim.plans.id,
    sub_status: subStatus,
    period_end: sub?.current_period_end ?? null,
    grace_end: sub?.grace_period_end ?? null,
    // next_charge_url only when the user needs to act on it
    next_charge_url: chargeable ? (sub?.next_charge_url ?? null) : null,
  });
});
