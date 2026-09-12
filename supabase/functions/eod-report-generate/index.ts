// =============================================================================
// Noble Trading App — Supabase Edge Function: eod-report-generate
// =============================================================================
// Canonical implementation of the EOD signal accuracy report build (see
// docs/worklog-eod-signal-accuracy-report.md). Runs entirely inside Supabase
// — deliberately NOT on Vercel/Next.js — because the actual work here
// (Supabase queries + up to ~20 sequential-fallback LLM calls) risks Vercel's
// serverless execution-time caps, and moving only the cron TRIGGER off
// Vercel doesn't fix that if the compute still runs there.
//
// Triggered two ways (see migration 0017 for the pg_cron schedule):
//   1. pg_cron, daily — sends `X-Supabase-Cron: true` (pg_net can't easily
//      set arbitrary headers, so this project's convention, matching
//      sweep-expired-redis-creds, is to accept that marker header as auth).
//   2. Manually — nobletradingapp's app/api/eod-report/generate/route.js is
//      an ADMIN-gated proxy (Clerk session + admin role, checked in Next.js)
//      that forwards to this function with `X-Internal-Secret`. There is
//      deliberately only ONE implementation of the report logic — Next.js
//      does not duplicate this in Node, it only decides WHO is allowed to
//      trigger a rerun.
//
// POST body: { "date"?: "YYYY-MM-DD" }  — defaults to today (UTC).
//
// Env vars (set via Supabase Dashboard -> Edge Functions -> Secrets, NOT the
// same store as nobletradingapp's Vercel env — copy the same values over):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   — auto-injected
//   INTERNAL_FUNCTION_SECRET                  — shared secret, manual trigger
//   OPENROUTER_API_KEY, OPENROUTER_MODEL       — primary LLM provider
//   NVIDIA_NIM_API_KEY, NVIDIA_NIM_MODEL        — fallback LLM provider
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const NVIDIA_NIM_API_KEY = Deno.env.get("NVIDIA_NIM_API_KEY") ?? "";
// 2026-09-12: minimax/minimax-m3:free was retired — OpenRouter now 404s
// with "This model is unavailable for free... use minimax/minimax-m3"
// (the paid slug). Switched to "openrouter/auto", OpenRouter's own
// meta-router — it picks a suitable underlying model per request and
// respects the account-level default/fallback model configured in the
// OpenRouter dashboard, so this default shouldn't go stale the same way
// a specific free-tier model ID does. NVIDIA NIM's default is
// unaffected — still verified working (2026-09-05).
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "openrouter/auto";
const NVIDIA_NIM_MODEL = Deno.env.get("NVIDIA_NIM_MODEL") || "meta/llama-3.2-11b-vision-instruct";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─── LLM commentary (OpenRouter primary, NVIDIA NIM fallback) ───────────────

const SYSTEM_PROMPT = [
  "You are writing a factual accuracy report for Talaria, a trading-signal",
  "validation and research tool. This is NOT investment advice.",
  "Describe only what a signal predicted and what actually happened,",
  "in past tense. Never recommend an action. Never use directive language",
  "like \"should\", \"buy\", or \"sell\" as an instruction to the reader.",
  "Do not suggest what the reader should do next. Keep it to 2-4 sentences.",
].join(" ");

