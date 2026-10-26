"use client"

/* ---------------------------------------------------------------------------
 * DesignSpec — the standalone TSFM training-model design (the deliverable).
 * §1 benchmark · §2 quantiles & scoring · §3 covariate taxonomy (17 channels,
 * grouped by availability class) · §4 multivariates · §5 forecast windows ·
 * §6 the real-model arm (Timestral-5M contract + deafness ablation) ·
 * §7 baselines & gates · §8 report schema · honesty ledger.
 *
 * Ported from shadcn/accordion primitives to native <details> + daisyUI badges.
 * ------------------------------------------------------------------------- */

import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import { COVARIATES, MODELS, type CovClass } from "@/lib/tsfm-lab/design"

const CLS_STYLE: Record<string, string> = {
  target: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  past: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  "known-future": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  categorical: "bg-violet-500/15 text-violet-300 border-violet-500/30",
}

/** §3 render order — target first, then the availability classes. */
const CLS_ORDER: { cls: CovClass; label: string; test: string }[] = [
  { cls: "target", label: "target", test: "the series being forecast — always on" },
  { cls: "past", label: "past-only", test: "computable at T, unknowable beyond — the unknowable future" },
  { cls: "categorical", label: "categorical", test: "conditioned on, never forecast as a number" },
  {
    cls: "known-future",
    label: "known-future",
    test: "writable for every future timestamp today — the zero-uncertainty future",
  },
]

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-neutral-800 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </th>
  )
}

function Td({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-neutral-800/60 px-3 py-2 align-top text-[12.5px] text-slate-300",
        mono && "font-mono text-[11.5px]",
      )}
    >
      {children}
    </td>
  )
}

