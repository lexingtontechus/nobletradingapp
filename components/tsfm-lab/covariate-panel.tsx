"use client"

import { cn } from "@/lib/utils"
import type { CovariateRow } from "@/lib/tsfm-lab/design"

const CLS_STYLE: Record<string, string> = {
  target: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  past: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  "known-future": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  categorical: "bg-violet-500/15 text-violet-300 border-violet-500/30",
}

/** Compact role legend — the availability-class membership test, in one row. */
const ROLE_LEGEND: { cls: string; label: string; note: string }[] = [
  { cls: "target", label: "target", note: "always on" },
  { cls: "past", label: "past-only", note: "unknowable future" },
  { cls: "categorical", label: "categorical", note: "conditioned on" },
  { cls: "known-future", label: "known-future", note: "zero-uncertainty future" },
]

function Switch({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  ariaLabel: string
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <span className="slider"></span>
    </label>
  )
}

function Spark({ data, future, on }: { data: number[]; future?: number[]; on: boolean }) {
  const all = future && future.length ? [...data, ...future] : data
  if (!all.length) return <div className="h-7 w-[150px]" />
  let lo = Infinity
  let hi = -Infinity
  for (const v of all) {
    if (!Number.isFinite(v)) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 1
  }
  const span = hi - lo || 1
  const W = 150
  const Hh = 28
  const nHist = data.length
  const nAll = all.length
  const x = (i: number) => (i / Math.max(1, nAll - 1)) * W
  const y = (v: number) => 2 + (1 - (v - lo) / span) * (Hh - 4)
  let d = ""
  let pen = false
  for (let i = 0; i < nHist; i++) {
    const v = data[i]
    if (!Number.isFinite(v)) {
      pen = false
      continue
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  }
  let df = ""
  pen = false
  if (future && future.length) {
    const off = nHist - 1
    df = `M${x(off).toFixed(1)},${y(data[nHist - 1]).toFixed(1)}`
    for (let i = 0; i < future.length; i++) df += `L${x(off + 1 + i).toFixed(1)},${y(future[i]).toFixed(1)}`
  }
  const cutX = x(nHist - 1)
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="h-7 w-[150px]" aria-hidden>
      <line x1={cutX} x2={cutX} y1={0} y2={Hh} stroke="rgba(249,115,22,0.35)" strokeWidth="1" strokeDasharray="2 2" />
      <path d={d} fill="none" stroke={on ? "#cbd5e1" : "#64748b"} strokeWidth="1.2" />
      {df && <path d={df} fill="none" stroke={on ? "#34d399" : "#475569"} strokeWidth="1.2" strokeDasharray="3 2" />}
    </svg>
  )
}

export interface CovariatePanelProps {
  rows: CovariateRow[]
  onToggle: (key: string, next: boolean) => void
  interactive: boolean
}

export function CovariatePanel({ rows, onToggle, interactive }: CovariatePanelProps) {
  return (
    <div className="space-y-2.5">
      {/* role legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {ROLE_LEGEND.map((l) => (
          <span key={l.cls} className="flex items-center gap-1.5">
            <span
              className={cn(
                "badge badge-outline h-5 px-1.5 text-[9px] uppercase tracking-wide",
                CLS_STYLE[l.cls],
              )}
            >
              {l.label}
            </span>
            <span className="text-[10.5px] text-slate-500">{l.note}</span>
          </span>
        ))}
      </div>
      {/* rows — capped + scrollable so 17 channels never blow out the page */}
      <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-0.5">
        {rows.map((r) => {
          const locked = r.cls === "target"
          const canToggle = interactive && !locked
          return (
            <div
              key={r.key}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2 transition-colors",
                r.enabled ? "border-orange-500/20 bg-orange-500/[0.04]" : "border-neutral-800 bg-neutral-900/40",
              )}
            >
              <div className="min-w-[140px] max-w-[200px] flex-1">
                <div className="tooltip" data-tip={r.desc}>
                  <div className="truncate text-[13px] font-medium text-slate-200 cursor-help">{r.label}</div>
                </div>
                <span
                  className={cn(
                    "badge badge-outline mt-1 h-4 px-1.5 text-[9px] uppercase tracking-wide",
                    CLS_STYLE[r.cls],
                  )}
                >
                  {r.cls}
                </span>
              </div>
              <div className="flex min-w-[140px] flex-1 items-center justify-center">
                <Spark data={r.spark} future={r.sparkFuture} on={r.enabled} />
              </div>
              <div className="ml-auto flex items-center gap-3">
                <div className="w-20 text-right font-mono text-[11px]">
                  {r.contribution != null ? (
                    <span
                      className={cn(
                        r.contribution >= 3
                          ? "text-emerald-400"
                          : r.contribution <= -1
                            ? "text-red-400"
                            : "text-slate-500",
                      )}
                    >
                      {r.contribution >= 0 ? "+" : ""}
                      {r.contribution.toFixed(1)}%
                    </span>
                  ) : locked ? (
                    <span className="text-slate-600">always on</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    disabled={!canToggle}
                    onChange={(e) => !locked && onToggle(r.key, e.target.checked)}
                    aria-label={`Toggle covariate ${r.label}`}
                  />
                  <span className="slider"></span>
                </label>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
