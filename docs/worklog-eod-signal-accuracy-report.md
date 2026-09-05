# Worklog: EOD Signal Accuracy Report

> **Status:** Scoping
> **Date:** 2026-09-04
> **Repos in scope:** `nobletradingapp` only (Next.js UI + API routes + Supabase views).
> Supersedes the Hermes-agent/Discord prototype in the (now-abandoned)
> `nobletradingapp-eod-reports` directory — see §1 for why.

## 1. Why this is being rescoped

A prior prototype (Hermes cron job + one `delegate_task` subagent per symbol,
each doing live web search + TradingView browser automation + a Discord
post) was trialed on 2026-09-03. The run log shows it failing structurally,
not incidentally:

- **Browser automation (`browser_exec` against TradingView) failed in all 4
  subagents** — Chrome remote-debugging requires interactive user approval,
  which doesn't exist in a headless cron context. This isn't a bug to patch;
  computer-use tooling and autonomous cron jobs are incompatible by design.
- **Web research failed for 1 of 4 symbols** (no Firecrawl API key
  configured) and succeeded for the other 3 only because a second provider
  (Exa) happened to work.
- **Discord delivery itself failed** — gateway not configured — so results
  were written as loose JSON files instead of being delivered anywhere.
- **The reliable part was pure Supabase SQL** (`nt_sweep_result` where
  `qualified=true`, `v_talaria_symbols`, `v_eod_calibration_bias_latest`) —
  zero failures there. Every failure was in the web-scraping/browser layer
  bolted on top.

Separately, the thesis itself had a gap: the report's name promised
"vs market performance" but the implementation only computed close-vs-entry
delta — a signal-internal number, not a comparison to anything external —
and its "Assessment" language ("✅ Well-supported SELL signal... caution
warranted") read as investment-advice/endorsement, not validation.

## 2. Reframed purpose (this is the load-bearing change)

**This is not a trading or investment advice product.** Its purpose is to
validate the accuracy and precision of Talaria's qualified signals — a
report card on the model, not a recommendation of what to do next. That's
also the reason for the "Talaria" name (precision/tracking) and it should be
legible in every piece of copy the report produces: past-tense, factual,
comparing *prediction* to *realized outcome* — never "you should have,"
never a green-checkmark endorsement.

Concretely: instead of "Assessment: ✅ Well-supported SELL signal," the
report says things like "Predicted win probability 49.6%; outcome: SL hit
(loss). This bucket's calibration bias is currently OVERCONFIDENT (realized
win rate 0% vs 49.6% predicted) — 3 resolved signals so far this week."
Same underlying numbers, validation framing instead of advice framing.

## 3. Design

### 3.1 Two temporal sections, not one

The prior design conflated "issued today" with "how did it do" using a
same-day price snapshot, which can't actually answer that — most signals
take multiple bars to resolve (`EXPIRY_BARS=48` hourly bars in the EOD
resolver). Split explicitly:

- **New today** — signals that qualified today. Regime, EV, effective
  Kelly, p_win, entry/SL/TP at signal time, and current price via
  `v_talaria_daily_close` (already built for the correlation heatmap this
  session — no browser needed, it's a real Supabase view over
  `nt_renko_bricks`).
- **Resolved today** — `nt_signal_sim` rows whose `outcome` flipped to
  `tp_hit`/`sl_hit`/`expired` today, regardless of when they were issued.
  This is the actual accuracy verdict: predicted `p_win`/`ev` vs realized
  outcome/`pnl_dollars`. Already computed by the existing EOD resolver
  pipeline — this section is a pure read, no new compute.

### 3.2 Accuracy metrics (the "validate precision" core)

Per resolved signal: predicted `p_win` vs binary outcome, predicted `ev` vs
realized `pnl_dollars`, and the symbol's current calibration status
(`v_eod_calibration_bias_latest` — CALIBRATED / OVERCONFIDENT /
UNDERCONFIDENT, already computed). Aggregate for the day: qualified count,
resolved count, realized win rate vs mean predicted `p_win`, and how many
symbols are currently flagged OVERCONFIDENT/UNDERCONFIDENT. All of this is
existing data — the report is a new *view* of it, not new math.

### 3.3 "Vs market performance" — give it a real benchmark

