// SignalContextCard — claims-layer rendering (Phase C, 2026-10-28).
//
// worklog/docs/worklog-kairos-claims.md + the backend design doc
// (kairos-backend worklog/20261027_KAIROS_CLAIMS_LAYER_DESIGN.md §2-§3):
// the dashboard used to show the bracket (ENTRY/SL/TP points + a claimed
// p_win) OUTSIDE its distribution. This card joins them: the registered
// claim's quantile fan renders with the live bracket drawn ON it, plus the
// fan-space positions of the levels ("TP at the fan's q88 · SL at q12") and
// the probabilities claimed at qualification.
//
// Data: `sweepRow.claim` — arrives through BOTH transport paths unchanged:
//   * the realtime broadcast `signal` event (Phase B: optional `claim`
//     object attached after the ledger write persisted), and
//   * /api/dashboard-data sweeps rows (Phase B: migration 219's
//     v_talaria_latest_signals `claim` column — latest claim per symbol,
//     including resolved outcomes).
// The claim is PRICE space at the boundary (backend converts once at
// registration) — NEVER rescaled here (the lab's fan-axis bug class).
//
// Honesty rules (this card is a claims surface, not a sales surface):
//   * the fan is a PRE-REGISTERED prediction, frozen at qualification and
//     scored at resolution through the same settlement contract — not live
//     state, not advice;
//   * `atr_normal` is the BASELINE control arm (zero drift, √h scaling), the
//     arm the Phase-D recalibrated vol fans must beat — labelled, not hidden;
//   * no claim → an explicit empty state explaining why (never a fake fan);
//   * outcome section appears only after the resolver scored the claim.
//
// MT5/EA/talaria-copy consumers never see this card (frontend-only; the
// backend keeps SIGNAL_COLUMNS minimal — design §1 transport contract).

"use client";

import { useMemo } from "react";

// Dual-name fallback getter (rankOf/stateOf precedent — absorbs backend
// name drift): the claim object on a signal row.
export function claimOf(s) {
  const c = s?.claim ?? s?.signal_claim ?? null;
  return c && typeof c === "object" ? c : null;
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(v) >= 100) return "$" + v.toFixed(2);
  if (Math.abs(v) >= 10) return "$" + v.toFixed(3);
  return "$" + v.toFixed(4);
}

function fmtPct(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return (Number(n) * 100).toFixed(digits) + "%";
}

function fmtQ(q) {
  if (q == null || Number.isNaN(Number(q))) return "—";
  return "q" + Math.round(Number(q) * 100);
}

// ISO timestamp → "YYYY-MM-DD HH:mm" (pure string slice — no Date object,
// react-hooks/purity).
function fmtTs(iso) {
  if (!iso || typeof iso !== "string") return "—";
  return iso.slice(0, 16).replace("T", " ") + "Z";
}

function Row({ label, value, className = "", title }) {
  return (
    <div className="flex justify-between items-baseline" title={title}>
      <span className="opacity-70">{label}</span>
      <span className={`font-mono ${className}`}>{value}</span>
    </div>
  );
}

const FAN_KEYS = ["q05", "q10", "q25", "q50", "q75", "q90", "q95"];
const BANDS = [
  { key: "90%", lo: "q05", hi: "q95", opacity: 0.10 },
  { key: "80%", lo: "q10", hi: "q90", opacity: 0.17 },
  { key: "50%", lo: "q25", hi: "q75", opacity: 0.30 },
];

function fmtAxis(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (Math.abs(n) >= 100) return n.toFixed(1);
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}

