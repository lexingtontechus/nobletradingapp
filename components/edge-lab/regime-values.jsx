"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { LegendItem } from "./chips";
import {
  AXIS_TICK_STYLE,
  REGIME_COLORS,
  SERIES_COLORS,
  decimate,
  fmtDateLabel,
  fmtNum,
} from "@/lib/edge-lab-format";

/** Points per chart (1500 available) — enough shape, cheap to render. */
const MAX_POINTS = 750;

/**
 * REGIME SHADING — implementation choice (documented per spec):
 * Rendering ~750 ReferenceArea segments is too heavy, and a hidden Bar series
 * misaligns with a Line on a category x-axis. Instead the close series is split
 * into per-regime Line overlays (value = close where regime matches, null
 * elsewhere) with connectNulls={false}: Recharts renders each contiguous
 * same-regime run as one colored polyline at Line-series cost. The neutral
 * state is the underlying zinc close line itself; isolated 1-bar regime runs
 * simply fall back to it (visually negligible).
 */
function toRows(bars) {
  return decimate(bars, MAX_POINTS).map((b) => ({
    ...b,
    close_up: b.regime === "trend_up" ? b.close : null,
    close_down: b.regime === "trend_down" ? b.close : null,
  }));
}

function RegimeTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-mono text-[11px] text-muted-foreground">
        {row.t.slice(0, 16).replace("T", " ")} UTC
      </div>
      <div className="grid gap-0.5">
        <div className="flex justify-between gap-6">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: SERIES_COLORS.zinc }}
              aria-hidden="true"
            />
            close
          </span>
          <span className="font-mono tabular-nums">{fmtNum(row.close, 2)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">regime</span>
          <span className="font-mono" style={{ color: REGIME_COLORS[row.regime] }}>
            {row.regime}
          </span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">trend</span>
          <span className="font-mono tabular-nums">{fmtNum(row.trend, 3)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">chop</span>
          <span className="font-mono tabular-nums">{fmtNum(row.chop, 3)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">vol</span>
          <span className="font-mono tabular-nums">{fmtNum(row.vol, 3)}</span>
        </div>
      </div>
    </div>
  );
}

function SmallAreaChart({ rows, dataKey, color, label, domain, syncId }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <LegendItem color={color}>{label}</LegendItem>
        <span className="font-mono text-[10px] text-muted-foreground">
          [{domain[0]}, {domain[1]}]
        </span>
      </div>
      <div className="h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} syncId={syncId} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <XAxis
              dataKey="t"
              tick={AXIS_TICK_STYLE}
              tickFormatter={fmtDateLabel}
              interval="preserveStartEnd"
              minTickGap={56}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              tick={AXIS_TICK_STYLE}
              domain={domain}
              tickFormatter={(v) => fmtNum(v, 1)}
              width={44}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<RegimeTooltip />}
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 3" }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={1.5}
              fill={color}
              fillOpacity={0.12}
              dot={false}
              activeDot={{ r: 2.5, fill: color, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function RegimeValues({ data }) {
  const [symbol, setSymbol] = useState(data.meta.symbols[0] ?? "BTCUSD");

  const entry = data.regime_values.per_symbol.find((p) => p.symbol === symbol);
  const rows = useMemo(() => (entry ? toRows(entry.bars) : []), [entry]);

  const counts = useMemo(() => {
    const c = { trend_up: 0, trend_down: 0, neutral: 0 };
    // Guard: a bar with a missing/unexpected regime key would otherwise make
    // `c[r.regime] += 1` NaN, which renders as the literal string "NaN".
    for (const r of rows) c[r.regime] = (c[r.regime] ?? 0) + 1;
    return c;
  }, [rows]);

  const syncId = `regime-${symbol}`;

  const priceDomain = useMemo(() => {
    if (rows.length === 0) return [0, 1];
    const lo = Math.min(...rows.map((r) => r.close));
    const hi = Math.max(...rows.map((r) => r.close));
    const pad = (hi - lo) * 0.06 || hi * 0.02 || 1;
    return [lo - pad, hi + pad];
  }, [rows]);

  if (!entry) {
    return <p className="text-sm text-muted-foreground">No regime-value series for {symbol}.</p>;
  }

  const barsShown = rows.length;
  const total = entry.bars.length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabs tabs-border" role="tablist" aria-label="Symbol">
          {data.meta.symbols.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={symbol === s}
              className={`tab ${symbol === s ? "tab-active" : ""}`}
              onClick={() => setSymbol(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          last {total} bars · showing {barsShown} points · {symbol}
        </p>
      </div>

      <div className="rounded-xl border border-base-300 bg-base-100 p-3 pb-1 md:p-4 md:pb-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LegendItem color={SERIES_COLORS.zinc}>close</LegendItem>
            <LegendItem color={REGIME_COLORS.trend_up}>trend_up</LegendItem>
            <LegendItem color={REGIME_COLORS.trend_down}>trend_down</LegendItem>
            <LegendItem color="rgba(161,161,170,0.45)">neutral</LegendItem>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {counts.trend_up} up / {counts.trend_down} down / {counts.neutral} neutral of{" "}
            {barsShown}
          </p>
        </div>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              syncId={syncId}
              margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
            >
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="t"
                tick={AXIS_TICK_STYLE}
                tickFormatter={fmtDateLabel}
                interval="preserveStartEnd"
                minTickGap={64}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                tick={AXIS_TICK_STYLE}
                domain={priceDomain}
                width={64}
                tickFormatter={(v) => fmtNum(v, 0)}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={<RegimeTooltip />}
                cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 3" }}
              />
              {/* base close line (neutral zinc) */}
              <Line
                type="monotone"
                dataKey="close"
                stroke={SERIES_COLORS.zinc}
                strokeWidth={1.25}
                strokeOpacity={0.55}
                dot={false}
                activeDot={{ r: 2.5, fill: SERIES_COLORS.zinc, strokeWidth: 0 }}
                isAnimationActive={false}
              />
              {/* regime overlays — see implementation note above toRows() */}
              <Line
                type="monotone"
                dataKey="close_up"
                stroke={REGIME_COLORS.trend_up}
                strokeWidth={1.75}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 3, fill: REGIME_COLORS.trend_up, strokeWidth: 0 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="close_down"
                stroke={REGIME_COLORS.trend_down}
                strokeWidth={1.75}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 3, fill: REGIME_COLORS.trend_down, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SmallAreaChart
          rows={rows}
          dataKey="trend"
          color={SERIES_COLORS.violet}
          label="trend (signed ER24)"
          domain={[-1, 1]}
          syncId={syncId}
        />
        <SmallAreaChart
          rows={rows}
          dataKey="chop"
          color={SERIES_COLORS.amber}
          label="chop (Choppiness/100)"
          domain={[0, 1]}
          syncId={syncId}
        />
        <SmallAreaChart
          rows={rows}
          dataKey="vol"
          color={SERIES_COLORS.teal}
          label="vol (ATR percentile)"
          domain={[0, 1]}
          syncId={syncId}
        />
      </div>

      <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
        trend = signed Kaufman ER(24) in [-1,1] · chop = Choppiness(14)/100 · vol = rolling ATR
        percentile — deterministic, point-in-time, no lookahead (proven by test). The tri-state
        label trend_up / trend_down / neutral supplies the neutral state the live HMM vocabulary
        lacks.
      </p>
    </div>
  );
}
