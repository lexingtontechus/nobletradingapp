"use client"

/* ---------------------------------------------------------------------------
 * VerdictGrid — the five R2 gates that answer "is it truly weak?":
 * (1) Direction & mean edge vs coin & random walk, (2) Vol edge vs Log-HAR,
 * (3) Calibration (coverage ≈ nominal, ±5pp), (4) Covariate use (shuffle
 * Δ-CRPS from the deafness ablation + per-channel LOO importances),
 * (5) GARCH-family challenge (do the proven conditional-variance models
 * displace Log-HAR?).
 * Real-model (Timestral-5M) numbers are preferred when the sidecar served
 * the view; stand-in numbers are tagged as such.
 * ------------------------------------------------------------------------- */

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import type { EvalResponse, MetricRow, ModelId, SeriesId, Target } from "@/lib/tsfm-lab/design"
import { cn } from "@/lib/utils"

interface GateQuery {
  series: SeriesId
  target: Target
  horizon: number
}

interface GateSpec {
  id: string
  title: string
  question: string
  queries: GateQuery[]
  meaning: string
}

const GATES: GateSpec[] = [
  {
    id: "edge",
    title: "Direction & mean edge · BTCUSD · 24h",
    question: "Does it beat the coin on P(up) and the random walk on price?",
    queries: [
      { series: "BTCUSD", target: "direction", horizon: 24 },
      { series: "BTCUSD", target: "price", horizon: 24 },
    ],
    meaning:
      "Coin bar: Brier 0.25. Random-walk bar: CRPS ratio 1.00. Efficient-price lanes are allowed to fail — that is the definition of weak, measured.",
  },
  {
    id: "vol",
    title: "Vol edge · XAUUSD · 24h",
    question: "Can it beat Log-HAR on realized volatility?",
    queries: [{ series: "XAUUSD", target: "vol", horizon: 24 }],
    meaning:
      "The one lane with documented headroom: vol clusters and has intraday seasonality. Bar: Log-HAR (HAR-RV on log scale).",
  },
  {
    id: "calibration",
    title: "Calibration · BTCUSD · price · 24h",
    question: "Are the fans honestly sized? (coverage ≈ nominal, ±5pp)",
    queries: [{ series: "BTCUSD", target: "price", horizon: 24 }],
    meaning:
      "50/80/90% empirical coverage within ±5pp of nominal + a uniform PIT = calibrated. Calibration ≠ skill, but miscalibration is disqualifying.",
  },
  {
    id: "covariates",
    title: "Covariate use · shuffle ablation · 24h",
    question: "Do the 17 channels pay rent? (shuffle Δ-CRPS + LOO importances)",
    queries: [{ series: "BTCUSD", target: "price", horizon: 24 }],
    meaning:
      "Wrong values, right distribution: shuffling a channel the model reads must hurt. Δ-CRPS ≤ 0 on both blocks ⇒ covariate-deaf on this view.",
  },
  {
    id: "garch-family",
    title: "GARCH family · BTCUSD · vol · 24h",
    question: 'Does the proven GARCH family displace Log-HAR? ("should I just use GARCH?")',
    queries: [{ series: "BTCUSD", target: "vol", horizon: 24 }],
    meaning:
      "GARCH(1,1)-N · GJR-t (TGARCH) · EGARCH-t — MLE fits frozen at eval start, scored against the SAME Log-HAR bar on the same origins. DISPLACES = ratio < 1 AND DM p < 0.05. Literature expectation: no displacement — GARCH earns its seat as a lane specialist (long horizons, low-vol FX), not a general winner. Measured on THIS repo's own data window; numbers move when the CSVs refresh.",
  },
]

interface GateResult {
  spec: GateSpec
  data: (EvalResponse | null)[]
  error: string | null
}

