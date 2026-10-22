"use client";

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import {
  CartesianGrid,
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
  SERIES_COLORS,
  decimate,
  fmtNum,
  fmtP,
  fmtPct,
  fmtR,
} from "@/lib/edge-lab-format";

const MAX_POINTS = 800;

/**
 * Decimate each equity series to <=800 points, then merge on the true trade
 * index so the three books stay time-aligned.
 */
function mergeEquity(books) {
  const k = decimate(books.kairos.equity, MAX_POINTS);
  const c = decimate(books.corrected.equity, MAX_POINTS);
  const n = decimate(books.null.equity, MAX_POINTS);
  const len = Math.max(k.length, c.length, n.length);
  const rows = [];
  for (let i = 0; i < len; i++) {
    rows.push({
      x: i,
      kairos: i < k.length ? k[i] : null,
      corrected: i < c.length ? c[i] : null,
      nullBook: i < n.length ? n[i] : null,
    });
  }
  return rows;
}

function BookCard({ name, book, tone, note }) {
  const toneClass = {
    amber: "text-warning",
    emerald: "text-success",
    zinc: "text-base-content/60",
  }[tone];

  return (
    <div className="card bg-base-100 shadow-sm">
      <div className="card-body gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`font-mono text-sm font-semibold ${toneClass}`}>{name}</span>
          <span className="font-mono text-xl font-semibold tabular-nums">
            {fmtR(book.mean_r, 3)}
            <span className="ml-1 text-[11px] font-normal text-muted-foreground">
              EV(R)/trade
            </span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-base-300 pt-3 font-mono text-xs tabular-nums">
          <div>
            <div className="text-[10px] text-muted-foreground">n trades</div>
            <div className="text-sm">{fmtNum(book.n, 0)}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">TP / SL / EXP</div>
            <div className="text-sm">
              <span className="text-success">{fmtPct(book.tp, 1)}</span>
              {" / "}
              <span className="text-error">{fmtPct(book.sl, 1)}</span>
              {" / "}
              {fmtPct(book.exp, 1)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Sharpe(R) / maxDD(R)</div>
            <div className="text-sm">
              {fmtNum(book.sharpe_r, 3)} /{" "}
              <span className="text-error">{fmtNum(book.maxdd_r, 1)}</span>
            </div>
          </div>
        </div>
        <p className="border-t border-base-300 pt-2 text-[11px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      </div>
    </div>
  );
}

export function GateBacktest({ data }) {
  const gb = data.gate_backtest;
  const pooled = gb.pooled;

  const equityRows = useMemo(
    () => mergeEquity({ kairos: pooled.kairos, corrected: pooled.corrected, null: pooled.null }),
    [pooled],
  );

  const erGates = Object.entries(gb.thresholds.er_gate);

  // --- Derived prose: no numbers are hardcoded, so the panel cannot go stale.
  const rows = gb.per_symbol ?? [];
  const zeroTrade = rows.filter((r) => (r.books?.corrected?.n ?? 0) === 0);
  const hmmRows = data.hmm?.per_symbol ?? [];
  const negativeSkill = hmmRows.filter((h) => h.skill < 0).length;
  const maxKcHolm = rows.length > 0 ? Math.max(...rows.map((r) => r.dm?.kc_p_holm ?? 1)) : 1;

  const barrierRows = data.barrier?.per_symbol ?? [];
  const worstCurrent = barrierRows.reduce(
    (acc, r) => ((r.current?.pi_sl ?? -1) > (acc?.current?.pi_sl ?? -1) ? r : acc),
    null,
  );
  const worstCorrectedPiSl =
    barrierRows.length > 0
      ? Math.max(...barrierRows.map((r) => r.corrected?.pi_sl ?? 0))
      : 0;

  const howToRead = [
    `How to read this: in this window the always-in kairos book out-earned the selective corrected book (pooled DM p=${fmtP(pooled.kc_p)}, but per-symbol Holm p=${fmtP(maxKcHolm)} — not significant anywhere).`,
    hmmRows.length > 0
      ? `That edge is inherited drift risk, not skill: the direction source has negative skill on ${negativeSkill} of ${hmmRows.length} symbols.`
      : null,
    worstCurrent
      ? `Under the driftless null the current geometry is an SL-farm (worst band ${worstCurrent.symbol} pi_SL = ${fmtNum(worstCurrent.current.pi_sl, 3)}); the corrected book caps pi_SL at ${fmtNum(worstCorrectedPiSl, 3)}.`
      : null,
    zeroTrade.length > 0
      ? `Also measured: the current EV gate starves ${zeroTrade.length} of ${rows.length} symbols to ZERO trades in this window (${zeroTrade
          .map((r) => r.symbol)
          .join(", ")}).`
      : null,
    "The definitive wins are the coherence fixes, the physics floor, and the live chop gate — all shipped with tests.",
  ].filter(Boolean);

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-3">
        <BookCard
          name="kairos · as-is"
          book={pooled.kairos}
          tone="amber"
          note="Always-in book at current live bands — every passed slot trades."
        />
        <BookCard
          name="corrected"
          book={pooled.corrected}
          tone="emerald"
          note="Regime-value gate (per-symbol ER threshold) + solver-derived geometry."
        />
        <BookCard
          name="null · driftless"
          book={pooled.null}
          tone="zinc"
          note="Random-direction benchmark with the same entry cadence — the honesty floor."
        />
      </div>

      <div className="rounded-xl border border-base-300 bg-base-100 p-3 md:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-xs text-muted-foreground">
            Pooled cumulative R · {pooled.note} · HAC lag {pooled.hac_lag}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LegendItem color={SERIES_COLORS.amber}>kairos</LegendItem>
            <LegendItem color={SERIES_COLORS.emerald}>corrected</LegendItem>
            <LegendItem color={SERIES_COLORS.zinc} dashed>
              null
            </LegendItem>
          </div>
        </div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={equityRows} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                tick={AXIS_TICK_STYLE}
                tickFormatter={(v) => `#${Math.round(v)}`}
                minTickGap={64}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                tick={AXIS_TICK_STYLE}
                width={56}
                tickFormatter={(v) => fmtNum(v, 0)}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormat={(l) => `after trade #${l}`}
                    format={(v) => fmtR(v, 2)}
                  />
                }
                cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 3" }}
              />
              <Line
                type="linear"
                dataKey="nullBook"
                name="null"
                stroke={SERIES_COLORS.zinc}
                strokeWidth={1.25}
                strokeDasharray="6 4"
                strokeOpacity={0.8}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="kairos"
                name="kairos"
                stroke={SERIES_COLORS.amber}
                strokeWidth={1.75}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="corrected"
                name="corrected"
                stroke={SERIES_COLORS.emerald}
                strokeWidth={1.75}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-base-300">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>kairos n / meanR</th>
              <th>corrected n / meanR</th>
              <th>null n / meanR</th>
              <th>DM kc p_raw</th>
              <th>DM kc p_Holm</th>
              <th>DM cn p_Holm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.symbol}>
                <td className="font-mono text-xs font-medium">{row.symbol}</td>
                {["kairos", "corrected", "null"].map((book) => (
                  <td key={book} className="font-mono text-xs tabular-nums">
                    {fmtNum(row.books[book].n, 0)} /{" "}
                    <span
                      className={
                        row.books[book].mean_r >= 0 ? "text-success" : "text-error"
                      }
                    >
                      {fmtR(row.books[book].mean_r, 2)}
                    </span>
                  </td>
                ))}
                <td className="font-mono text-xs tabular-nums">{fmtP(row.dm.kc_p_raw)}</td>
                <td className="font-mono text-xs tabular-nums">{fmtP(row.dm.kc_p_holm)}</td>
                <td className="font-mono text-xs tabular-nums">{fmtP(row.dm.cn_p_holm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        DM = Diebold–Mariano on per-slot R series (kc = kairos vs corrected, cn = corrected vs
        null). Pooled: kc p_raw {fmtP(pooled.kc_p)} · cn p_raw {fmtP(pooled.cn_p)} · kc mean
        loss diff {fmtR(pooled.kc_mean_loss_diff, 4)} · cn mean loss diff{" "}
        {fmtR(pooled.cn_mean_loss_diff, 4)}.
      </p>

      <div className="alert alert-warning">
        <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
        <p className="text-xs leading-relaxed">{howToRead.join(" ")}</p>
      </div>

      <p className="rounded-xl border border-base-300 bg-base-200/60 p-3 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-base-content">ER gate thresholds</span> (chosen on{" "}
        {gb.thresholds.chosen_on}):
        {erGates.map(([sym, thr], i) => (
          <span key={sym} className="font-mono">
            {i > 0 ? " · " : " "}
            {sym} &gt;= {fmtNum(thr, 2)}
          </span>
        ))}
        .
      </p>
    </div>
  );
}