export function DesignSpec() {
  return (
    <div className="space-y-2">
      {/* section 1 — benchmark dataset */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">§1 · Benchmark dataset</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-3">
          <p>
            One tier, five real symbols — <em className="text-slate-200">"weak" is only measurable against a bar, and the bar is
            domain-conditional</em>. Every lane is real broker data (hourly, 2024→2026, ≈13.7k–17.5k bars per symbol); the R1
            synthetic power control proved the harness and is now retired.
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Class</Th>
                <Th>Series</Th>
                <Th>Role</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Crypto</Td>
                <Td mono>BTCUSD (24/7)</Td>
                <Td>The efficient-market lane — the random walk is the bar; where "truly weak" gets confirmed or refuted, and where the real Timestral-5M gate lives.</Td>
              </tr>
              <tr>
                <Td>FX majors</Td>
                <Td mono>USDJPY · USDCHF</Td>
                <Td>Session-structured, weekend gaps — the deepest liquidity on earth.</Td>
              </tr>
              <tr>
                <Td>Metals</Td>
                <Td mono>XAUUSD · XAGUSD</Td>
                <Td>Spot gold/silver — home of the vol lane (the Log-HAR bar).</Td>
              </tr>
            </tbody>
          </table>
          <p>
            <span className="text-slate-200">Splits:</span> rolling-origin — final 90 days, one origin per 24h (≈87–89 origins per horizon);
            models frozen at eval start; <span className="font-mono text-[11.5px]">train_end = first_origin − 72 bars</span> (embargo = max horizon).
            No shuffling, no lookahead: every covariate is point-in-time (availability classes in §3).
          </p>
        </div>
      </details>

      {/* section 2 — quantiles & scoring */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">§2 · Quantiles &amp; scoring</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-200">Grid (7):</span>
            {[5, 10, 25, 50, 75, 90, 95].map((q) => (
              <span key={q} className="badge badge-outline font-mono border-orange-500/30 text-orange-300">
                τ{q}
              </span>
            ))}
          </div>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <span className="text-slate-200">Pinball loss</span> per τ; <span className="text-slate-200">CRPS ≈ 2 × mean pinball</span> over the grid (proper scoring).
            </li>
            <li>
              <span className="text-slate-200">Intervals:</span> central 50% (τ25–τ75), 80% (τ10–τ90), 90% (τ05–τ95) — empirical coverage + mean width reported per interval.
            </li>
            <li>
              <span className="text-slate-200">PIT histogram</span> (20 bins): uniform ⇒ calibrated; U-shape ⇒ over-confident; hump ⇒ hedging.
            </li>
            <li>
              <span className="text-slate-200">Point forecast = the τ50 median</span> (never the mean — quantile heads are median-trained).
            </li>
            <li>
              <span className="text-slate-200">Direction:</span> P(up) = 1 − F(close<sub>T</sub>) from the monotone fan CDF — the honest derivation, vs the legacy sigmoid(rel_change) hack.
            </li>
            <li>
              <span className="text-slate-200">Significance:</span> Diebold–Mariano on paired per-origin losses, Newey–West variance (lag ⌈H/24⌉+1).
            </li>
          </ul>
        </div>
      </details>

      {/* section 3 — covariate taxonomy — 17 financial channels */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">§3 · Covariate taxonomy — 17 financial channels</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-3">
          <p>
            Four-class taxonomy over 17 financial channels, every channel carrying an availability class. The membership test is
            mechanical:
            <span className="text-slate-200"> "Can I write its future values down today, zero uncertainty? yes → known-future; no → past-only."</span>
          </p>
          {/* membership-test legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2">
            {CLS_ORDER.map((g) => (
              <span key={g.cls} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "badge badge-outline h-5 px-1.5 text-[9px] uppercase",
                    CLS_STYLE[g.cls],
                  )}
                >
                  {g.label}
                </span>
                <span className="text-[11px] text-slate-500">{g.test}</span>
              </span>
            ))}
          </div>
          {CLS_ORDER.map((g) => {
            const rows = COVARIATES.filter((c) => c.cls === g.cls)
            if (!rows.length) return null
            return (
              <div key={g.cls}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "badge badge-outline h-5 px-1.5 text-[9px] uppercase",
                      CLS_STYLE[g.cls],
                    )}
                  >
                    {g.label}
                  </span>
                  <span className="font-mono text-[10.5px] text-slate-500">
                    {rows.length} channel{rows.length === 1 ? "" : "s"}
                  </span>
                </div>
                <table className="mt-1 w-full border-collapse">
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.key}>
                        <Td>
                          <span className="text-slate-200">{c.label}</span>{" "}
                          <span className="font-mono text-[10.5px] text-slate-500">{c.key}</span>
                        </Td>
                        <Td>{c.desc}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
          <p className="text-[12px] text-slate-500">
            The M0–M3 conditioning ladder (univariate → +past-only → +known-future → full) is selectable in the lab header; the
            shuffle ablation (§6) decides whether a channel was actually being read, and the per-covariate LOO Δ-CRPS in the lab
            panel is its finer-grained view. In the vol lane, RV lags are the target&apos;s own memory — locked, not ablatable.
          </p>
        </div>
      </details>

      {/* section 4 — multivariates — regime, trend, shift, next tick */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">§4 · Multivariates — regime, trend, shift, next tick</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-2.5">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Multivariate</Th>
                <Th>Treatment</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Regime</Td>
                <Td>
                  NOT forecast as a number. A 3-state trend×vol label enters as a <em>categorical covariate</em>; the fan conditions on it;
                  reports slice coverage/skill by regime. (The categorical seat the STRIDE review assigned to LLMs — categorical clothing, no
                  number hallucination.)
                </Td>
              </tr>
              <tr>
                <Td>Trend</Td>
                <Td>
                  168h rolling regression slope — a <em>past covariate</em> plus a chart overlay. The fan&apos;s median drift is the measured
                  trend response, not an assertion.
                </Td>
              </tr>
              <tr>
                <Td>Shift</Td>
                <Td>
                  CUSUM level-shift detection — a <em>diagnostic column</em> (marks on the chart, changepoint density per symbol). Shifts
                  gate recalibration windows in the real deployment.
                </Td>
              </tr>
              <tr>
                <Td>Next tick</Td>
                <Td>
                  H=1 is a first-class window: the 1-hour quantile vector is the next-tick forecast; P(up) comes off its CDF. The lab
                  measures it against the coin — it does not assume it. (True 1-minute T1 needs a second bar size — designed, not wired.)
                </Td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      {/* section 5 — forecast window */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">§5 · Forecast window</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-2">
          <div className="flex flex-wrap gap-2">
            {[
              ["H = 1", "next tick — the noisiest, the probe's home turf"],
              ["H = 6", "intraday"],
              ["H = 24", "canonical — matches RV24 & the sweep cadence"],
              ["H = 72", "the refined-thesis horizon"],
            ].map(([h, note]) => (
              <div key={h} className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2">
                <p className="font-mono text-[12px] text-orange-300">{h}</p>
                <p className="text-[11px] text-slate-500">{note}</p>
              </div>
            ))}
          </div>
          <p>
            Direct (H, τ) heads per window — no recursive rollout. The fan shows all steps 1..H (direct heads at anchor steps,
            interpolated for display only); metrics are scored at h = H exactly.
          </p>
        </div>
      </details>

      {/* section 6 — the real-model arm — Timestral-5M contract */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">§6 · The real-model arm — Timestral-5M contract</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-3">
          <p>
            The REAL foundation-model arm is live: <span className="text-orange-300">Mistral Timestral-5M</span>, zero-shot, served by a
            Python sidecar on <span className="font-mono text-[11.5px]">:3030</span> (mini-services/tsfm-sidecar) from real weights —
            never fine-tuned on these symbols. The harness, targets, covariates, gates, and report schema are unchanged by the swap.
          </p>
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <Th>Weights</Th>
                <Td mono>mistralai/Timestral-5M — 5,208,960 params (5.2M), fp32 CPU torch, load ≈ 1.7 s</Td>
              </tr>
              <tr>
                <Th>Architecture</Th>
                <Td mono>patch 32 · d_model 192 · 6× time-attn + 2× time-variate-attn blocks · context 32,768 steps</Td>
              </tr>
              <tr>
                <Th>Output head</Th>
                <Td mono>21 native quantile knots → the 7-τ harness grid (τ0.05…τ0.95) — monotone CDF, symmetric averaging</Td>
              </tr>
              <tr>
                <Th>Covariates (native)</Th>
                <Td mono>past-only channels → past_covariates · known-future → known_covariates over T+H (matched by name, NaN context for future-only rows)</Td>
              </tr>
              <tr>
                <Th>Serving</Th>
                <Td mono>POST /forecast {"{ target[], pastCovariates, futureCovariates, horizon }"} → quantiles[H][21] · ≈10–40 ms · history ≤ 4096 steps server-side</Td>
              </tr>
              <tr>
                <Th>Next (runbook)</Th>
                <Td mono>size ladder 28M–209M (TimesFM-2.5-class) + LoRA fine-tuned arms — same harness, same gates, byte-identical report schema</Td>
              </tr>
            </tbody>
          </table>
          <p>
            <span className="text-slate-200">The deafness ablation:</span> the eval route circularly shuffles each covariate block
            (past-only, known-future) and re-measures CRPS. Δ-CRPS &gt; 0 ⇒ the model was reading the channel (shuffling hurt);
            Δ ≈ 0 or negative ⇒ covariate-deaf on this view. The control is "wrong values, right distribution" — a model
            that ignores its inputs still looks calm.
          </p>
          <p className="text-[12px] text-slate-500">
            The M0–M3 conditioning presets (§3) are the same ablation from the front side: univariate → +past-only → +known-future → full,
            selectable per view in the lab header; the ridge stand-in arms stay available as the always-on fallback when the sidecar is down.
          </p>
        </div>
      </details>

      {/* section 7 — baselines & gates */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">§7 · Baselines &amp; gates</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-2">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Model arm</Th>
                <Th>Bar it represents</Th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <span
                      className={cn(
                        m.id === "timestral" || m.id.startsWith("tsfm") ? "text-orange-300" : "text-slate-300",
                      )}
                    >
                      {m.label}
                    </span>
                  </Td>
                  <Td>{m.desc}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Gate per (target, bar): financial price must beat the random walk; vol must beat Log-HAR; direction must beat the coin
            (Brier &lt; 0.25). Pass requires DM p &lt; 0.05 — a point estimate without significance is reported UNDECIDED, never PASS.
            Calibration (±5pp of nominal coverage) and covariate use (shuffle Δ-CRPS, §6) gate the verdict separately — a model can be
            calibrated yet unskilled, and neither excuse passes a deafness test.
          </p>
        </div>
      </details>

      {/* section 8 — report / output schema */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">§8 · Report / output schema</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-2">
          <p>
            The live API contract <em>is</em> the report schema — every field below is produced per cutoff, per symbol, per target:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 font-mono text-[11.5px]">
            <li>
              <span className="text-orange-300">price panel</span> — history + median path + 50/80/90% fans + post-hoc actual overlay +
              regime shading + shift marks
            </li>
            <li>
              <span className="text-orange-300">quantile table</span> — 7τ values at h=H, pinball per τ, rolling empirical coverage
            </li>
            <li>
              <span className="text-orange-300">covariate report</span> — class, last value, sparkline (+future for known-future),
              leave-one-out Δ-CRPS
            </li>
            <li>
              <span className="text-orange-300">direction card</span> — P(up) off the fan CDF, actual outcome, rolling Brier/accuracy
            </li>
            <li>
              <span className="text-orange-300">vol card</span> — log-RV quantile fan, QLIKE/CRPS, HAR comparison
            </li>
            <li>
              <span className="text-orange-300">deafness ablation</span> — shuffle Δ-CRPS per covariate block (past-only / known-future) +
              per-arm PIT histograms
            </li>
            <li>
              <span className="text-orange-300">skill table</span> — model × baseline × horizon: CRPS ratio, coverage delta, DM z/p
            </li>
            <li>
              <span className="text-orange-300">verdict</span> — gate, PASS/FAIL/UNDECIDED, one-line evidence summary
            </li>
          </ul>
        </div>
      </details>

      {/* honesty ledger — what is real here */}
      <details className="border border-neutral-800 rounded-lg px-4 bg-neutral-900/30">
        <summary className="text-[15px] font-semibold text-slate-100 py-3.5">Honesty ledger — what is real here</summary>
        <div className="text-[13px] leading-relaxed text-slate-400 space-y-2">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Real</Th>
                <Th>Stand-in</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>
                  The 5 financial series (broker hourly OHLCV); the rolling-origin protocol with embargo; all baselines; every metric
                  (pinball, CRPS, coverage, PIT, DM); covariate taxonomy; the gates; the report schema — and the Timestral-5M arm:
                  real zero-shot weights via the :3030 sidecar, scored by the same harness as everything else.
                </Td>
                <Td>
                  The "Ridge stand-in" arms (covariates ON / univariate) are covariate-conditioned quantile heads — they keep
                  the lab interactive when the sidecar is offline and demonstrate the conditioning math + LOO ablation. They are clearly
                  labeled wherever they appear; when Timestral-5M is unavailable the eval table says so, in the open.
                </Td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