async function callChatCompletions(baseUrl: string, apiKey: string, model: string, prompt: string) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 300,
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`${baseUrl} ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error(`${baseUrl} returned an empty response`);
  return text.trim();
}

async function generateCommentary(prompt: string): Promise<{ text: string | null; provider: string | null }> {
  if (OPENROUTER_API_KEY) {
    try {
      const text = await callChatCompletions("https://openrouter.ai/api/v1", OPENROUTER_API_KEY, OPENROUTER_MODEL, prompt);
      return { text, provider: "openrouter" };
    } catch (e) {
      console.warn("[eod-report] OpenRouter commentary failed, falling back to NVIDIA NIM:", (e as Error).message);
    }
  }
  if (NVIDIA_NIM_API_KEY) {
    try {
      const text = await callChatCompletions("https://integrate.api.nvidia.com/v1", NVIDIA_NIM_API_KEY, NVIDIA_NIM_MODEL, prompt);
      return { text, provider: "nvidia_nim" };
    } catch (e) {
      console.warn("[eod-report] NVIDIA NIM commentary failed:", (e as Error).message);
    }
  }
  return { text: null, provider: null };
}

// ─── Report build ────────────────────────────────────────────────────────────

function dayBounds(dateStr: string) {
  const start = `${dateStr}T00:00:00.000Z`;
  const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

function fmtPct(x: number | null | undefined) {
  return x == null ? "unknown" : `${(Number(x) * 100).toFixed(1)}%`;
}

function symbolPrompt(rec: any, reportDate: string) {
  const lines = [`Symbol: ${rec.symbol}`, `Date: ${reportDate}`];
  if (rec.new_signal) {
    const s = rec.new_signal;
    lines.push(
      `New signal issued today: direction ${s.signal}, regime ${s.regime || "unknown"}, ` +
        `predicted win probability ${fmtPct(s.p_win)}, expected value $${Number(s.ev ?? 0).toFixed(2)}, ` +
        `effective Kelly ${Number(s.effective_kelly ?? 0).toFixed(3)}.`
    );
  } else {
    lines.push("No new qualified signal issued today.");
  }
  if (rec.resolved) {
    const r = rec.resolved;
    lines.push(
      `${r.n} signal(s) resolved today: ${r.n_tp} hit target, ${r.n_sl} hit stop, ${r.n_expired} expired. ` +
        `Net realized P&L: $${r.total_pnl_dollars.toFixed(2)}.`
    );
  } else {
    lines.push("No signals resolved today.");
  }
  if (rec.calibration) {
    const c = rec.calibration;
    lines.push(
      `Calibration status: ${c.status}, predicted win rate ${fmtPct(c.avg_predicted_p_win)} vs ` +
        `realized win rate ${fmtPct(c.realized_win_rate)} (n=${c.n} resolved samples).`
    );
  }
  if (rec.current_price != null) {
    lines.push(`Current price: ${rec.current_price}` + (rec.new_signal ? ` (entry was ${rec.new_signal.entry_price})` : "."));
  }
  lines.push("Write a 2-4 sentence factual summary of how this symbol's signal(s) performed today relative to what was predicted.");
  return lines.join("\n");
}

function digestPrompt(stats: any, reportDate: string) {
  return [
    `Talaria signal accuracy report for ${reportDate}.`,
    `${stats.n_new} new qualified signal(s) issued today.`,
    `${stats.n_resolved} signal(s) resolved today: ${stats.n_tp} target / ${stats.n_sl} stop / ${stats.n_expired} expired ` +
      `(realized win rate ${fmtPct(stats.realized_win_rate)}).`,
    stats.benchmark_today != null
      ? `Fixed-risk benchmark: today's aggregate P&L $${stats.benchmark_today.toFixed(2)} across ${stats.benchmark_today_n} resolved ` +
        `signal(s); cumulative $${stats.benchmark_cumulative.toFixed(2)} across all history, ` +
        `expectancy $${stats.benchmark_expectancy.toFixed(2)} per signal.`
      : "No fixed-risk benchmark data resolved today.",
    `Calibration snapshot across ${stats.n_symbols_tracked} tracked symbols: ${stats.n_overconfident} OVERCONFIDENT, ` +
      `${stats.n_calibrated} CALIBRATED, ${stats.n_underconfident} UNDERCONFIDENT, ${stats.n_insufficient} INSUFFICIENT_DATA.`,
    `7-day rollup: ${stats.weekly_n} resolved signal-days sampled, mean predicted win rate ${fmtPct(stats.weekly_avg_predicted)} ` +
      `vs mean realized win rate ${fmtPct(stats.weekly_avg_realized)}.`,
    "Write a 3-5 sentence factual executive summary of today's signal accuracy referencing these numbers.",
  ].join("\n");
}

