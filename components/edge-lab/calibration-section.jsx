"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltip } from "./chart-tooltip";
import { LegendItem } from "./chips";
import { AXIS_TICK_STYLE, SERIES_COLORS, fmtNum, fmtPct } from "@/lib/edge-lab-format";

function reliabilityToRows(c) {
  const rows = [
    ...c.reliability_base.map((r) => ({ x: r.pred, base: r.emp, regime: null })),
    ...c.reliability_regime.map((r) => ({ x: r.pred, base: null, regime: r.emp })),
  ];
  rows.sort((a, b) => a.x - b.x);
  return rows;
}

function SymbolPicker({ value, onChange, symbols, label }) {
  return (
    <select
      className="select select-sm w-[180px]"
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    >
      {symbols.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

export function CalibrationSection({ data }) {
  const [symbol, setSymbol] = useState(data.meta.symbols[0] ?? "BTCUSD");
  const entry = data.calibration.per_symbol.find((p) => p.symbol === symbol);

  const rows = useMemo(() => (entry ? reliabilityToRows(entry) : []), [entry]);

  const domain = useMemo(() => {
    if (rows.length === 0) return [0, 0.3];
    const lo = Math.min(...rows.map((r) => r.x));
    const hi = Math.max(...rows.map((r) => r.x));
    const pad = Math.max((hi - lo) * 0.08, 0.01);
    return [Math.max(0, lo - pad), hi + pad];
  }, [rows]);

  const meanBaseAuc =
    data.calibration.per_symbol.reduce((a, c) => a + c.base_rate.auc, 0) /
    Math.max(1, data.calibration.per_symbol.length);
  const meanRegimeAuc =
    data.calibration.per_symbol.reduce((a, c) => a + c.regime_conditional.auc, 0) /
    Math.max(1, data.calibration.per_symbol.length);

  if (!entry) {
    return <p className="text-sm text-muted-foreground">No calibration data for {symbol}.</p>;
  }

  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,32rem),1fr))]">
      <div className="grid content-start gap-4">
        <SymbolPicker
          value={symbol}
          onChange={setSymbol}
          symbols={data.meta.symbols}
          label="Select symbol for calibration"
        />

        <div className="rounded-xl border border-base-300 bg-base-100 p-3 md:p-4">
          <p className="mb-2 px-1 text-xs text-muted-foreground">
            Reliability · {symbol} — predicted p(TP) vs realized TP rate. The amber and emerald
            curves are the two calibration models; the dashed diagonal is perfect calibration.
          </p>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart data={rows} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                <XAxis
                  type="number"
                  dataKey="x"
                  domain={domain}
                  tick={AXIS_TICK_STYLE}
                  tickFormatter={(v) => fmtPct(v, 0)}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                  label={{
                    value: "predicted p(TP)",
                    position: "insideBottom",
                    offset: -6,
                    fill: "var(--muted-foreground)",
                    fontSize: 11,
                  }}
                />
                <YAxis
                  type="number"
                  domain={domain}
                  tick={AXIS_TICK_STYLE}
                  tickFormatter={(v) => fmtPct(v, 0)}
                  width={72}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: "empirical TP rate",
                    angle: -90,
                    position: "insideLeft",
                    offset: 12,
                    fill: "var(--muted-foreground)",
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      labelFormat={(l) => `predicted p(TP) ${fmtPct(Number(l), 3)}`}
                      format={(v) => fmtPct(v, 3)}
                    />
                  }
                  cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 3" }}
                />
                <ReferenceLine
                  ifOverflow="extendDomain"
                  segment={[
                    { x: domain[0], y: domain[0] },
                    { x: domain[1], y: domain[1] },
                  ]}
                  stroke={SERIES_COLORS.zinc}
                  strokeDasharray="6 4"
                  strokeOpacity={0.7}
                />
                <Line
                  type="monotone"
                  dataKey="base"
                  name="base rate"
                  stroke={SERIES_COLORS.amber}
                  strokeWidth={1.75}
                  dot={{ r: 3, fill: SERIES_COLORS.amber, strokeWidth: 0 }}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="regime"
                  name="regime-conditional"
                  stroke={SERIES_COLORS.emerald}
                  strokeWidth={1.75}
                  dot={{ r: 3, fill: SERIES_COLORS.emerald, strokeWidth: 0 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-base-300 px-1 pt-3">
            <LegendItem color={SERIES_COLORS.amber}>base rate (level-only)</LegendItem>
            <LegendItem color={SERIES_COLORS.emerald}>regime-conditional</LegendItem>
            <LegendItem color={SERIES_COLORS.zinc} dashed>
              perfect calibration
            </LegendItem>
          </div>
        </div>

        <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
          The live bucket table is level-only (AUC near 0.5 within-bucket, no discrimination). The
          regime-conditional cells add modest, honest discrimination.
        </p>
      </div>

      <div className="grid content-start gap-4">
        <div className="overflow-hidden rounded-xl border border-base-300">
          <div className="border-b border-base-300 bg-base-200/60 px-3 py-2 text-xs font-medium">
            AUC / Brier / ECE — base vs regime-conditional
          </div>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>AUC base</th>
                  <th>AUC regime</th>
                  <th>dAUC</th>
                  <th>Brier b/r</th>
                  <th>ECE b/r</th>
                </tr>
              </thead>
              <tbody>
                {data.calibration.per_symbol.map((c) => {
                  const delta = c.regime_conditional.auc - c.base_rate.auc;
                  const isSel = c.symbol === symbol;
                  return (
                    <tr key={c.symbol} className={isSel ? "bg-primary/10" : undefined}>
                      <td className="font-mono text-xs font-medium">{c.symbol}</td>
                      <td className="font-mono text-xs tabular-nums">
                        {fmtNum(c.base_rate.auc, 3)}
                      </td>
                      <td className="font-mono text-xs tabular-nums">
                        {fmtNum(c.regime_conditional.auc, 3)}
                      </td>
                      <td
                        className={`font-mono text-xs tabular-nums ${
                          delta >= 0 ? "text-success" : "text-error"
                        }`}
                      >
                        {delta >= 0 ? "+" : ""}
                        {fmtNum(delta, 3)}
                      </td>
                      <td className="font-mono text-xs tabular-nums">
                        {fmtNum(c.base_rate.brier, 3)} /{" "}
                        {fmtNum(c.regime_conditional.brier, 3)}
                      </td>
                      <td className="font-mono text-xs tabular-nums">
                        {fmtNum(c.base_rate.ece, 3)} / {fmtNum(c.regime_conditional.ece, 3)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="rounded-xl border border-base-300 bg-base-200/60 p-3 text-xs leading-relaxed text-muted-foreground">
          Regime-conditional AUC mean{" "}
          <span className="font-mono text-success">{fmtNum(meanRegimeAuc, 3)}</span> vs base{" "}
          <span className="font-mono text-warning">{fmtNum(meanBaseAuc, 3)}</span> — modest,
          honest discrimination above the base-rate table.
        </p>
      </div>
    </div>
  );
}
