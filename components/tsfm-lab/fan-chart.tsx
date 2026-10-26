"use client"

/* ---------------------------------------------------------------------------
 * FanChart — the lab's main instrument (screenshot-parity aesthetic:
 * white history, orange quantile fan, dashed actual overlay, regime shading,
 * CUSUM shift marks, cutoff line, hover crosshair).
 * ------------------------------------------------------------------------- */

import { useCallback, useMemo, useRef, useState } from "react"
import type { ForecastPoint, HistoryPoint, SeriesId, Target } from "@/lib/tsfm-lab/design"
import { CCY_SYMBOL } from "@/lib/tsfm-lab/design"

export interface FanChartProps {
  history: HistoryPoint[]
  fan: ForecastPoint[]
  intervals: { label: string; lo: number; hi: number }[]
  showActual: boolean
  yLabel: string
  /** Price is modelled in log space but read in level space — exponentiate for display. */
  target?: Target
  /** Quote currency for the tooltip's price read (BTCUSD → $, USDJPY → ¥, …). */
  series?: SeriesId
  height?: number
}

const W = 1200
const H = 440
const PAD = { l: 74, r: 26, t: 18, b: 40 }

const qk = (p: ForecastPoint, key: string): number =>
  (p as unknown as Record<string, number>)[key]

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
function fmtDateLong(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
  })
}

