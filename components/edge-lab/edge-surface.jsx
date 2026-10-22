"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltip } from "./chart-tooltip";
import { LegendItem } from "./chips";
import {
  AXIS_TICK_STYLE,
  FEATURE_KEYS,
  FEATURE_LABELS,
  SERIES_COLORS,
  fmtNum,
  fmtP,
  fmtPct,
} from "@/lib/edge-lab-format";

/** @type {("meanR" | "rates")[]} */
const OUTCOME_MODES = ["meanR", "rates"];

function binTooltipFormat(label) {
  return `bucket ${label}`;
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

export function EdgeSurface({ data }) {
  const [symbol, setSymbol] = useState(data.meta.symbols[0] ?? "BTCUSD");
  const [feature, setFeature] = useState(FEATURE_KEYS[0] ?? "er_abs");
  const [mode, setMode] = useState("meanR");

  const entry = data.edge_surface.per_symbol.find((p) => p.symbol === symbol);

  const bins = useMemo(() => {
    const raw = entry?.by_feature[feature] ?? [];
    return raw.map((b, i) => ({
      ...b,
      key: `D${i + 1}`,
      mid: (b.bin_lo + b.bin_hi) / 2,
    }));
  }, [entry, feature]);

  const meanDomain = useMemo(() => {
    if (bins.length === 0) return [-1, 1];
    const vals = bins.flatMap((b) => [b.mean_r, b.ci_lo, b.ci_hi]).filter((v) => Number.isFinite(v));
    if (vals.length === 0) return [-1, 1];
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const pad = (hi - lo) * 0.08 || 0.1;
    return [lo - pad, hi + pad];
  }, [bins]);

  const sigCells = useMemo(() => {
    return data.edge_surface.per_symbol.flatMap((s) =>
      FEATURE_KEYS.filter((f) => (s.spearman[f]?.p ?? 1) < 0.05).map((f) => ({
        symbol: s.symbol,
        feature: f,
        ...s.spearman[f],
      })),
    );
  }, [data.edge_surface.per_symbol]);

  if (!entry) {
    return <p className="text-sm text-muted-foreground">No edge-surface data for {symbol}.</p>;
  }

  const spearman = entry.spearman;
  const featureLabel = FEATURE_LABELS[feature];
  const totalCells = data.edge_surface.per_symbol.length * FEATURE_KEYS.length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SymbolPicker
            value={symbol}
            onChange={setSymbol}
            symbols={data.meta.symbols}
            label="Select symbol for edge surface"
          />
          <div className="btn-group flex-wrap" role="group" aria-label="Select regime-value feature">
            {FEATURE_KEYS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={feature === f}
                className={`btn btn-sm ${feature === f ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setFeature(f)}
              >
                {FEATURE_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-base-300 bg-base-100 p-3 md:p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-xs text-muted-foreground">
              {featureLabel} decile buckets (D1 = lowest) · x tick = bucket index, range in tooltip
            </p>
            <div className="tabs tabs-border" role="tablist" aria-label="Outcome view">
              {OUTCOME_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={`tab tab-sm ${mode === m ? "tab-active" : ""}`}
                  onClick={() => setMode(m)}
                >
                  {m === "meanR" ? "Mean R" : "Outcome rates"}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bins} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="key"
                  tick={AXIS_TICK_STYLE}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={AXIS_TICK_STYLE}
                  domain={mode === "meanR" ? meanDomain : [0, 1]}
                  width={56}
                  tickFormatter={(v) => (mode === "meanR" ? fmtNum(v, 1) : fmtPct(v, 0))}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--accent)", opacity: 0.4 }}
                  content={
                    <ChartTooltip
                      labelFormat={binTooltipFormat}
                      format={(v) => (mode === "meanR" ? fmtNum(v, 3) : fmtPct(v, 1))}
                    />
                  }
                />
                {mode === "meanR" ? (
                  <>
                    <Bar dataKey="mean_r" name="mean R" radius={[3, 3, 0, 0]} maxBarSize={42}>
                      {bins.map((b, i) => (
                        <Cell
                          key={i}
                          fill={b.mean_r > 0 ? SERIES_COLORS.emerald : SERIES_COLORS.rose}
                          fillOpacity={0.75}
                        />
                      ))}
                    </Bar>
                    <Line
                      type="linear"
                      dataKey="ci_lo"
                      name="CI low"
                      stroke={SERIES_COLORS.zinc}
                      strokeWidth={1.25}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="linear"
                      dataKey="ci_hi"
                      name="CI high"
                      stroke={SERIES_COLORS.zinc}
                      strokeWidth={1.25}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </>
                ) : (
                  <>
                    <Bar dataKey="tp_rate" name="TP rate" stackId="rates" fill={SERIES_COLORS.emerald} fillOpacity={0.8} maxBarSize={42} />
                    <Bar dataKey="exp_rate" name="EXP rate" stackId="rates" fill={SERIES_COLORS.zinc} fillOpacity={0.6} maxBarSize={42} />
                    <Bar dataKey="sl_rate" name="SL rate" stackId="rates" fill={SERIES_COLORS.rose} fillOpacity={0.8} radius={[0, 3, 0, 0]} maxBarSize={42} />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
            {mode === "meanR" ? (
              <>
                <LegendItem color={SERIES_COLORS.emerald}>mean R &gt; 0</LegendItem>
                <LegendItem color={SERIES_COLORS.rose}>mean R &lt; 0</LegendItem>
                <LegendItem color={SERIES_COLORS.zinc} dashed>
                  95% CI
                </LegendItem>
              </>
            ) : (
              <>
                <LegendItem color={SERIES_COLORS.emerald}>TP</LegendItem>
                <LegendItem color={SERIES_COLORS.zinc}>EXP</LegendItem>
                <LegendItem color={SERIES_COLORS.rose}>SL</LegendItem>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Side panel: Spearman + verdict */}
      <div className="grid content-start gap-4">
        <div className="overflow-hidden rounded-xl border border-base-300">
          <div className="flex items-center justify-between gap-2 border-b border-base-300 bg-base-200/60 px-3 py-2">
            <span className="text-xs font-medium">Spearman rho vs mean R · {symbol}</span>
            <span className="badge badge-sm badge-success font-mono">
              {sigCells.length} significant
            </span>
          </div>
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Feature</th>
                <th>rho</th>
                <th>p</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_KEYS.map((f) => {
                const cell = spearman[f];
                const sig = cell ? cell.p < 0.05 : false;
                return (
                  <tr key={f} className={sig ? "bg-success/10" : undefined}>
                    <td className="text-xs font-medium">{FEATURE_LABELS[f]}</td>
                    <td className="font-mono text-xs tabular-nums">
                      {cell ? fmtNum(cell.rho, 3) : "—"}
                    </td>
                    <td className="font-mono text-xs tabular-nums">
                      {cell ? fmtP(cell.p) : "—"}
                      {sig ? (
                        <span className="ml-1 font-sans text-[10px] font-semibold text-success">
                          *
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sigCells.length > 0 ? (
          <div className="rounded-xl border border-base-300 bg-base-200/60 p-3 text-xs leading-relaxed">
            <p className="mb-1 font-medium">Significant cells (alpha=0.05):</p>
            <ul className="grid gap-1 font-mono text-[11px]">
              {sigCells.map((c) => (
                <li key={`${c.symbol}-${c.feature}`}>
                  {FEATURE_LABELS[c.feature]} · {c.symbol} · rho={fmtNum(c.rho, 3)} · p=
                  {fmtP(c.p)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="alert alert-warning">
          <p className="text-xs leading-relaxed">
            Edge predictability is weak, not decisive: {sigCells.length}/{totalCells}{" "}
            feature x symbol tests significant at alpha=0.05. The regime value is an honest,
            calibrated gate input — not a money machine.
          </p>
        </div>
      </div>
    </div>
  );
}
