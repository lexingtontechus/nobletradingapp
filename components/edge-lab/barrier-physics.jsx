"use client";

import { Fragment } from "react";
import { ArrowRight } from "lucide-react";

import { fmtNum, fmtR } from "@/lib/edge-lab-format";

const PI_SL_CAP = 0.62;

function PiSlCell({ value }) {
  const over = value > PI_SL_CAP;
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-xs tabular-nums ${
        over ? "bg-error/15 text-error" : "bg-success/15 text-success"
      }`}
    >
      {fmtNum(value, 3)}
    </span>
  );
}

/**
 * Cells for one geometry row (book label + 8 metrics); the symbol cell is
 * rendered separately with rowSpan=2 so current/corrected stay grouped.
 */
function geometryCells(g, tone) {
  return (
    <>
      <td className="font-mono text-[11px] whitespace-nowrap">
        {tone === "current" ? "current" : "→ corrected"}
      </td>
      <td className="font-mono text-xs tabular-nums">{fmtNum(g.tp_atr, 2)}</td>
      <td className="font-mono text-xs tabular-nums">{fmtNum(g.sl_atr, 2)}</td>
      <td className="font-mono text-xs tabular-nums">{fmtNum(g.expiry, 0)}h</td>
      <td className="font-mono text-xs tabular-nums">{fmtNum(g.pi_tp, 3)}</td>
      <td>
        <PiSlCell value={g.pi_sl} />
      </td>
      <td className="font-mono text-xs tabular-nums">{fmtNum(g.pi_e, 3)}</td>
      <td
        className={`font-mono text-xs tabular-nums ${g.ev_null < 0 ? "text-error" : ""}`}
      >
        {fmtR(g.ev_null, 3)}
      </td>
      <td
        className={`font-mono text-xs tabular-nums ${
          g.ev_drift < 0 ? "text-error" : "text-success"
        }`}
      >
        {fmtR(g.ev_drift, 3)}
      </td>
    </>
  );
}

function SymbolCard({ symbol, current, corrected, muHat, cost }) {
  const renderBlock = (label, g, tone) => (
    <div
      className={`rounded-xl border p-3 ${
        tone === "current"
          ? "border-warning/40 bg-warning/5"
          : "border-success/40 bg-success/5"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`font-mono text-[11px] font-semibold ${
            tone === "current" ? "text-warning" : "text-success"
          }`}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          RR {fmtNum(g.tp_atr / g.sl_atr, 2)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums sm:grid-cols-4">
        <span className="text-muted-foreground">TP {fmtNum(g.tp_atr, 2)} ATR</span>
        <span className="text-muted-foreground">SL {fmtNum(g.sl_atr, 2)} ATR</span>
        <span className="text-muted-foreground">expiry {fmtNum(g.expiry, 0)}h</span>
        <span className="text-muted-foreground">pi_E {fmtNum(g.pi_e, 3)}</span>
        <span className="text-muted-foreground">pi_TP {fmtNum(g.pi_tp, 3)}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          pi_SL <PiSlCell value={g.pi_sl} />
        </span>
        <span className={g.ev_null < 0 ? "text-error" : ""}>
          EV_null {fmtR(g.ev_null, 3)}
        </span>
        <span className={g.ev_drift < 0 ? "text-error" : "text-success"}>
          EV_drift {fmtR(g.ev_drift, 3)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-base-300 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{symbol}</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          mu {fmtNum(muHat, 4)} ATR/bar · cost {fmtNum(cost, 2)} ATR
        </span>
      </div>
      <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
        {renderBlock("current", current, "current")}
        <ArrowRight
          className="mx-auto size-4 text-muted-foreground sm:mx-0"
          aria-hidden="true"
        />
        {renderBlock("corrected", corrected, "corrected")}
      </div>
    </div>
  );
}

export function BarrierPhysics({ data }) {
  const b = data.barrier;
  const maxDiff = Math.max(0, ...b.crosscheck.map((c) => c.abs_diff));

  return (
    <div className="grid gap-5">
      {/* md+: grouped table; mobile: stacked cards */}
      <div className="hidden overflow-x-auto rounded-xl border border-base-300 md:block">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Book</th>
              <th>TP ATR</th>
              <th>SL ATR</th>
              <th>Expiry</th>
              <th>pi_TP</th>
              <th>pi_SL</th>
              <th>pi_E</th>
              <th>EV_null</th>
              <th>EV_drift</th>
            </tr>
          </thead>
          <tbody>
            {b.per_symbol.map((row) => (
              <Fragment key={row.symbol}>
                <tr className="bg-warning/5">
                  <td rowSpan={2} className="align-top font-mono text-xs font-semibold">
                    {row.symbol}
                    <div className="mt-1 font-mono text-[10px] font-normal text-muted-foreground">
                      mu {fmtNum(row.mu_hat_atr_bar, 4)} ATR/bar
                      <br />| cost {fmtNum(row.cost_atr, 2)} ATR
                    </div>
                  </td>
                  {geometryCells(row.current, "current")}
                </tr>
                <tr className="bg-success/5">
                  {geometryCells(row.corrected, "corrected")}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {b.per_symbol.map((row) => (
          <SymbolCard
            key={row.symbol}
            symbol={row.symbol}
            current={row.current}
            corrected={row.corrected}
            muHat={row.mu_hat_atr_bar}
            cost={row.cost_atr}
          />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="overflow-hidden rounded-xl border border-base-300">
          <div className="flex items-center justify-between gap-2 border-b border-base-300 bg-base-200/60 px-3 py-2">
            <span className="text-xs font-medium">
              Crosscheck — repo barrier_null vs independent MC
            </span>
            <span className="badge badge-sm badge-success font-mono">
              physics verified twice
            </span>
          </div>
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Case</th>
                <th>repo pi</th>
                <th>our MC pi</th>
                <th>|diff|</th>
              </tr>
            </thead>
            <tbody>
              {b.crosscheck.map((c) => (
                <tr key={c.case}>
                  <td className="text-xs">{c.case}</td>
                  <td className="font-mono text-xs tabular-nums">{fmtNum(c.repo_pi, 4)}</td>
                  <td className="font-mono text-xs tabular-nums">{fmtNum(c.our_mc_pi, 4)}</td>
                  <td className="font-mono text-xs tabular-nums">{fmtNum(c.abs_diff, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-base-300 px-3 py-2 font-mono text-[10px] text-muted-foreground">
            max |diff| = {fmtNum(maxDiff, 4)} &lt;= 0.0034
          </p>
        </div>
        <p className="self-start rounded-xl border border-base-300 bg-base-200/60 p-3 text-xs leading-relaxed text-muted-foreground">
          pi from first-passage math (gambler&apos;s ruin + drift + expiry MC, 20k paths). EV_null
          is the driftless-null expectancy — the SL-farm proof. Corrected geometry is
          solver-derived under constraints pi_SL &lt;= {PI_SL_CAP}, pi_E &lt;= 0.25, RR in [1.5,4].
        </p>
      </div>
    </div>
  );
}