/** Prefer the real model's row; fall back to the clearly-labeled stand-ins. */
function pickRow(data: EvalResponse): MetricRow | undefined {
  const real =
    data.timestral?.available !== false
      ? data.rows.find((r) => r.model === "timestral")
      : undefined
  return real ?? data.rows.find((r) => r.model === "tsfm") ?? data.rows.find((r) => r.model === "tsfm_base")
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 whitespace-nowrap rounded bg-neutral-900/60 px-2 py-1.5">
      <span className="text-slate-500">{label} </span>
      <span className={tone ?? "text-slate-200"}>{value}</span>
    </div>
  )
}

function deltaTone(d: number | null): { tone: string; tag: string } {
  if (d == null) return { tone: "text-slate-500", tag: "n/a" }
  if (d > 0.5) return { tone: "text-emerald-400", tag: "earning rent" }
  if (d < -0.5) return { tone: "text-red-400", tag: "covariate-deaf" }
  return { tone: "text-amber-400", tag: "≈ deaf" }
}

function GateCard({ res }: { res: GateResult }) {
  const { spec, data: datas, error } = res
  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-sm text-red-300">{spec.title}: {error}</p>
      </div>
    )
  }
  if (datas.length === 0 || datas.some((d) => d == null)) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 space-y-3">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-7 w-full" />
        <div className="skeleton h-3 w-2/3" />
      </div>
    )
  }

  const views = datas as EvalResponse[]
  const hasReal = views.some((d) => d.rows.some((r) => r.model === "timestral"))

  let passed: boolean | null = null
  let stats: ReactNode = null
  let sources = "numbers from: —"
  let detail: string | null = null

  if (spec.id === "edge") {
    const [dir, price] = views
    const dp = dir.verdict.passed
    const pp = price.verdict.passed
    passed = dp === true && pp === true ? true : dp === false || pp === false ? false : null
    const dRow = pickRow(dir)
    const pRow = pickRow(price)
    stats = (
      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <Stat
          label="Brier"
          tone={dRow?.brier != null && dRow.brier < 0.25 ? "text-emerald-400" : "text-red-400"}
          value={`${dRow?.brier?.toFixed(4) ?? "—"} / 0.25`}
        />
        <Stat
          label="Acc"
          value={`${dRow?.acc != null ? `${(dRow.acc * 100).toFixed(1)}%` : "—"} / 50%`}
        />
        <Stat
          label="CRPS ratio"
          tone={
            (pRow?.skillRatio ?? 1) < 0.98
              ? "text-emerald-400"
              : (pRow?.skillRatio ?? 1) > 1.02
                ? "text-red-400"
                : "text-amber-400"
          }
          value={pRow?.skillRatio?.toFixed(3) ?? "—"}
        />
        <Stat label="DM p" value={pRow?.dmP?.toFixed(4) ?? "—"} />
      </div>
    )
    sources = `numbers from: ${dRow?.label ?? "—"} · ${pRow?.label ?? "—"}`
    detail = price.verdict.detail
  } else if (spec.id === "vol") {
    const [vol] = views
    passed = vol.verdict.passed
    const row = pickRow(vol)
    stats = (
      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <Stat
          label="CRPS ratio"
          tone={
            (row?.skillRatio ?? 1) < 0.98
              ? "text-emerald-400"
              : (row?.skillRatio ?? 1) > 1.02
                ? "text-red-400"
                : "text-amber-400"
          }
          value={row?.skillRatio?.toFixed(3) ?? "—"}
        />
        <Stat
          label="DM p"
          tone={cn((row?.dmP ?? 1) < 0.05 ? "text-emerald-400" : "text-slate-200")}
          value={row?.dmP?.toFixed(4) ?? "—"}
        />
      </div>
    )
    sources = `numbers from: ${row?.label ?? "—"}`
    detail = vol.verdict.detail
  } else if (spec.id === "calibration") {
    const [price] = views
    const row = pickRow(price)
    const checks = (
      [
        ["cov50", 0.5],
        ["cov80", 0.8],
        ["cov90", 0.9],
      ] as const
    ).map(([k, nominal]) => {
      const cov = row?.[k]
      const d = cov == null ? null : Math.abs(cov - nominal)
      return { k, cov, d, nominal }
    })
    const worst = Math.max(0, ...checks.map((c) => c.d ?? 0))
    const anyNull = checks.every((c) => c.d == null)
    passed = anyNull ? null : worst <= 0.05 ? true : worst <= 0.1 ? null : false
    stats = (
      <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
        {checks.map((c) => (
          <Stat
            key={c.k}
            label={`${c.nominal * 100}%`}
            tone={
              c.d == null
                ? "text-slate-500"
                : c.d <= 0.05
                  ? "text-emerald-400"
                  : c.d <= 0.1
                    ? "text-amber-400"
                    : "text-red-400"
            }
            value={c.cov != null ? `${(c.cov * 100).toFixed(0)}%` : "—"}
          />
        ))}
      </div>
    )
    sources = `numbers from: ${row?.label ?? "—"} · worst |Δ| ${(worst * 100).toFixed(1)}pp`
  } else if (spec.id === "covariates") {
    // covariate use — the shuffle ablation (+ per-channel LOO lives in the lab panel)
    const [price] = views
    const ab = price.ablation
    const dp = ab?.shufflePast?.deltaPct ?? null
    const dk = ab?.shuffleKnown?.deltaPct ?? null
    const vals = [dp, dk].filter((v): v is number => v != null)
    const best = vals.length ? Math.max(...vals) : null
    passed = best == null ? null : best > 1 ? true : best < -1 ? false : null
    const pastT = deltaTone(dp)
    const knownT = deltaTone(dk)
    stats = (
      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <Stat label="past shuffle" tone={pastT.tone} value={dp != null ? `${dp >= 0 ? "+" : ""}${dp.toFixed(1)}%` : "—"} />
        <Stat label="known shuffle" tone={knownT.tone} value={dk != null ? `${dk >= 0 ? "+" : ""}${dk.toFixed(1)}%` : "—"} />
      </div>
    )
    sources = `verdict from the deafness ablation · best block Δ ${best != null ? `${best >= 0 ? "+" : ""}${best.toFixed(1)}%` : "—"}`
  } else {
    // garch-family — the proven-methodology challenge, all arms vs the same bar
    const [vol] = views
    const FAMILY: ModelId[] = ["garch", "gjr", "egarch"]
    const barRow = vol.rows.find((r) => r.model === "har")
    const tsfmRow =
      vol.rows.find((r) => r.model === "timestral") ?? vol.rows.find((r) => r.model === "tsfm")
    const famRows = FAMILY
      .map((id) => vol.rows.find((r) => r.model === id))
      .filter((r): r is MetricRow => !!r)
    const winners = famRows.filter((r) => (r.skillRatio ?? 1) < 1 && (r.dmP ?? 1) < 0.05)
    passed = famRows.length ? (winners.length ? true : false) : null
    stats = (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <Stat
            label="bar pinball"
            value={barRow?.pinball != null ? barRow.pinball.toFixed(5) : "—"}
          />
          <Stat
            label="TSFM-class ratio"
            tone={
              (tsfmRow?.skillRatio ?? 1) < 0.98
                ? "text-emerald-400"
                : (tsfmRow?.skillRatio ?? 1) > 1.02
                  ? "text-red-400"
                  : "text-amber-400"
            }
            value={tsfmRow?.skillRatio?.toFixed(3) ?? "—"}
          />
        </div>
        <div className="overflow-hidden rounded border border-neutral-800">
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="bg-neutral-900/60 text-slate-500">
                <th className="px-2 py-1 text-left font-normal">family arm</th>
                <th className="px-2 py-1 text-right font-normal">ratio</th>
                <th className="px-2 py-1 text-right font-normal">DM p</th>
                <th className="px-2 py-1 text-right font-normal">cov80</th>
              </tr>
            </thead>
            <tbody>
              {famRows.map((r) => (
                <tr key={r.model} className="border-t border-neutral-800/60">
                  <td className="px-2 py-1 text-slate-300">{r.label}</td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right",
                      (r.skillRatio ?? 1) < 1 ? "text-emerald-400" : "text-red-400",
                    )}
                  >
                    {r.skillRatio?.toFixed(3) ?? "—"}
                  </td>
                  <td className="px-2 py-1 text-right text-slate-300">{r.dmP?.toFixed(4) ?? "—"}</td>
                  <td className="px-2 py-1 text-right text-slate-400">
                    {r.cov80 != null ? `${(r.cov80 * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
              {barRow && (
                <tr className="border-t border-neutral-800/60 bg-neutral-900/40">
                  <td className="px-2 py-1 text-slate-400">{barRow.label} (bar)</td>
                  <td className="px-2 py-1 text-right text-slate-500">1.000</td>
                  <td className="px-2 py-1 text-right text-slate-500">—</td>
                  <td className="px-2 py-1 text-right text-slate-400">
                    {barRow.cov80 != null ? `${(barRow.cov80 * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
    sources = winners.length
      ? `displacing: ${winners.map((w) => w.label).join(", ")} · rolling-origin eval, same origins as the bar`
      : "no family arm beats Log-HAR at DM p < 0.05 · rolling-origin eval, same origins as the bar"
    detail =
      tsfmRow?.skillRatio != null
        ? `Context: the TSFM-class arm (${tsfmRow.label}) posts ratio ${tsfmRow.skillRatio.toFixed(3)} vs the same bar — family vs foundation model on one screen.`
        : null
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        passed === true
          ? "border-emerald-500/40 bg-emerald-500/[0.05]"
          : passed === false
            ? "border-red-500/40 bg-red-500/[0.05]"
            : "border-amber-500/40 bg-amber-500/[0.05]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-100">{spec.title}</p>
          <p className="text-[11px] text-slate-400">{spec.question}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "badge badge-outline",
              passed === true
                ? "border-emerald-500/40 text-emerald-300"
                : passed === false
                  ? "border-red-500/40 text-red-300"
                  : "border-amber-500/40 text-amber-300",
            )}
          >
            {spec.id === "garch-family"
              ? passed === true
                ? "DISPLACES"
                : passed === false
                  ? "NO DISPLACEMENT"
                  : "UNDECIDED"
              : passed === true
                ? "PASS"
                : passed === false
                  ? "FAIL"
                  : "UNDECIDED"}
          </span>
          {!hasReal && (
            <span className="badge badge-outline border-neutral-700 text-slate-500">stand-in</span>
          )}
        </div>
      </div>
      <div className="mt-3">{stats}</div>
      {detail && <p className="mt-2.5 text-[11px] leading-snug text-slate-500">{detail}</p>}
      <p className={cn("mt-2 font-mono text-[10px] text-slate-600", !detail && "mt-2.5")}>{sources}</p>
      <p className={cn("text-[11px] leading-snug text-slate-500", detail ? "mt-1" : "mt-2.5")}>{spec.meaning}</p>
    </div>
  )
}

export function VerdictGrid() {
  const [results, setResults] = useState<GateResult[]>(
    GATES.map((g) => ({ spec: g, data: [], error: null })),
  )

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const outs = await Promise.all(
        GATES.map(async (g) => {
          try {
            const data = await Promise.all(
              g.queries.map(async (q) => {
                const r = await fetch(`/api/tsfm-lab/eval?series=${q.series}&target=${q.target}&horizon=${q.horizon}`)
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                return (await r.json()) as EvalResponse
              }),
            )
            return { spec: g, data, error: null }
          } catch (e) {
            return { spec: g, data: [] as (EvalResponse | null)[], error: String(e) }
          }
        }),
      )
      if (!cancelled) setResults(outs)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {results.map((r) => (
        <GateCard key={r.spec.id} res={r} />
      ))}
    </div>
  )
}
