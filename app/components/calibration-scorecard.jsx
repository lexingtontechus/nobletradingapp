// CalibrationScorecard — dashboard "Calibration" section.
//
// Shows the calibration quality of the signal engine: no-skill line vs actual
// accuracy, calibration error by era, and rank IC (Spearman correlation
// between rank score and outcome).
//
// Data source: /api/dashboard-data (calibration, calibrationBoard).
// All fields are nullable — sections hide when data is absent.
//
// API: GET /api/dashboard-data → { calibration, calibrationBoard }

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

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-1">
        {title}
      </h4>
      <div className="text-sm space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ label, value, className = "" }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="opacity-70">{label}</span>
      <span className={`font-mono ${className}`}>{value}</span>
    </div>
  );
}

export default function CalibrationScorecard({ calibration, calibrationBoard }) {
  // Aggregate calibration metrics
  const metrics = useMemo(() => {
    if (!calibration || calibration.length === 0) return null;

    const total = calibration.length;
    const avgBias = calibration.reduce((sum, r) => sum + (r.bias || 0), 0) / total;
    const avgExpected = calibration.reduce((sum, r) => sum + (r.expected_p_win || 0), 0) / total;
    const avgActual = calibration.reduce((sum, r) => sum + (r.actual_p_win || 0), 0) / total;

    // Calibration error: expected - actual (positive = overconfident)
    const calError = avgExpected - avgActual;

    return {
      total,
      avgBias,
      avgExpected,
      avgActual,
      calError,
    };
  }, [calibration]);

  // Aggregate board metrics
  const boardMetrics = useMemo(() => {
    if (!calibrationBoard || calibrationBoard.length === 0) return null;

    const total = calibrationBoard.length;
    const qualified = calibrationBoard.filter((r) => r.qualified).length;
    const accuracy = calibrationBoard.reduce((sum, r) => sum + (r.accuracy || 0), 0) / total;
    const noSkill = calibrationBoard.reduce((sum, r) => sum + (r.no_skill_line || 0), 0) / total;

    return {
      total,
      qualified,
      accuracy,
      noSkill,
      edge: accuracy - noSkill,
    };
  }, [calibrationBoard]);

  if (!metrics && !boardMetrics) return null;

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg mb-3">Calibration Scorecard</h3>

        {/* Calibration Bias */}
        {metrics && (
          <Section title="Calibration Bias">
            <Row label="Records" value={String(metrics.total)} />
            <Row
              label="Avg Expected"
              value={fmtPct(metrics.avgExpected)}
            />
            <Row
              label="Avg Actual"
              value={fmtPct(metrics.avgActual)}
            />
            <Row
              label="Calibration Error"
              value={fmtSigned(metrics.calError)}
              className={
                metrics.calError > 0.05
                  ? "text-error"
                  : metrics.calError < -0.05
                  ? "text-success"
                  : ""
              }
            />
            <Row
              label="Bias"
              value={fmtSigned(metrics.avgBias)}
              className={
                Math.abs(metrics.avgBias) > 0.1
                  ? "text-error"
                  : Math.abs(metrics.avgBias) > 0.05
                  ? "text-warning"
                  : "text-success"
              }
            />
          </Section>
        )}

        {/* Accuracy vs No-Skill */}
        {boardMetrics && (
          <Section title="Accuracy vs No-Skill">
            <Row label="Cells" value={String(boardMetrics.total)} />
            <Row label="Qualified" value={String(boardMetrics.qualified)} />
            <Row
              label="Actual Accuracy"
              value={fmtPct(boardMetrics.accuracy)}
            />
            <Row
              label="No-Skill Line"
              value={fmtPct(boardMetrics.noSkill)}
            />
            <Row
              label="Edge"
              value={fmtSigned(boardMetrics.edge)}
              className={boardMetrics.edge > 0 ? "text-success" : "text-error"}
            />
          </Section>
        )}

        {/* Interpretation */}
        {metrics && (
          <div className="mt-3 text-xs opacity-60">
            {metrics.calError > 0.05
              ? "⚠️ Model is overconfident — actual win rate is lower than predicted."
              : metrics.calError < -0.05
              ? "✅ Model is conservative — actual win rate exceeds predictions."
              : "✅ Model is well-calibrated — predictions match actual outcomes."}
          </div>
        )}
      </div>
    </div>
  );
}