**Decided:** build the fixed-basket equity view now, as a co-requisite —
not deferred. `docs/worklog-fixed-basket-portfolio-view.md` (scoped
2026-09-03, not yet built) is the dependency: a fixed-risk-normalized basket
tracking cumulative equity from every qualified signal is exactly the "vs
market" number this report needs — "today's qualified signals returned
+0.4% on a fixed-risk basis, cumulative basket return is +X% this month."
That worklog already has its own resolved decisions (risk-normalized sizing,
$1,000 baseline, 1M/3M/6M/YTD/MAX ranges) — this report consumes whatever
Supabase view that work produces rather than recomputing anything. **Build
order implication**: the basket equity view should land before or alongside
this report, since both the dashboard Portfolio-tab replacement and this
report need the same underlying computation — build it once, shared.

### 3.4 LLM commentary — the value-add, and it must be cached, not regenerated

**Yes, this needs a persistent cache — this was the right thing to flag.**
The report is a shared daily digest, not personalized per user beyond plan
scoping (Signal Scout vs Precision Pro see the same content). If commentary
generation were wired to page views, hundreds of subscribers loading the
report would trigger hundreds of duplicate LLM calls for the *identical*
content — pure waste, and exactly the failure mode of the reference
implementation's in-process cache (`getCached`/`setCache` resets on every
serverless cold start, and only dedupes within one warm instance, not across
users hitting different instances).

**Fix: generate once, at EOD build time, and serve every subsequent read
from storage — never call the LLM in response to a user request.** This
also directly answers the "does it get regenerated" question: no, by
construction, if the report is built once (server-side, at or after the EOD
cutoff) and every viewer/API call reads the stored result.

- **Provider order: OpenRouter first, NVIDIA NIM as fallback** (corrected
  from the earlier Groq suggestion). Both are OpenAI-compatible HTTP APIs
  (NVIDIA NIM via `https://integrate.api.nvidia.com/v1`), so the reference
  implementation's try/catch/fallback structure ports directly, just with a
  different second client.
- **Generation granularity: one commentary per symbol, plus one whole-digest
  summary.** Per-symbol commentary covers each resolved/new signal
  individually; the digest-level summary is a second, separate LLM call (or
  the same call structured to return both) that rolls the day up — "12
  qualified today, 8 resolved (5 TP / 2 SL / 1 expired), overall calibration
  trending OVERCONFIDENT this week." Both generated once at build time, both
  cached.
- **Prompt inputs**: symbol, regime, predicted `p_win`/`ev`/effective Kelly,
  actual outcome (`tp_hit`/`sl_hit`/`expired`), realized `pnl_dollars`,
  calibration bias/status. Nothing web-sourced.
- **System prompt must enforce the reframe explicitly** — e.g.: *"You are
  writing a factual accuracy report for a signal-validation tool, not
  investment advice. Describe only what was predicted and what actually
  happened, in past tense. Never recommend an action, never use words like
  'should,' 'buy,' or 'sell' as a directive."* This is the load-bearing
  guardrail given §2 — worth testing that the model actually honors it
  before shipping, not just trusting the instruction (cheap/free models are
  more likely to drift off-instruction than a frontier model — another
  reason to verify output, not just prompt and assume).
- **Storage**: a new Supabase table + 1:1 view (same pattern as
  `nt_correlation_cache`/`v_correlation_cache`, service_role-scoped, `TO
  service_role` explicit on the RLS policy from the start this time) — one
  row per `(symbol, day)` for per-symbol commentary, one row per `day` for
  the digest summary. This is real persistent storage, not a request-time
  cache with a TTL — once written for a given day, it's immutable (the day
  already happened), so there's no expiry logic needed on the write side.

### 3.5 Delivery

**Decided: website only for v1; email parked until after website testing
is confirmed working.** Removes the AgentMail/Edge-Function-cron piece from
this pass entirely — revisit once the website version is validated.

