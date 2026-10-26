"use client"

/* ---------------------------------------------------------------------------
 * EvalSection — the rolling-origin evidence table (pinball, CRPS, coverage,
 * DM z/p, skill ratio; Brier/accuracy for the direction target), the PIT
 * calibration histograms, and the verdict gate.
 * Ported from shadcn table primitives to native <table> + daisyUI badges.
 * ------------------------------------------------------------------------- */

import type { EvalResponse } from "@/lib/tsfm-lab/design"
import { cn } from "@/lib/utils"

function PitBars({ bins, label, accent }: { bins: number[]; label: string; accent: string }) {
  const max = Math.max(0.08, ...bins)
  const n = bins.length
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] text-slate-400">{label}</span>
        <span className="font-mono text-[10px] text-slate-500">uniform = {(1 / n * 100).toFixed(1)}%/bin</span>
      </div>
      <div className="flex items-end gap-[3px] h-16">
        {bins.map((b, i) => (
          <div
            key={i}
            className={cn("flex-1 rounded-t-sm transition-all", accent)}
            style={{ height: `${Math.max(2, (b / max) * 100)}%` }}
            title={`bin ${(i + 1)}/${n}: ${(b * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <div className="mt-1 h-px bg-slate-700" />
    </div>
  )
}

function covColor(c: number, nominal: number): string {
  const d = Math.abs(c - nominal)
  if (d <= 0.05) return "text-emerald-400"
  if (d <= 0.1) return "text-amber-400"
  return "text-red-400"
}

export interface EvalSectionProps {
  data: EvalResponse | null
  loading: boolean
  error: string | null
}

export function EvalSection({ data, loading, error }: EvalSectionProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-44 w-full" />
        <div className="skeleton h-24 w-full" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
        Evaluation failed: {error}
      </div>
    )
  }
  if (!data) return null
  const isDirection = data.target === "direction"
  const tsfm = data.rows.find((r) => r.model === "tsfm")

  return (
    <div className="space-y-4">
      {/* verdict gate */}
      <div
        className={cn(
          "rounded-lg border px-4 py-3.5",
          data.verdict.passed === true
            ? "border-emerald-500/40 bg-emerald-500/[0.06]"
            : data.verdict.passed === false
              ? "border-red-500/40 bg-red-500/[0.06]"
              : "border-amber-500/40 bg-amber-500/[0.06]",
        )}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[11px] uppercase tracking-wider text-slate-400">Verdict gate</span>
          <span
            className={cn(
              "badge badge-outline",
              data.verdict.passed === true
                ? "border-emerald-500/40 text-emerald-300"
                : data.verdict.passed === false
                  ? "border-red-500/40 text-red-300"
                  : "border-amber-500/40 text-amber-300",
            )}
          >
            {data.verdict.passed === true ? "PASS" : data.verdict.passed === false ? "FAIL" : "UNDECIDED"}
          </span>
          <span className="text-sm text-slate-200">{data.verdict.gate}</span>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{data.verdict.detail}</p>
        <p className="mt-1 font-mono text-[11px] text-slate-500">
          {data.n} rolling origins · {data.horizon}h horizon · frozen models · 72-bar embargo
        </p>
      </div>

      {/* metric table — native <table>, daisyUI badge spans */}
      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full border-collapse text-[13px]">
          <thead className="border-neutral-800">
            <tr className="border-neutral-800 hover:bg-transparent">
              <th className="text-slate-300 h-9 font-semibold text-left">Model</th>
              {isDirection ? (
                <>
                  <th className="text-right h-9 font-semibold">Brier ↓</th>
                  <th className="text-right h-9 font-semibold">Accuracy</th>
                  <th className="text-right h-9 font-semibold">DM z vs bar</th>
                  <th className="text-right h-9 font-semibold">DM p</th>
                </>
              ) : (
                <>
                  <th className="text-right h-9 font-semibold">Pinball ↓</th>
                  <th className="text-right h-9 font-semibold">CRPS ↓</th>
                  <th className="text-right h-9 font-semibold">Cov 50% / 80% / 90%</th>
                  <th className="text-right h-9 font-semibold">Skill vs bar</th>
                  <th className="text-right h-9 font-semibold">DM z</th>
                  <th className="text-right h-9 font-semibold">DM p</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="border-neutral-800">
            {data.rows.map((r) => {
              const isBar = r.model === data.bar
              const isTsfm = r.model === "tsfm" || r.model === "tsfm_base"
              const isReal = r.model === "timestral"
              return (
                <tr
                  key={r.model}
                  className={cn("border-neutral-800", isReal && "bg-orange-500/[0.05]")}
                >
                  <td
                    className={cn(
                      "font-medium h-8",
                      isReal || isTsfm ? "text-orange-300" : "text-slate-300",
                      isBar && "italic",
                    )}
                  >
                    {r.label}
                    {isReal && (
                      <span
                        className={cn(
                          "badge badge-outline ml-1.5 h-4 border-orange-500/40 bg-orange-500/10 px-1 align-middle text-[9px] uppercase tracking-wide text-orange-300",
                        )}
                      >
                        REAL · zero-shot
                      </span>
                    )}
                    {isBar && <span className="ml-1.5 text-[10px] text-slate-500">(bar)</span>}
                  </td>
                  {isDirection ? (
                    <>
                      <td className="text-right font-mono h-8 text-slate-300">
                        <span
                          className={
                            r.brier != null && r.brier < 0.25 ? "text-emerald-400" : "text-red-400"
                          }
                        >
                          {r.brier?.toFixed(4) ?? "—"}
                        </span>
                      </td>
                      <td className="text-right font-mono h-8 text-slate-300">
                        {r.acc != null ? `${(r.acc * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="text-right font-mono h-8 text-slate-300">
                        {r.dmZ != null ? r.dmZ.toFixed(2) : "—"}
                      </td>
                      <td className="text-right font-mono h-8 text-slate-300">
                        {r.dmP != null ? r.dmP.toFixed(4) : "—"}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-right font-mono h-8 text-slate-300">{r.pinball.toFixed(4)}</td>
                      <td className="text-right font-mono h-8 text-slate-300">{r.crps.toFixed(4)}</td>
                      <td className="text-right font-mono h-8">
                        <span className={covColor(r.cov50, 0.5)}>{(r.cov50 * 100).toFixed(0)}%</span>
                        <span className="text-slate-600"> / </span>
                        <span className={covColor(r.cov80, 0.8)}>{(r.cov80 * 100).toFixed(0)}%</span>
                        <span className="text-slate-600"> / </span>
                        <span className={covColor(r.cov90, 0.9)}>{(r.cov90 * 100).toFixed(0)}%</span>
                      </td>
                      <td className="text-right font-mono h-8">
                        {r.skillRatio != null ? (
                          <span
                            className={cn(
                              r.skillRatio < 0.98
                                ? "text-emerald-400"
                                : r.skillRatio > 1.02
                                  ? "text-red-400"
                                  : "text-amber-400",
                            )}
                          >
                            {r.skillRatio.toFixed(3)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-right font-mono h-8 text-slate-300">
                        {r.dmZ != null ? r.dmZ.toFixed(2) : "—"}
                      </td>
                      <td className="text-right font-mono h-8 text-slate-300">
                        {r.dmP != null ? r.dmP.toFixed(4) : "—"}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* real-arm availability note */}
      {data.timestral && data.timestral.available === false && (
        <p className="text-[11px] italic text-slate-500">
          Timestral-5M arm unavailable on this view{data.timestral.note ? ` — ${data.timestral.note}` : ""}. The rows above are the
          clearly-labeled ridge stand-ins.
        </p>
      )}

      {/* covariate-deafness ablation (real-model shuffle test) */}
      {data.ablation && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-[13px] font-semibold text-slate-200">
              Covariate-deafness test — shuffle Δ-CRPS
            </p>
            <span
              className={cn(
                "badge badge-outline border-neutral-700 text-slate-400 font-normal text-[10px]",
              )}
            >
              wrong values, right distribution
            </span>
          </div>
          <div className="space-y-1.5 font-mono text-[11.5px]">
            {([
              ["past-only channels shuffled (Δ-CRPS)", data.ablation.shufflePast],
              ["known-future channels shuffled (Δ-CRPS)", data.ablation.shuffleKnown],
            ] as const).map(([label, blk]) => {
              const d = blk?.deltaPct
              const tone =
                d == null
                  ? "text-slate-500"
                  : d > 0.5
                    ? "text-emerald-400"
                    : d < -0.5
                      ? "text-red-400"
                      : "text-amber-400"
              const tag =
                d == null
                  ? "n/a"
                  : d > 0.5
                    ? "earning rent"
                    : d < -0.5
                      ? "covariate-deaf"
                      : "≈ deaf"
              return (
                <div key={label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="text-slate-400">{label}</span>
                  <span className={tone}>
                    {d != null ? `${d >= 0 ? "+" : ""}${d.toFixed(1)}%` : "—"}
                    <span className="ml-1.5 text-[10px] lowercase tracking-wide opacity-80">{tag}</span>
                    {blk?.crps != null && (
                      <span className="ml-2 text-[10px] text-slate-600">shuffled CRPS {blk.crps.toFixed(4)}</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Wrong values, right distribution — if shuffling doesn&apos;t hurt, the model wasn&apos;t reading the channel. Positive
            Δ-CRPS = the covariates were earning rent; ≈0 / negative = the model is covariate-deaf on this view.
          </p>
        </div>
      )}

      {/* PIT histograms */}
      <div
        className={cn(
          "grid gap-4",
          data.pitTimestral ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2",
        )}
      >
        <div className="rounded-lg border border-orange-500/25 bg-orange-500/[0.03] p-3.5">
          <PitBars bins={data.pit} label="PIT · Ridge stand-in (covariates ON)" accent="bg-orange-500/70" />
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Uniform ⇒ calibrated fan. U-shape ⇒ too narrow; hump ⇒ too wide.
            {tsfm && !isDirection ? ` Median-centered 80% coverage: ${(tsfm.cov80 * 100).toFixed(0)}%.` : ""}
          </p>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3.5">
          <PitBars bins={data.pitBase} label="PIT · Ridge stand-in (univariate ablation)" accent="bg-slate-500/70" />
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            The zero-shot analog: target lags only, no conditioning. Compare shapes to see what covariates
            buy beyond calibration.
          </p>
        </div>
        {data.pitTimestral && (
          <div className="rounded-lg border border-orange-500/45 bg-orange-500/[0.05] p-3.5">
            <PitBars bins={data.pitTimestral} label="PIT · Timestral-5M (real · zero-shot)" accent="bg-amber-400/80" />
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              The real model&apos;s fan through the same 20-bin probe — calibration is the one thing zero-shot must
              get right for free.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
