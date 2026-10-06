// SignalContextCard — dashboard "Signal Context" section.
//
// Displays the full Kairos signal context for the selected symbol's latest
// signal: dynamic ATR geometry, deadline tiers, geometry risk, regime
// freshness, and macro pivot labels.
//
// Data source: /api/dashboard-data (sweeps, deadlineTiers, geometryRisk,
// kairosPivots). All fields are nullable — sections hide when data is absent.
//
// API: GET /api/dashboard-data → { sweeps, deadlineTiers, geometryRisk, kairosPivots }

"use client";

import { useMemo } from "react";

function fmtPrice(n) {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(v) >= 100) return "$" + v.toFixed(2);
  if (Math.abs(v) >= 10) return "$" + v.toFixed(3);
  return "$" + v.toFixed(4);
}

function fmtPct(n, digits = 1) {
  if (n == null || isNaN(Number(n))) return "—";
  return (Number(n) * 100).toFixed(digits) + "%";
}

function fmtHours(n) {
  if (n == null || isNaN(Number(n))) return "—";
  const h = Number(n);
  if (h < 1) return Math.round(h * 60) + "m";
  if (h < 48) return h.toFixed(1) + "h";
  return (h / 24).toFixed(1) + "d";
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

export default function SignalContextCard({
  sweepRow,
  deadlineTiers,
  geometryRisk,
  kairosPivots,
}) {
  const symbol = sweepRow?.symbol;

  // Find deadline tier for this symbol + vol tier
  const volTier = useMemo(() => {
    if (!sweepRow?.regime) return null;
    const m = sweepRow.regime.match(/^(low_vol|med_low_vol|med_high_vol|high_vol)/);
    return m ? m[1] : null;
  }, [sweepRow?.regime]);

  const deadline = useMemo(() => {
    if (!deadlineTiers || !symbol) return null;
    return deadlineTiers.find(
      (d) => d.symbol === symbol && d.vol_tier === volTier
    ) || null;
  }, [deadlineTiers, symbol, volTier]);

  // Find geometry risk for this symbol + vol tier + bucket
  const geometry = useMemo(() => {
    if (!geometryRisk || !symbol) return null;
    return geometryRisk.find(
      (g) => g.symbol === symbol && g.vol_tier === volTier
    ) || null;
  }, [geometryRisk, symbol, volTier]);

  // Find latest pivot for this symbol
  const pivot = useMemo(() => {
    if (!kairosPivots || !symbol) return null;
    const rows = kairosPivots
      .filter((p) => p.symbol === symbol)
      .sort((a, b) => String(b.pivot_as_of || "").localeCompare(String(a.pivot_as_of || "")));
    return rows[0] || null;
  }, [kairosPivots, symbol]);

  if (!sweepRow) return null;

  const isBuy = String(sweepRow.signal || "").toLowerCase() !== "sell";
  const sigDirection = isBuy ? "BUY" : "SELL";

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <h3 className="card-title text-lg">Signal Context</h3>
          <span className="mx-2 font-semibold badge badge-primary">{symbol}</span>
          <span
            className={`badge font-mono font-semibold ${
              isBuy ? "badge-success" : "badge-error"
            }`}
          >
            {sigDirection}
          </span>
          {sweepRow.regime && (
            <span className="badge badge-ghost font-mono">{sweepRow.regime}</span>
          )}
        </div>

        {/* Trade levels */}
        <Section title="Trade Levels">
          <Row label="Entry" value={fmtPrice(sweepRow.entry_price)} />
          <Row
            label="Stop Loss"
            value={fmtPrice(sweepRow.stop_loss)}
            className="text-error"
          />
          <Row
            label="Take Profit"
            value={fmtPrice(sweepRow.take_profit)}
            className="text-success"
          />
          <Row label="Brick Size" value={fmtPrice(sweepRow.brick_size)} />
          {sweepRow.base_brick_size != null && sweepRow.base_brick_size !== sweepRow.brick_size && (
            <>
              <Row label="Base Brick" value={fmtPrice(sweepRow.base_brick_size)} />
              <Row
                label="ATR Scale"
                value={sweepRow.brick_vol_scale != null ? sweepRow.brick_vol_scale.toFixed(4) : "—"}
                className="text-warning"
              />
            </>
          )}
          {sweepRow.vol_ratio != null && (
            <Row label="Vol Ratio" value={sweepRow.vol_ratio.toFixed(3)} />
          )}
        </Section>

        {/* Kairos Rank */}
        {sweepRow.kairos_rank_score != null && (
          <Section title="Regime Freshness">
            <Row
              label="Rank Score"
              value={sweepRow.kairos_rank_score.toFixed(3)}
              className={sweepRow.kairos_rank_score >= 0.55 ? "text-success" : "text-warning"}
            />
          </Section>
        )}

        {/* Deadline Tiers */}
        {deadline && (
          <Section title="Deadline">
            <Row label="Soft" value={fmtHours(deadline.soft_deadline_hours)} />
            <Row label="Hard" value={fmtHours(deadline.hard_deadline_hours)} />
            <Row label="Median" value={fmtHours(deadline.median_hours)} />
            <Row
              label="Confidence"
              value={deadline.confidence}
              className={
                deadline.confidence === "high"
                  ? "text-success"
                  : deadline.confidence === "medium"
                  ? "text-warning"
                  : "text-error"
              }
            />
            <Row label="Samples" value={String(deadline.n)} />
          </Section>
        )}

        {/* Geometry Risk */}
        {geometry && (
          <Section title="Geometry Risk">
            <Row
              label="Long-Lag"
              value={fmtPct(geometry.pct_expired)}
              className={
                geometry.pct_expired != null && geometry.pct_expired > 0.35
                  ? "text-error"
                  : "text-success"
              }
            />
            <Row label="P90 Resolution" value={fmtHours(geometry.p90_hours)} />
            <Row label="Samples" value={String(geometry.n_stored)} />
          </Section>
        )}

        {/* Macro Pivot */}
        {pivot && (
          <Section title="Macro Pivot">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`badge font-mono text-xs ${
                  pivot.pivot_label === "major_pivot"
                    ? "badge-error"
                    : pivot.pivot_label === "incremental"
                    ? "badge-warning"
                    : "badge-ghost"
                }`}
              >
                {pivot.pivot_label}
              </span>
              {pivot.pivot_axis && pivot.pivot_axis !== "none" && (
                <span className="badge badge-ghost text-xs">{pivot.pivot_axis}</span>
              )}
              {pivot.pivot_intensity != null && (
                <span className="text-xs opacity-60">
                  intensity {(pivot.pivot_intensity * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {pivot.pivot_event_title && (
              <div className="text-xs opacity-70">{pivot.pivot_event_title}</div>
            )}
            {pivot.pivot_summary && (
              <div className="text-xs opacity-60 italic">"{pivot.pivot_summary}"</div>
            )}
          </Section>
        )}

        {/* Empty state */}
        {!sweepRow.kairos_rank_score && !deadline && !geometry && !pivot && (
          <p className="text-xs opacity-50">
            No Kairos context available for this symbol yet. Data populates as sweeps run.
          </p>
        )}
      </div>
    </div>
  );
}