async function buildEodReport(reportDate: string) {
  const { start, end } = dayBounds(reportDate);
  const sevenDaysAgo = new Date(new Date(reportDate).getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [newRes, resolvedRes, calLatestRes, calWeeklyRes, benchmarkRes] = await Promise.all([
    supabase
      .from("nt_signal_sim")
      .select("symbol, signal, entry_price, stop_loss, take_profit, regime, p_win, ev, effective_kelly, ts")
      .eq("qualified", true)
      .gte("ts", start)
      .lt("ts", end)
      .order("ts", { ascending: false }),
    supabase
      .from("nt_signal_sim")
      .select("symbol, signal, outcome, pnl_dollars, resolved_at")
      .eq("qualified", true)
      .not("outcome", "is", null)
      .gte("resolved_at", start)
      .lt("resolved_at", end),
    supabase.from("v_eod_calibration_bias_latest").select("*"),
    supabase.from("v_eod_calibration_bias").select("symbol, day, avg_predicted_p_win, realized_win_rate, n").gte("day", sevenDaysAgo),
    supabase.from("v_talaria_fixed_basket_daily").select("*").order("day", { ascending: false }).limit(30),
  ]);

  const newSignals = newRes.data || [];
  const resolvedSignals = resolvedRes.data || [];
  const calLatest = calLatestRes.data || [];
  const calWeekly = calWeeklyRes.data || [];
  const benchmarkRows = benchmarkRes.data || [];

  const bySymbol = new Map<string, any>();
  const touch = (sym: string) => {
    if (!bySymbol.has(sym)) bySymbol.set(sym, { symbol: sym });
    return bySymbol.get(sym);
  };

  for (const row of newSignals) {
    const rec = touch(row.symbol);
    if (!rec.new_signal) rec.new_signal = row;
  }

  for (const row of resolvedSignals) {
    const rec = touch(row.symbol);
    if (!rec.resolved) rec.resolved = { n: 0, n_tp: 0, n_sl: 0, n_expired: 0, total_pnl_dollars: 0 };
    rec.resolved.n += 1;
    if (row.outcome === "tp_hit") rec.resolved.n_tp += 1;
    else if (row.outcome === "sl_hit") rec.resolved.n_sl += 1;
    else rec.resolved.n_expired += 1;
    rec.resolved.total_pnl_dollars += Number(row.pnl_dollars || 0);
  }

  const calLatestBySymbol = new Map(calLatest.map((c: any) => [c.symbol, c]));
  for (const [sym, rec] of bySymbol) {
    if (calLatestBySymbol.has(sym)) rec.calibration = calLatestBySymbol.get(sym);
  }

  const symbols = [...bySymbol.keys()];
  if (symbols.length > 0) {
    const { data: closes } = await supabase
      .from("v_talaria_daily_close")
      .select("symbol, session_date, close_price")
      .in("symbol", symbols)
      .order("session_date", { ascending: false });
    const latestClose = new Map<string, number>();
    for (const row of closes || []) {
      if (!latestClose.has(row.symbol)) latestClose.set(row.symbol, Number(row.close_price));
    }
    for (const [sym, rec] of bySymbol) {
      if (latestClose.has(sym)) rec.current_price = latestClose.get(sym);
    }
  }

  const perSymbol = await Promise.all(
    [...bySymbol.values()].map(async (rec) => {
      const { text, provider } = await generateCommentary(symbolPrompt(rec, reportDate));
      return { ...rec, commentary: text, commentary_provider: provider };
    })
  );
  perSymbol.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const n_tp = resolvedSignals.filter((r: any) => r.outcome === "tp_hit").length;
  const n_sl = resolvedSignals.filter((r: any) => r.outcome === "sl_hit").length;
  const n_expired = resolvedSignals.filter((r: any) => r.outcome === "expired").length;
  const n_decisive = n_tp + n_sl;
  const realized_win_rate = n_decisive > 0 ? n_tp / n_decisive : null;

  const statusCounts: Record<string, number> = { OVERCONFIDENT: 0, CALIBRATED: 0, UNDERCONFIDENT: 0, INSUFFICIENT_DATA: 0 };
  for (const c of calLatest as any[]) {
    if (statusCounts[c.status] != null) statusCounts[c.status] += 1;
  }

  const weeklyTotalN = calWeekly.reduce((sum: number, r: any) => sum + Number(r.n || 0), 0);
  const weightedPredicted = calWeekly.reduce((sum: number, r: any) => sum + Number(r.avg_predicted_p_win || 0) * Number(r.n || 0), 0);
  const weightedRealized = calWeekly.reduce((sum: number, r: any) => sum + Number(r.realized_win_rate || 0) * Number(r.n || 0), 0);

  const todayBenchmark = benchmarkRows.find((r: any) => r.day === reportDate) || null;
  const latestBenchmark = benchmarkRows[0] || null;

  const stats = {
    n_new: newSignals.length,
    n_resolved: resolvedSignals.length,
    n_tp,
    n_sl,
    n_expired,
    realized_win_rate,
    benchmark_today: todayBenchmark ? Number(todayBenchmark.pnl_fixed) : null,
    benchmark_today_n: todayBenchmark ? todayBenchmark.n_resolved : 0,
    benchmark_cumulative: latestBenchmark ? Number(latestBenchmark.cumulative_pnl_fixed) : null,
    benchmark_expectancy: latestBenchmark ? Number(latestBenchmark.cumulative_expectancy_per_signal) : null,
    n_symbols_tracked: calLatest.length,
    n_overconfident: statusCounts.OVERCONFIDENT,
    n_calibrated: statusCounts.CALIBRATED,
    n_underconfident: statusCounts.UNDERCONFIDENT,
    n_insufficient: statusCounts.INSUFFICIENT_DATA,
    weekly_n: weeklyTotalN,
    weekly_avg_predicted: weeklyTotalN > 0 ? weightedPredicted / weeklyTotalN : null,
    weekly_avg_realized: weeklyTotalN > 0 ? weightedRealized / weeklyTotalN : null,
  };

  const { text: digestSummary, provider: digestProvider } = await generateCommentary(digestPrompt(stats, reportDate));

  const payload = { report_date: reportDate, stats, per_symbol: perSymbol, digest_summary: digestSummary };

  const { error } = await supabase.from("v_eod_report").upsert({
    report_date: reportDate,
    generated_at: new Date().toISOString(),
    payload,
    llm_provider: digestProvider,
    error: digestSummary ? null : "LLM commentary unavailable (both providers failed or not configured)",
  });

  if (error) throw error;
  return payload;
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("x-internal-secret");
  const fromCron = req.headers.get("x-supabase-cron") === "true";
  if (!fromCron && (!INTERNAL_SECRET || secret !== INTERNAL_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let date = new Date().toISOString().slice(0, 10);
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.date) date = body.date;
  } catch {
    // no body — use today
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const payload = await buildEodReport(date);
    return Response.json({ ok: true, report_date: date, stats: payload.stats });
  } catch (e) {
    console.error("[eod-report-generate] failed:", e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
});