export function FanChart({
  history,
  fan,
  intervals,
  showActual,
  yLabel,
  target,
  series,
}: FanChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ x: number; i: number; fi?: number } | null>(null)

  /** Price is modelled as log close, but the chart is read in level space. exp() is
   *  monotone, so the quantile fan maps cleanly and stays a valid fan. */
  const isPrice = target === "price"
  /** Stable identity so the memo hooks below can list it without re-running every render. */
  const lift = useCallback(
    (v: number | null | undefined): number | null =>
      v == null || !Number.isFinite(v) ? null : isPrice ? Math.exp(v) : v,
    [isPrice],
  )

  /** Axis ticks: price levels get thousands separators, log/other space stays fixed-precision. */
  const fmtAxis = (v: number) =>
    isPrice
      ? v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2 })
      : v.toFixed(3)

  const geom = useMemo(() => {
    const t0 = history.length ? Date.parse(history[0].t) : 0
    const tEnd = fan.length ? Date.parse(fan[fan.length - 1].t) : t0
    const tCut = history.length ? Date.parse(history[history.length - 1].t) : t0
    let lo = Infinity
    let hi = -Infinity
    for (const p of history) {
      const v = lift(p.v)
      if (v == null) continue
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    for (const f of fan) {
      for (const k of ["q05", "q10", "q25", "q50", "q75", "q90", "q95", "actual"]) {
        const v = lift(qk(f, k))
        if (v != null) {
          lo = Math.min(lo, v)
          hi = Math.max(hi, v)
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0
      hi = 1
    }
    const pad = (hi - lo) * 0.06 || 0.01
    lo -= pad
    hi += pad
    const span = tEnd - t0 || 1
    const x = (t: number) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r)
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
    return { t0, tEnd, tCut, lo, hi, x, y }
  }, [history, fan, lift])

  const yTicks = useMemo(() => {
    const n = 6
    const out: number[] = []
    for (let i = 0; i <= n; i++) out.push(geom.lo + ((geom.hi - geom.lo) * i) / n)
    return out
  }, [geom])

  const xTicks = useMemo(() => {
    const n = 6
    const out: number[] = []
    for (let i = 0; i <= n; i++) out.push(geom.t0 + ((geom.tEnd - geom.t0) * i) / n)
    return out
  }, [geom])

  const regimeSegs = useMemo(() => {
    const segs: { x0: number; x1: number; regime: number }[] = []
    let segStart = 0
    for (let i = 1; i <= history.length; i++) {
      const rPrev = history[i - 1].regime ?? 1
      const r = i === history.length ? -1 : (history[i].regime ?? 1)
      if (r !== rPrev) {
        segs.push({
          x0: geom.x(Date.parse(history[segStart].t)),
          x1: geom.x(Date.parse(history[i - 1].t)),
          regime: rPrev,
        })
        segStart = i
      }
    }
    return segs
  }, [history, geom])

  const shiftMarks = useMemo(
    () => history.filter((p) => p.shift).slice(-12),
    [history],
  )

  const historyPath = useMemo(() => {
    let d = ""
    let pen = false
    for (const p of history) {
      const v = lift(p.v)
      if (v == null) {
        pen = false
        continue
      }
      const X = geom.x(Date.parse(p.t)).toFixed(1)
      const Y = geom.y(v).toFixed(1)
      d += `${pen ? "L" : "M"}${X},${Y}`
      pen = true
    }
    return d
  }, [history, geom, lift])

  const anchor = useMemo(() => {
    const last = history[history.length - 1]
    if (!last) return null
    const v = lift(last.v)
    return v == null ? null : { t: Date.parse(last.t), v }
  }, [history, lift])

  const bandPath = (loKey: string, hiKey: string): string => {
    if (!fan.length || !anchor) return ""
    const pts: string[] = [`M${geom.x(anchor.t).toFixed(1)},${geom.y(anchor.v).toFixed(1)}`]
    for (const f of fan)
      pts.push(`L${geom.x(Date.parse(f.t)).toFixed(1)},${geom.y(lift(qk(f, hiKey))!).toFixed(1)}`)
    for (let i = fan.length - 1; i >= 0; i--) {
      const f = fan[i]
      pts.push(`L${geom.x(Date.parse(f.t)).toFixed(1)},${geom.y(lift(qk(f, loKey))!).toFixed(1)}`)
    }
    pts.push(`L${geom.x(anchor.t).toFixed(1)},${geom.y(anchor.v).toFixed(1)}`)
    return pts.join("")
  }

  const medianPath = useMemo(() => {
    if (!fan.length || !anchor) return ""
    let d = `M${geom.x(anchor.t).toFixed(1)},${geom.y(anchor.v).toFixed(1)}`
    for (const f of fan)
      d += `L${geom.x(Date.parse(f.t)).toFixed(1)},${geom.y(lift(f.q50)!).toFixed(1)}`
    return d
  }, [fan, anchor, geom, lift])

  const actualPath = useMemo(() => {
    let d = ""
    let pen = false
    for (const f of fan) {
      const v = lift(f.actual)
      if (v == null) {
        pen = false
        continue
      }
      const X = geom.x(Date.parse(f.t)).toFixed(1)
      const Y = geom.y(v).toFixed(1)
      d += `${pen ? "L" : "M"}${X},${Y}`
      pen = true
    }
    return d
  }, [fan, geom, lift])

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg || !history.length) return
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    if (px < PAD.l || px > W - PAD.r) {
      setHover(null)
      return
    }
    const t = geom.t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (geom.tEnd - geom.t0)
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < history.length; i++) {
      const d = Math.abs(Date.parse(history[i].t) - t)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    let fi = -1
    let fd = Infinity
    for (let i = 0; i < fan.length; i++) {
      const d = Math.abs(Date.parse(fan[i].t) - t)
      if (d < fd) {
        fd = d
        fi = i
      }
    }
    const inFan = fi >= 0 && fd < bestD && t > geom.tCut
    setHover(inFan ? { x: px, i: -1, fi } : { x: px, i: best })
  }

  const hoverInfo = useMemo(() => {
    if (!hover) return null
    if (hover.i >= 0) {
      const p = history[hover.i]
      if (!p) return null
      return {
        t: p.t,
        h: null as number | null,
        rows: [
          { k: "price", v: lift(p.v), color: "#f8fafc" },
          { k: "regime", v: ["bear", "neutral", "bull"][p.regime ?? 1], color: "#94a3b8" },
        ],
      }
    }
    const fi = hover.fi ?? -1
    if (fi < 0) return null
    const f = fan[fi]
    if (!f) return null
    const rows = [
      { k: "q95", v: lift(f.q95), color: "#fdba74" },
      { k: "q90", v: lift(f.q90), color: "#fdba74" },
      { k: "q75", v: lift(f.q75), color: "#fb923c" },
      { k: "median", v: lift(f.q50), color: "#f97316" },
      { k: "q25", v: lift(f.q25), color: "#fb923c" },
      { k: "q10", v: lift(f.q10), color: "#fdba74" },
      { k: "q05", v: lift(f.q05), color: "#fdba74" },
    ]
    const act = lift(f.actual)
    if (act != null) rows.push({ k: "actual", v: act, color: "#cbd5e1" })
    return { t: f.t, h: f.h as number | null, rows }
  }, [hover, history, fan, lift])

  const bandFills = [
    { key: "90%", fill: "rgba(249,115,22,0.10)" },
    { key: "80%", fill: "rgba(249,115,22,0.17)" },
    { key: "50%", fill: "rgba(249,115,22,0.30)" },
  ]
  const enabled = new Set(intervals.map((i) => i.label))
  const bandKeys: Record<string, [string, string]> = {
    "90%": ["q05", "q95"],
    "80%": ["q10", "q90"],
    "50%": ["q25", "q75"],
  }

  return (
    <div className="relative w-full select-none">
      {/* regime legend — the shading is otherwise unreadable at a glance */}
      <div className="mb-1.5 flex items-center gap-4 px-1 font-mono text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: "rgba(34,197,94,0.75)" }}
          />
          bull
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: "rgba(148,163,184,0.55)" }}
          />
          neutral
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-[2px]"
            style={{ background: "rgba(239,68,68,0.75)" }}
          />
          bear
        </span>
        <span className="ml-auto hidden text-slate-600 sm:inline">
          regime = input covariate, not forecast · 168h rolling OLS slope
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Forecast fan chart: ${yLabel}`}
      >
        {regimeSegs.map((s, i) => (
          <rect
            key={`regime-${i}`}
            x={s.x0}
            y={PAD.t}
            width={Math.max(0, s.x1 - s.x0)}
            height={H - PAD.t - PAD.b}
            fill={
              s.regime === 2
                ? "rgba(34,197,94,0.16)"
                : s.regime === 0
                  ? "rgba(239,68,68,0.16)"
                  : "rgba(148,163,184,0.05)"
            }
          />
        ))}
        {yTicks.map((v, i) => (
          <g key={`y-${i}`}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={geom.y(v)}
              y2={geom.y(v)}
              stroke="rgba(148,163,184,0.12)"
              strokeWidth="1"
            />
            <text
              x={PAD.l - 10}
              y={geom.y(v) + 4}
              textAnchor="end"
              fontSize="13"
              fill="#64748b"
              fontFamily="var(--font-geist-mono, monospace)"
            >
              {fmtAxis(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={`x-${i}`}
            x={geom.x(t)}
            y={H - 12}
            textAnchor="middle"
            fontSize="13"
            fill="#64748b"
            fontFamily="var(--font-geist-mono, monospace)"
          >
            {fmtDate(new Date(t).toISOString())}
          </text>
        ))}
        <text
          x={16}
          y={H - PAD.b - 4}
          fontSize="12"
          fill="#94a3b8"
          fontFamily="var(--font-geist-mono, monospace)"
          transform={`rotate(-90 16 ${H - PAD.b - 4})`}
          textAnchor="end"
        >
          {yLabel}
        </text>
        {bandFills.map((b) => {
          if (!enabled.has(b.key)) return null
          const [loK, hiK] = bandKeys[b.key]
          return <path key={b.key} d={bandPath(loK, hiK)} fill={b.fill} stroke="none" />
        })}
        {showActual && actualPath && (
          <path
            d={actualPath}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="1.6"
            strokeDasharray="5 4"
            opacity="0.9"
          />
        )}
        <path d={historyPath} fill="none" stroke="#f8fafc" strokeWidth="1.5" />
        {medianPath && (
          <path d={medianPath} fill="none" stroke="#f97316" strokeWidth="2.2" />
        )}
        <line
          x1={geom.x(geom.tCut)}
          x2={geom.x(geom.tCut)}
          y1={PAD.t}
          y2={H - PAD.b}
          stroke="#f97316"
          strokeWidth="1.2"
          strokeDasharray="3 3"
          opacity="0.8"
        />
        {/* The right edge is a backtest origin, not "now" — label both ends so the
            staleness is explicit rather than implied. */}
        <text
          x={geom.x(geom.tCut) - 6}
          y={PAD.t + 12}
          textAnchor="end"
          fontSize="10"
          fill="#f97316"
          fontFamily="var(--font-geist-mono, monospace)"
        >
          {fmtDate(new Date(geom.tCut).toISOString())} · backtest origin
        </text>
        <text
          x={W - PAD.r}
          y={PAD.t + 12}
          textAnchor="end"
          fontSize="10"
          fill="#64748b"
          fontFamily="var(--font-geist-mono, monospace)"
        >
          fan → {fmtDate(new Date(geom.tEnd).toISOString())}
        </text>
        {shiftMarks.map((m, i) => (
          <line
            key={`shift-${i}`}
            x1={geom.x(Date.parse(m.t))}
            x2={geom.x(Date.parse(m.t))}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="rgba(148,163,184,0.45)"
            strokeWidth="1"
            strokeDasharray="2 5"
          />
        ))}
        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="rgba(248,250,252,0.25)"
            strokeWidth="1"
          />
        )}
      </svg>
      {hoverInfo && hover && (
        <div
          className="absolute pointer-events-none z-10 rounded-md border border-orange-500/30 bg-neutral-950/95 px-3 py-2 text-[11px] font-mono shadow-xl"
          style={{
            left: `${(hover.x / W) * 100}%`,
            top: 12,
            transform: hover.x > W * 0.72 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          }}
        >
          <div className="text-slate-400 mb-1">
            {fmtDateLong(hoverInfo.t)}
            {hoverInfo.h != null ? ` · +${hoverInfo.h}h` : ""}
          </div>
          {hoverInfo.rows.map((r) => (
            <div key={r.k} className="flex justify-between gap-4">
              <span style={{ color: r.color }}>{r.k}</span>
              <span className="text-slate-200">
                {typeof r.v === "number"
                  ? isPrice
                    ? CCY_SYMBOL[series ?? "BTCUSD"] +
                      r.v.toLocaleString("en-US", { maximumFractionDigits: 2 })
                    : r.v.toFixed(4)
                  : String(r.v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