// The fan chart — a compact port of components/tsfm-lab/fan-chart.tsx
// (bandPath/medianPath geometry) re-keyed for claim fans: x is the hour
// offset h (anchor at h=0), y is PRICE space verbatim (no log lift — the
// claim is already price space at the boundary). Bracket levels render as
// the RenkoSection dashed-line idiom (position-based colors: ENTRY neutral,
// SL error, TP success).
function ClaimFanChart({ claim }) {
  const geom = useMemo(() => {
    const fan = (claim?.fan || []).filter(
      (r) => r && Number.isFinite(Number(r.h)) && FAN_KEYS.some((k) => Number.isFinite(Number(r[k])))
    );
    if (fan.length < 2) return null;

    const W = 560;
    const H = 240;
    const PAD = { l: 66, r: 64, t: 14, b: 26 };
    const hMax = Math.max(...fan.map((r) => Number(r.h)));
    const br = claim?.bracket_ref || {};
    const levels = [
      { label: "ENTRY", price: Number(br.entry), fill: "var(--color-base-content)", fillOpacity: 0.75 },
      { label: "SL", price: Number(br.sl), fill: "var(--color-error)", fillOpacity: 0.9 },
      { label: "TP", price: Number(br.tp), fill: "var(--color-success)", fillOpacity: 0.9 },
    ].filter((l) => Number.isFinite(l.price));

    let lo = Infinity;
    let hi = -Infinity;
    for (const r of fan) {
      for (const k of FAN_KEYS) {
        const v = Number(r[k]);
        if (Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    for (const l of levels) {
      lo = Math.min(lo, l.price);
      hi = Math.max(hi, l.price);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null;
    const pad = (hi - lo) * 0.05;
    lo -= pad;
    hi += pad;

    const x = (h) => PAD.l + (Number(h) / hMax) * (W - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

    // Anchor: the entry price at h=0 (the fan is entry-anchored by
    // construction); fall back to the first row's median.
    const anchorV = Number.isFinite(Number(br.entry)) ? Number(br.entry) : Number(fan[0].q50);
    const anchor = `${x(0).toFixed(1)},${y(anchorV).toFixed(1)}`;

    const bandPath = (loKey, hiKey) => {
      const pts = [`M${anchor}`];
      for (const r of fan) {
        const v = Number(r[hiKey]);
        if (Number.isFinite(v)) pts.push(`L${x(r.h).toFixed(1)},${y(v).toFixed(1)}`);
      }
      for (let i = fan.length - 1; i >= 0; i--) {
        const v = Number(fan[i][loKey]);
        if (Number.isFinite(v)) pts.push(`L${x(fan[i].h).toFixed(1)},${y(v).toFixed(1)}`);
      }
      pts.push(`L${anchor}`);
      return pts.join("");
    };

    const medianPts = [`M${anchor}`];
    for (const r of fan) {
      const v = Number(r.q50);
      if (Number.isFinite(v)) medianPts.push(`L${x(r.h).toFixed(1)},${y(v).toFixed(1)}`);
    }

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const v = lo + t * (hi - lo);
      return { v, yv: y(v), label: fmtAxis(v) };
    });
    const hStep = hMax / 4;
    const hTicks = [0, 1, 2, 3, 4].map((i) => {
      const h = Math.round((hStep * i) / 1);
      return { h, xv: x(h), label: `+${h}h` };
    });

    return { W, H, PAD, levels, bandPath, medianPts, x, y, yTicks, hTicks, anchorPt: anchor, hMax };
  }, [claim]);

  if (!geom) return null;

  const { W, H, PAD, levels, bandPath, medianPts, yTicks, hTicks } = geom;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Registered claim fan chart: quantile bands with ENTRY, SL and TP levels"
    >
      {/* y gridlines + labels */}
      {yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line
            x1={PAD.l} x2={W - PAD.r} y1={t.yv} y2={t.yv}
            stroke="var(--color-base-content)" strokeOpacity={0.10} strokeWidth={1}
          />
          <text
            x={PAD.l - 6} y={t.yv + 3} textAnchor="end"
            fill="var(--color-base-content)" fillOpacity={0.55}
            fontSize={9} fontFamily="var(--font-geist-mono, monospace)"
          >
            {t.label}
          </text>
        </g>
      ))}
      {/* x ticks */}
      {hTicks.map((t, i) => (
        <text
          key={`x${i}`}
          x={t.xv} y={H - 8} textAnchor="middle"
          fill="var(--color-base-content)" fillOpacity={0.55}
          fontSize={9} fontFamily="var(--font-geist-mono, monospace)"
        >
          {t.label}
        </text>
      ))}

      {/* quantile bands (tsfm-lab band tiers, theme primary) */}
      {BANDS.map((b) => (
        <path
          key={b.key}
          d={bandPath(b.lo, b.hi)}
          fill="var(--color-primary)"
          fillOpacity={b.opacity}
        />
      ))}
      {/* median */}
      <polyline
        points={medianPts.join(" ")}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={1.8}
        strokeOpacity={0.9}
      />

      {/* bracket levels — RenkoSection dashed-line idiom, right-edge labels */}
      {levels.map((l) => (
        <g key={l.label}>
          <line
            x1={PAD.l} x2={W - PAD.r}
            y1={geom.y(l.price)} y2={geom.y(l.price)}
            stroke={l.fill} strokeOpacity={l.fillOpacity}
            strokeWidth={1.2} strokeDasharray="4 2"
          />
          <text
            x={W - 6} y={geom.y(l.price) - 3} textAnchor="end"
            fill={l.fill} fillOpacity={0.9}
            fontSize={8} fontFamily="var(--font-geist-mono, monospace)" fontWeight={600}
          >
            {l.label} {fmtAxis(l.price)}
          </text>
        </g>
      ))}

      {/* anchor dot: entry at h=0 */}
      <circle
        cx={geom.anchorPt.split(",")[0]}
        cy={geom.anchorPt.split(",")[1]}
        r={3}
        fill="var(--color-base-content)"
      />
    </svg>
  );
}

