// =============================================================================
// Noble Trading App — Supabase Edge Function: talaria-copy
// =============================================================================
// Single HTTPS gateway for the OneTradeCopy MT5 EA. The EA never holds Supabase
// URL, anon key, or service key — only this function URL + the customer's
// Talaria claim token. All Supabase access stays server-side.
//
//   POST /functions/v1/talaria-copy
//   body: {
//     token:  "<64-hex claim token from /api/talaria-claim>",
//     action: "handshake" | "poll"
//   }
//
//   handshake → 200 {
//     ok: true, entitled: bool,
//     plan_slug, plan_uuid, plan_title, sub_status, period_end, grace_end,
//     symbols: [{ symbol, tradingview_symbol, asset_class }]
//   }
//
//   poll → 200 {
//     ok: true, entitled: bool,
//     sub_status, plan_slug, plan_uuid,
//     signals: [{
//       symbol, signal, entry_price, stop_loss, take_profit, qualified,
//       p_win, ev, kelly_f, effective_kelly, aggression, sweep_timestamp
//     }]
//   }
//
//   → 401 { ok: false, entitled: false, error: "invalid_claim"|"revoked"|"expired" }
//   → 400 { ok: false, error: "missing_token"|"invalid_json"|"unknown_action" }
//   → 405 { ok: false, error: "method_not_allowed" }
//
// Security:
//   * Token is hashed (SHA-256) and looked up in talaria_claims. Raw tokens
//     are never stored. Same identity model as talaria-check (desktop plugin).
//   * Identity is re-checked on EVERY call (claim exists, not revoked, not
//     past claim.expires_at) — cheap single-row read.
//   * Subscription entitlement is established at handshake and TTL'd to
//     period_end / grace_end (2026-09-29). Poll does NOT re-join subscriptions
//     on every request — the platform is sweep/push-oriented; a full sub
//     re-read per poll multiplies load for no new information between
//     handshakes. EA re-handshakes before period_end or on 401.
//   * poll returns only qualified=true signals for the claim's plan symbols
//     (v_talaria_symbols.plan_ids containment).
//   * last_validated_at is stamped on handshake (heartbeat), not every poll.
//
// Transport (2026-09-29 corrected):
//   * MQL5 WebRequest is blocking full-body HTTP (REST poll path).
//   * MQL5 CAN do WebSocket: raw Socket* + RFC 6455 (pure MQL5) or an async
//     DLL (e.g. asyncwinhttpwebsockets.dll). That is the standard EA push path.
//   * Platform signals are already push (Supabase Realtime broadcast
//     `realtime:signals.<plan_slug>` — same channel the desktop plugin uses).
//   * Target: EA WebSocket client → Realtime (or a thin claim-auth relay),
//     with this function kept for handshake + sparse fallback poll.
//   * This REST action set remains the v1/fallback transport.
//
// Why this exists vs EA → REST + anon key (scoping v2 §5.2):
//   * No Supabase material in a third-party/customer file.
//   * Key rotation / project move does not force an EA redistribution.
//   * Plan filtering and qualification run server-side.
//
// CORS: permissive (desktop/EA Origin is null or custom). Mirrors talaria-check.
// Env (auto-injected): SUPABASE_URL, SUPABASE_SECRET_KEYS
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Supabase's new secret key env var is a JSON object keyed by key name
const SUPABASE_SECRET_KEYS = JSON.parse(
  Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"
);
const SUPABASE_SERVICE_KEY =
  (SUPABASE_SECRET_KEYS.kairos ?? Object.values(SUPABASE_SECRET_KEYS)[0])!;
// Option A (2026-09-29): anon/publishable key for EA WebSocket → Supabase
// Realtime (same as desktop plugin). Prefer env; never use service key here.
// New publishable key env var is also a JSON object keyed by key name.
const SUPABASE_PUBLISHABLE_KEYS = JSON.parse(
  Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}"
);
const SUPABASE_ANON_KEY =
  Object.values(SUPABASE_PUBLISHABLE_KEYS)[0] ||
  "sb_publishable_cYfseJa9z0qss0g_Y594wA_lXrWVBsa";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

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

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ENTITLED_STATUSES = new Set(["active", "grace"]);

// Claim → plan + live subscription. Full path — handshake only (2026-09-29).
type ClaimContext =
  | {
      ok: true;
      user_id: string;
      plan_id: string;
      plan_slug: string;
      plan_title: string | null;
      entitled: boolean;
      sub_status: string;
      period_end: string | null;
      grace_end: string | null;
    }
  | { ok: false; status: number; error: string };

/** Identity-only check (every call): claim exists, not revoked, not expired. */
async function resolveClaimIdentity(token: string): Promise<
  | {
      ok: true;
      user_id: string;
      plan_id: string;
      plan_slug: string;
      plan_title: string | null;
    }
  | { ok: false; status: number; error: string }