- **Website**: a new dashboard section/tab or a `/reports/[date]` page,
  reading the same Supabase views the rest of the dashboard already uses —
  no new infrastructure class. Must include a visible note that reports are
  generated once at end-of-day and do not refresh intraday (see §3.6 on
  historical reports — this is also where that expectation gets set for
  the user, e.g. "Today's report generates after market close — check back
  then" if viewed before the EOD job has run for the current day).

### 3.6 Historical reports — Supabase rows, not markdown files, and no TTL needed

Raised: should old reports be kept as `.md` files with a 7-day TTL, or is
that unnecessary? Two issues with the file-based version specifically:

1. **It won't work in production.** This app deploys to a serverless host
   (Vercel) — the filesystem is ephemeral per invocation/deployment, so
   writing `.md` files to local disk doesn't persist the way it did in the
   local Hermes-agent prototype. Anything meant to survive has to be
   Supabase (or object storage), not local files.
2. **A TTL isn't actually necessary once it's in Supabase.** Storing rows
   indefinitely is cheap (this is small structured/text data, not media),
   and unlike flat files there's no manual cleanup burden — "how far back
   can a user browse" becomes a UI/query decision (e.g., default view shows
   today, a "history" affordance queries the last 7 days), not a storage
   lifecycle decision. **Recommendation: keep all rows, no deletion job;
   just cap how far back the UI lets someone navigate if that matters for
   UX.** Simpler than building and maintaining an expiry mechanism for
   something storage-cheap enough not to need one.

### 3.7 Data sources (all existing, all Supabase, zero browser/web dependency)

- `nt_sweep_result` / `v_talaria_latest_signals` — qualified signals issued today.
- `nt_signal_sim` — resolved-today signals (`outcome`, `pnl_bricks`, `pnl_dollars`).
- `v_eod_calibration_bias_latest` / `v_eod_calibration_bias` — calibration status
  (7-day window already computed — feeds the weekly rollup in §3.8 directly).
- `v_talaria_daily_close` — current/EOD price (migration 0011, this session).
- `v_talaria_symbols` — plan scoping + metadata.
- *(dependency, not yet built)* the fixed-basket equity view, per §3.3.
- *(new)* an EOD-report cache table/view pair, per §3.4.

### 3.8 Cadence

**Decided: daily, with a weekly summary.** The weekly rollup reuses
`v_eod_calibration_bias`'s existing 7-day window computation — no new
aggregation logic needed for that part, just a presentation layer over data
that's already there.

## 4. New configuration

- `OPENROUTER_API_KEY` — server-only, no `NEXT_PUBLIC_` prefix.
- `NVIDIA_NIM_API_KEY` — server-only, fallback provider.
- **Model choice: lowest-cost free-tier model on each platform, for
  testing.** OpenRouter's `:free`-suffixed model variants (e.g. a Llama or
  Gemini free variant — exact model IDs shift over time, confirm current
  availability at build time rather than trusting names written here) and
  NVIDIA NIM's free API-catalog tier (`integrate.api.nvidia.com`, e.g. a
  Llama/Nemotron free-tier model). Both platforms rotate which models are
  free, so pin the actual model ID as a config value (not hardcoded deep in
  logic) so it's a one-line change when availability shifts.

## 5. Decisions (resolved 2026-09-04)

1. **Benchmark** — build the fixed-basket equity view now, shared with the
   Portfolio-tab worklog. See §3.3.
2. **LLM generation** — one commentary per symbol + one whole-digest
   summary, generated once at EOD build time, stored in Supabase, never
   regenerated per view. See §3.4.
3. **Delivery** — website first; email parked until website is confirmed
   working in testing. See §3.5.
4. **Model choice** — lowest-cost free-tier model on OpenRouter and on
   NVIDIA NIM, for testing; pin as config, expect to revisit. See §4.
5. **Compliance copy** — confirmed: a legal disclaimer banner on the report,
   linking to `/disclaimer`, is in scope. Should be visually persistent (not
   a dismiss-once toast), consistent with the "not investment advice"
   framing in §2.
6. **Cadence** — daily, with a weekly summary reusing the existing 7-day
   calibration window. See §3.8.

## 6. Non-goals

- No web research / news scraping (structurally unreliable in any
  automated context, not just cron — see §1).
- No browser/TradingView automation.
- No Discord delivery — the Hermes/Discord prototype is superseded, not
  extended or repaired.
- Not a "what to trade next" recommendation engine — see §2, this is the
  one rule everything else in this doc has to respect.

---

*Scoping complete — all six decisions in §5 resolved. No implementation
started. Build order: the fixed-basket equity view (§3.3) first — shared
with the Portfolio-tab worklog — then this report.*