function CoverageChip({ label, value, nominal }) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const v = Number(value);
  const off = Math.abs(v - nominal);
  const tone = off <= 0.05 ? "text-success" : off <= 0.10 ? "text-warning" : "text-error";
  return (
    <span
      className={`badge badge-sm badge-ghost font-mono ${tone}`}
      title={`nominal ${Math.round(nominal * 100)}% — empirical central-band coverage of the fan across the scored window`}
    >
      {label} {v.toFixed(2)}
    </span>
  );
}

export default function SignalContextCard({ sweepRow }) {
  const claim = claimOf(sweepRow);
  const symbol = sweepRow?.symbol;

  if (!sweepRow || !symbol) return null;

  const br = claim?.bracket_ref || {};
  const probs = claim?.claimed_probs || {};
  const outcome = claim?.outcome || null;
  const status = String(claim?.status || "open").toLowerCase();
  const isResolved = status === "resolved" && outcome && typeof outcome === "object";

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h3 className="card-title text-lg">Signal Context — Registered Fan</h3>
          <span className="mx-1 font-semibold badge badge-primary">{symbol}</span>
          {claim ? (
            <span
              className={`badge badge-sm font-mono ${
                status === "open" ? "badge-warning" : status === "resolved" ? "badge-success" : "badge-ghost"
              }`}
              title="Claim status in the nt_signal_claims ledger: open = awaiting resolution; resolved = scored by the settlement contract; void = expired un-scored"
            >
              {status.toUpperCase()}
            </span>
          ) : null}
          {claim?.kind && (
            <span className="badge badge-sm badge-ghost font-mono" title="Claim kind (bracket = the live ENTRY/SL/TP pre-registered as a falsifiable claim)">
              {claim.kind}
            </span>
          )}
          {claim?.source && (
            <span
              className="badge badge-sm badge-ghost font-mono"
              title="Fan provenance, frozen at registration. atr_normal = the house ATR normal-approximation baseline (zero drift, √h scaling) — the control arm the Phase-D recalibrated vol fans must beat, not an edge."
            >
              {claim.source}
            </span>
          )}
          {claim?.horizon_h != null && (
            <span className="badge badge-sm badge-ghost font-mono" title="Fan horizon in hours = the settlement window (48 bars)">
              {Math.round(Number(claim.horizon_h))}h
            </span>
          )}
          {br.tp_q != null && br.sl_q != null && (
            <span
              className="badge badge-sm badge-secondary font-mono"
              title="The live bracket's positions in the registered fan at its reference horizon — read-only stamps, never inputs to level selection"
            >
              TP {fmtQ(br.tp_q)} · SL {fmtQ(br.sl_q)}
            </span>
          )}
        </div>
        <p className="text-xs opacity-60 mb-3">
          The bracket&apos;s own pre-registered distribution: quantile fan frozen at
          qualification{claim?.deadline_ts ? <> (deadline {fmtTs(claim.deadline_ts)})</> : null}, scored at
          resolution through the same settlement contract as the signal. A baseline control arm, not an edge —
          honest fans are the claim.
        </p>

        {!claim ? (
          <p className="text-xs opacity-50">
            No registered claim on this signal. Claims register at qualification for every qualified signal
            (claims ledger, Phase A); this row predates the ledger or carries no claim through transport yet.
          </p>
        ) : (
          <>
            <ClaimFanChart claim={claim} />

            {/* Claimed probabilities — asserted at qualification, carried as evidence */}
            <div className="mt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">
                Claimed Probabilities (at qualification)
              </h4>
              <div className="text-sm space-y-0.5">
                {probs.p_resolve != null && (
                  <Row
                    label="p_resolve"
                    value={fmtPct(probs.p_resolve)}
                    title="Claimed probability the bracket resolves (TP or SL) within the 48h window"
                  />
                )}
                {probs.p_win_given_resolve != null && (
                  <Row
                    label="p_win | resolve"
                    value={fmtPct(probs.p_win_given_resolve)}
                    className="text-success"
                    title="Claimed probability of TP given the bracket resolves"
                  />
                )}
                {probs.p_win_bracket != null && (
                  <Row label="p_win_bracket" value={fmtPct(probs.p_win_bracket)} title="Reachability-calibrated bracket win probability" />
                )}
                {probs.pi_win != null || probs.pi_loss != null || probs.pi_expire != null ? (
                  <div className="flex items-center gap-2 flex-wrap pt-1 text-[11px] opacity-70">
                    <span className="opacity-70">barrier null:</span>
                    {probs.pi_win != null && <span className="font-mono text-success">π_win {fmtPct(probs.pi_win)}</span>}
                    {probs.pi_loss != null && <span className="font-mono text-error">π_loss {fmtPct(probs.pi_loss)}</span>}
                    {probs.pi_expire != null && <span className="font-mono">π_expire {fmtPct(probs.pi_expire)}</span>}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Outcome — filled only after the resolver scored the claim */}
            {isResolved ? (
              <div className="mt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">
                  Scored Outcome (settlement contract)
                </h4>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span
                    className={`badge badge-sm font-mono ${
                      outcome.result === "tp" ? "badge-success" : outcome.result === "sl" ? "badge-error" : "badge-ghost"
                    }`}
                  >
                    {String(outcome.result).toUpperCase()}
                  </span>
                  <CoverageChip label="cov50" value={outcome.coverage50} nominal={0.5} />
                  <CoverageChip label="cov80" value={outcome.coverage80} nominal={0.8} />
                  <CoverageChip label="cov90" value={outcome.coverage90} nominal={0.9} />
                  {outcome.crps != null && (
                    <span className="badge badge-sm badge-ghost font-mono" title="Continuous Ranked Probability Score (2 × mean pinball)">
                      CRPS {Number(outcome.crps).toFixed(4)}
                    </span>
                  )}
                  {outcome.brier_resolve != null && (
                    <span className="badge badge-sm badge-ghost font-mono" title="Brier score of the claimed p_resolve (expired = unresolved)">
                      brier {Number(outcome.brier_resolve).toFixed(3)}
                    </span>
                  )}
                </div>
                <div className="text-sm space-y-0.5">
                  {outcome.exit_price != null && <Row label="Exit" value={fmtPrice(outcome.exit_price)} />}
                  {outcome.hold_bars != null && <Row label="Hold" value={`${Number(outcome.hold_bars)} bars`} />}
                  {outcome.n_scored_h != null && (
                    <Row label="Scored horizon" value={`${Number(outcome.n_scored_h)} of ${Math.round(Number(claim.horizon_h))} hours`} />
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[11px] opacity-40 mt-2">
                {status === "open"
                  ? "Awaiting resolution — the fan scores when the 48h window closes (EOD resolver, same settlement contract as the signal)."
                  : "Claim voided before scoring (expired un-scored)."}
              </p>
            )}

            <p className="text-[10px] opacity-30 mt-2 font-mono">
              claim ts {fmtTs(claim.ts)}
              {claim.signal_id ? ` · signal ${String(claim.signal_id).slice(0, 8)}…` : ""}
              {br.h_ref != null ? ` · ref h ${Number(br.h_ref)}h` : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
