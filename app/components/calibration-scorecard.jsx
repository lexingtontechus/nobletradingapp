// CalibrationScorecard — dashboard "Calibration" section.
//
// Renders two side-by-side cards:
//   1. Calibration Bias      — is the model's stated p_win honest?
//   2. Accuracy vs No-Skill  — does the qualified book beat the coin-flip line?
//
// Data sources:
//   GET /api/dashboard-data  → { calibration }  (v_eod_calibration_bias_latest)
//   GET /api/platform-health → { user: { win_rate_7d, edge_vs_odds_7d, settled_7d } }
//
// 2026-10-15 fix: the previous single card read `expected_p_win`, `actual_p_win`,
// `accuracy`, and `no_skill_line` — NONE of which exist on any view. Every metric
// computed to 0, so the footer always claimed "well-calibrated" regardless of the
// real state. Remapped to the actual columns. The no-skill line is derived from
// the platform-health aggregate (tp_rate_7d − edge_vs_no_skill_7d) because
// v_calibration_confidence_board does not expose a no-skill line.

"use client";

import { useMemo } from "react";

function fmtPct(n, digits = 1) {
  if (n == null || isNaN(Number(n))) return "—";
  return (Number(n) * 100).toFixed(digits) + "%";
}

function fmtSigned(n, digits = 3) {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  return (v > 0 ? "+" : "") + v.toFixed(digits);
}

function Row({ label, value, className = "", title }) {
  return (
    <div className="flex justify-between items-baseline" title={title}>
      <span className="opacity-70">{label}</span>
      <span className={`font-mono ${className}`}>{value}</span>
    </div>
  );
}

function Card({ title, blurb, children, footer }) {
  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body">
        <h3 className="card-title text-base">{title}</h3>
        <p className="text-xs opacity-60 mb-3">{blurb}</p>
        <div className="text-sm space-y-1">{children}</div>
        {footer}
      </div>
    </div>
  );
}

export default function CalibrationScorecard({ calibration, platformHealth }) {
  // ── Card 1: Calibration Bias ──────────────────────────────────────────────
  // v_eod_calibration_bias_latest columns: avg_predicted_p_win, realized_win_rate,
  // bias, bias_raw, status, status_raw (latest day, one row per symbol).
  const biasMetrics = useMemo(() => {
    if (!calibration || calibration.length === 0) return null;
    const total = calibration.length;
    const avgPredicted =
      calibration.reduce((sum, r) => sum + Number(r.avg_predicted_p_win || 0), 0) / total;
    const avgRealized =
      calibration.reduce((sum, r) => sum + Number(r.realized_win_rate || 0), 0) / total;
    const avgBias = calibration.reduce((sum, r) => sum + Number(r.bias || 0), 0) / total;
    return {
      total,
      avgPredicted,
      avgRealized,
      calError: avgPredicted - avgRealized,
      avgBias,
    };
  }, [calibration]);

  // ── Card 2: Accuracy vs No-Skill ──────────────────────────────────────────
  // Platform health (qualified book, 7d): accuracy = tp_rate_7d;
  // edge_vs_no_skill_7d = accuracy − no_skill_line, so no_skill_line = accuracy − edge.
  const accMetrics = useMemo(() => {
    const accuracy = platformHealth?.win_rate_7d?.value;
    const edge = platformHealth?.edge_vs_odds_7d?.value;
    if (accuracy == null || edge == null) return null;
    return {
      accuracy: Number(accuracy),
      edge: Number(edge),
      noSkill: Number(accuracy) - Number(edge),
      settled: platformHealth?.settled_7d ?? null,
    };
  }, [platformHealth]);

  if (!biasMetrics && !accMetrics) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 mb-6">
      {/* ── Card 1: Calibration Bias ── */}
      {biasMetrics && (
        <Card
          title="Calibration Bias"
          blurb={
            <>
              Is the model&apos;s stated win probability honest? Compares the average
              predicted <span className="font-mono">p_win</span> against what actually
              resolved. Positive error = <strong>overconfident</strong> (claims more
              than it delivers); negative = conservative.
            </>
          }
          footer={
            <div className="mt-3 text-xs opacity-70">
              {biasMetrics.calError > 0.05
                ? "⚠️ Overconfident — realized win rate is below the prediction."
                : biasMetrics.calError < -0.05
                ? "✅ Conservative — realized win rate exceeds the prediction."
                : "✅ Well-calibrated — predictions match realized outcomes."}
            </div>
          }
        >
          <Row label="Cells" value={String(biasMetrics.total)} />
          <Row
            label="Avg predicted"
            value={fmtPct(biasMetrics.avgPredicted)}
            title="Mean stated p_win across symbols (latest day)"
          />
          <Row
            label="Avg realized"
            value={fmtPct(biasMetrics.avgRealized)}
            title="Mean actual win rate across symbols (latest day)"
          />
          <Row
            label="Calibration error"
            value={fmtSigned(biasMetrics.calError)}
            className={
              biasMetrics.calError > 0.05
                ? "text-error"
                : biasMetrics.calError < -0.05
                ? "text-success"
                : ""
            }
            title="Avg predicted − avg realized"
          />
          <Row
            label="Bias"
            value={fmtSigned(biasMetrics.avgBias)}
            className={
              Math.abs(biasMetrics.avgBias) > 0.1
                ? "text-error"
                : Math.abs(biasMetrics.avgBias) > 0.05
                ? "text-warning"
                : "text-success"
            }
            title="Mean per-symbol bias"
          />
        </Card>
      )}

      {/* ── Card 2: Accuracy vs No-Skill ── */}
      {accMetrics && (
        <Card
          title="Accuracy vs No-Skill"
          blurb={
            <>
              Does the engine beat the coin-flip line? The no-skill line is the win
              rate a random bracket would achieve from the same take-profit / stop
              geometry (<span className="font-mono">SL ÷ (TP + SL)</span>). Edge
              above 0 means the qualified book wins more often than geometry alone
              would. Qualified book, last 7 days.
            </>
          }
          footer={
            <div className="mt-3 text-xs opacity-70">
              {accMetrics.edge > 0.02
                ? "✅ Above the no-skill line — the signal adds edge over geometry alone."
                : accMetrics.edge < -0.02
                ? "⚠️ Below the no-skill line — a random bracket would have done better."
                : "≈ At the no-skill line — no measurable edge over geometry alone."}
            </div>
          }
        >
          <Row
            label="Realized accuracy"
            value={fmtPct(accMetrics.accuracy)}
            title="Share of resolved qualified signals that hit TP (7d)"
          />
          <Row
            label="No-skill line"
            value={fmtPct(accMetrics.noSkill)}
            title="Win rate a random bracket would achieve from the same TP/SL geometry"
          />
          <Row
            label="Edge"
            value={fmtSigned(accMetrics.edge)}
            className={accMetrics.edge > 0 ? "text-success" : "text-error"}
            title="Realized accuracy − no-skill line"
          />
          {accMetrics.settled != null && (
            <Row
              label="Settled (7d)"
              value={String(accMetrics.settled)}
              title="Qualified signals resolved to W or L in the last 7 days"
            />
          )}
        </Card>
      )}
    </div>
  );
}