> {
  const tokenHash = await sha256Hex(token);
  const { data: claim, error: claimErr } = await supabase
    .from("talaria_claims")
    .select("user_id, plan_id, expires_at, revoked_at, plans(id, slug, title)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (claimErr || !claim) {
    return { ok: false, status: 401, error: "invalid_claim" };
  }
  if (claim.revoked_at) {
    return { ok: false, status: 401, error: "revoked" };
  }
  if (new Date(claim.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, error: "expired" };
  }

  const planId = claim.plan_id ?? claim.plans?.id ?? null;
  const planSlug = claim.plans?.slug ?? null;
  if (!planId || !planSlug) {
    return { ok: false, status: 401, error: "invalid_claim" };
  }

  return {
    ok: true,
    user_id: claim.user_id,
    plan_id: planId,
    plan_slug: planSlug,
    plan_title: claim.plans?.title ?? null,
  };
}

/** Full claim + subscription (handshake). Stamps last_validated_at heartbeat. */
async function resolveClaim(token: string): Promise<ClaimContext> {
  const ident = await resolveClaimIdentity(token);
  if (!ident.ok) return ident;

  const tokenHash = await sha256Hex(token);
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, grace_period_end")
    .eq("user_id", ident.user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const subStatus: string = sub?.status ?? "none";
  const entitled = ENTITLED_STATUSES.has(subStatus);

  // Heartbeat — handshake only (not every poll).
  await supabase
    .from("talaria_claims")
    .update({ last_validated_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);

  return {
    ok: true,
    user_id: ident.user_id,
    plan_id: ident.plan_id,
    plan_slug: ident.plan_slug,
    plan_title: ident.plan_title,
    entitled,
    sub_status: subStatus,
    period_end: sub?.current_period_end ?? null,
    grace_end: sub?.grace_period_end ?? null,
  };
}

async function planSymbols(planUuid: string) {
  const { data, error } = await supabase
    .from("v_talaria_symbols")
    .select("symbol, tradingview_symbol, asset_class, plan_ids")
    .contains("plan_ids", [planUuid]);

  if (error || !data) return [];
  return data.map((r) => ({
    symbol: r.symbol,
    tradingview_symbol: r.tradingview_symbol,
    asset_class: r.asset_class,
  }));
}

const SIGNAL_COLUMNS =
  "symbol,signal,entry_price,stop_loss,take_profit,qualified," +
  "p_win,ev,kelly_f,effective_kelly,aggression,sweep_timestamp";

async function planSignals(planUuid: string, symbols: string[]) {
  if (symbols.length === 0) return [];
  const { data, error } = await supabase
    .from("v_talaria_latest_signals")
    .select(SIGNAL_COLUMNS)
    .in("symbol", symbols)
    .eq("qualified", true)
    .order("sweep_timestamp", { ascending: false });

  if (error || !data) return [];
  return data.map((r) => ({
    symbol: r.symbol,
    signal: r.signal,
    entry_price: r.entry_price,
    stop_loss: r.stop_loss,
    take_profit: r.take_profit,
    qualified: r.qualified,
    p_win: r.p_win,
    ev: r.ev,
    kelly_f: r.kelly_f,
    effective_kelly: r.effective_kelly,
    aggression: r.aggression,
    sweep_timestamp: r.sweep_timestamp,
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: { token?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const token = body?.token;
  const action = body?.action ?? "handshake";
  if (!token || typeof token === "undefined" || typeof token !== "string") {
    return json({ ok: false, entitled: false, error: "missing_token" }, 400);
  }
  if (action !== "handshake" && action !== "poll") {
    return json({ ok: false, entitled: false, error: "unknown_action" }, 400);
  }

  if (action === "handshake") {
    // Full entitlement establishment (claim + live subscription).
    const ctx = await resolveClaim(token);
    if (!ctx.ok) {
      return json({ ok: false, entitled: false, error: ctx.error }, ctx.status);
    }
    const symbols = await planSymbols(ctx.plan_id);
    // Option A: Realtime push credentials (plugin parity). Flat keys for the
    // EA's JSON scanner. Anon key is public; channel topic is the ACL.
    const rtHost = SUPABASE_URL.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return json({
      ok: true,
      entitled: ctx.entitled,
      plan_slug: ctx.plan_slug,
      plan_uuid: ctx.plan_id,
      plan_title: ctx.plan_title,
      sub_status: ctx.sub_status,
      period_end: ctx.period_end,
      grace_end: ctx.grace_end,
      // EA TTLs entitlement to period_end / HandshakeIntervalSec (min).
      entitled_until: ctx.period_end ?? ctx.grace_end ?? null,
      realtime_url: `wss://${rtHost}/realtime/v1/websocket`,
      realtime_apikey: SUPABASE_ANON_KEY,
      realtime_topic: `realtime:signals.${ctx.plan_slug}`,
      realtime_vsn: "1.0.0",
      symbols,
    });
  }

  // poll — identity only (claim). Subscription is TTL'd at handshake
  // (period_end / entitled_until). Do not re-join subscriptions here.
  const ident = await resolveClaimIdentity(token);
  if (!ident.ok) {
    return json({ ok: false, entitled: false, error: ident.error }, ident.status);
  }

  const symbols = await planSymbols(ident.plan_id);
  const symbolNames = symbols.map((s) => s.symbol);
  // entitled is owned by the EA between handshakes; we always return true
  // here if the claim is live so the EA's g_entitled / TTL gate is authoritative.
  const signals = await planSignals(ident.plan_id, symbolNames);

  return json({
    ok: true,
    entitled: true,
    entitled_via: "handshake_ttl",
    plan_slug: ident.plan_slug,
    plan_uuid: ident.plan_id,
    signals,
  });
});
