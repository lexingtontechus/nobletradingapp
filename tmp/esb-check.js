import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SECRET_KEYS = JSON.parse(
  Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"
);
const SUPABASE_SERVICE_KEY = SUPABASE_SECRET_KEYS.kairos ?? Object.values(SUPABASE_SECRET_KEYS)[0];
const SUPABASE_PUBLISHABLE_KEYS = JSON.parse(
  Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}"
);
const SUPABASE_ANON_KEY = Object.values(SUPABASE_PUBLISHABLE_KEYS)[0] || "sb_publishable_cYfseJa9z0qss0g_Y594wA_lXrWVBsa";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
async function sha256Hex(input) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const ENTITLED_STATUSES = /* @__PURE__ */ new Set(["active", "grace"]);
async function resolveClaimIdentity(token) {
  const tokenHash = await sha256Hex(token);
  const { data: claim, error: claimErr } = await supabase.from("talaria_claims").select("user_id, plan_id, expires_at, revoked_at, plans(id, slug, title)").eq("token_hash", tokenHash).maybeSingle();
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
    plan_title: claim.plans?.title ?? null
  };
}
async function resolveClaim(token) {
  const ident = await resolveClaimIdentity(token);
  if (!ident.ok) return ident;
  const tokenHash = await sha256Hex(token);
  const { data: sub } = await supabase.from("subscriptions").select("status, current_period_end, grace_period_end").eq("user_id", ident.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const subStatus = sub?.status ?? "none";
  const entitled = ENTITLED_STATUSES.has(subStatus);
  await supabase.from("talaria_claims").update({ last_validated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("token_hash", tokenHash);
  return {
    ok: true,
    user_id: ident.user_id,
    plan_id: ident.plan_id,
    plan_slug: ident.plan_slug,
    plan_title: ident.plan_title,
    entitled,
    sub_status: subStatus,
    period_end: sub?.current_period_end ?? null,
    grace_end: sub?.grace_period_end ?? null
  };
}
async function planSymbols(planUuid) {
  const { data, error } = await supabase.from("v_talaria_symbols").select("symbol, tradingview_symbol, asset_class, plan_ids").contains("plan_ids", [planUuid]);
  if (error || !data) return [];
  return data.map((r) => ({
    symbol: r.symbol,
    tradingview_symbol: r.tradingview_symbol,
    asset_class: r.asset_class
  }));
}
const SIGNAL_COLUMNS = "symbol,signal,entry_price,stop_loss,take_profit,qualified,p_win,ev,kelly_f,effective_kelly,aggression,sweep_timestamp";
async function planSignals(planUuid, symbols) {
  if (symbols.length === 0) return [];
  const { data, error } = await supabase.from("v_talaria_latest_signals").select(SIGNAL_COLUMNS).in("symbol", symbols).eq("qualified", true).order("sweep_timestamp", { ascending: false });
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
    sweep_timestamp: r.sweep_timestamp
  }));
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  let body;
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
    const ctx = await resolveClaim(token);
    if (!ctx.ok) {
      return json({ ok: false, entitled: false, error: ctx.error }, ctx.status);
    }
    const symbols2 = await planSymbols(ctx.plan_id);
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
      symbols: symbols2
    });
  }
  const ident = await resolveClaimIdentity(token);
  if (!ident.ok) {
    return json({ ok: false, entitled: false, error: ident.error }, ident.status);
  }
  const symbols = await planSymbols(ident.plan_id);
  const symbolNames = symbols.map((s) => s.symbol);
  const signals = await planSignals(ident.plan_id, symbolNames);
  return json({
    ok: true,
    entitled: true,
    entitled_via: "handshake_ttl",
    plan_slug: ident.plan_slug,
    plan_uuid: ident.plan_id,
    signals
  });
});
