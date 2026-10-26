/* ---------------------------------------------------------------------------
 * TSFM Probabilistic Forecast Lab — the single dashboard route.
 * §Lab (interactive fan + covariates) · §Evidence (rolling-origin table)
 * §Verdict (is it truly weak? 4 gates) · §Design (the training-model spec)
 *
 * Ported from the standalone shadcn lab (kairos-pbm-build/tsfm-lab) to
 * nobletradingapp's Tailwind + daisyUI conventions: native <table>,
 * daisyUI badges/tooltips/range/switch/skeleton, <details> accordion.
 * The data surface is unchanged: /api/tsfm-lab/{overview, forecast, eval}
 * and the lib/tsfm-lab harness that computes everything in-process.
 * ------------------------------------------------------------------------- */

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Activity, ArrowDownRight, ArrowUpRight, BrainCircuit, CircleCheckBig, FlaskConical, Gauge, Ruler, Sigma, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { FanChart } from "@/components/tsfm-lab/fan-chart"
import { CovariatePanel } from "@/components/tsfm-lab/covariate-panel"
import { EvalSection } from "@/components/tsfm-lab/eval-section"
import { VerdictGrid } from "@/components/tsfm-lab/verdict-grid"
import { DesignSpec } from "@/components/tsfm-lab/design-spec"
import {
  INTERVALS,
  MODELS,
  MODE_PRESETS,
  TARGET_META,
  type EvalResponse,
  type ForecastResponse,
  type ModelId,
  type SeriesId,
  type Target,
} from "@/lib/tsfm-lab/design"

const SERIES_TABS: { id: SeriesId; label: string; hint: string }[] = [
  { id: "BTCUSD", label: "BTCUSD", hint: "crypto · 24/7" },
  { id: "USDJPY", label: "USDJPY", hint: "FX major" },
  { id: "USDCHF", label: "USDCHF", hint: "FX major" },
  { id: "XAUUSD", label: "XAUUSD", hint: "spot gold" },
  { id: "XAGUSD", label: "XAGUSD", hint: "spot silver" },
]

const DEFAULT_CUTOFF = 83

/* ------------------------------ small widgets ------------------------------ */

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("badge badge-outline", className)}>{children}</span>
}

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

const STYLE_BLOCK = `
  .switch { display: inline-flex; align-items: center; gap: .5rem; cursor: pointer; padding: 0; }
  .switch input { position: absolute; opacity: 0; width: 0; height: 0; }
  .switch .slider {
    position: relative; width: 38px; height: 22px; background: #334155; border-radius: 999px;
    transition: background .2s;
  }
  .switch .slider::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
    border-radius: 50%; background: #94a3b8; transition: transform .2s, background .2s;
  }
  .switch input:checked + .slider { background: #22c55e; }
  .switch input:checked + .slider::after { transform: translateX(18px); background: #fff; }
  .switch input:disabled + .slider { opacity: .45; cursor: not-allowed; }
`

export default function Page() {
  const [series, setSeries] = useState<SeriesId>("BTCUSD")
  const [target, setTarget] = useState<Target>("price")
  const [horizon, setHorizon] = useState<number>(24)
  const [model, setModel] = useState<ModelId>("tsfm")
  const [covKeys, setCovKeys] = useState<string[] | null>(null)
  const [cutoff, setCutoff] = useState<number>(DEFAULT_CUTOFF)
  const [intervals, setIntervals] = useState<string[]>(["50%", "80%", "90%"])
  const [showActual, setShowActual] = useState(true)

  const [fc, setFc] = useState<ForecastResponse | null>(null)
  const [fcLoading, setFcLoading] = useState(true)
  const [fcError, setFcError] = useState<string | null>(null)
  const [ev, setEv] = useState<EvalResponse | null>(null)
  const [evLoading, setEvLoading] = useState(true)
  const [evError, setEvError] = useState<string | null>(null)

  const reqId = useRef(0)
  const evReqId = useRef(0)

  const modelOptions = useMemo(
    () => MODELS.filter((m) => m.targets.includes(target)),
    [target],
  )

  const effModel = modelOptions.some((m) => m.id === model) ? model : "tsfm"

  /* ---------------- data loading ---------------- */

  const loadForecast = useCallback(async () => {
    const id = ++reqId.current
    setFcLoading(true)
    setFcError(null)
    try {
      const r = await fetch("/api/tsfm-lab/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series,
          target,
          horizon,
          model: effModel,
          cutoffIndex: cutoff,
          covKeys: covKeys ?? undefined,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as ForecastResponse
      if (id === reqId.current) setFc(data)
    } catch (e) {
      if (id === reqId.current) setFcError(String(e))
    } finally {
      if (id === reqId.current) setFcLoading(false)
    }
  }, [series, target, horizon, effModel, cutoff, covKeys])

  useEffect(() => {
    void loadForecast()
  }, [loadForecast])

  useEffect(() => {
    const id = ++evReqId.current
    setEvLoading(true)
    setEvError(null)
    setEv(null)
    const load = async () => {
      try {
        const r = await fetch(`/api/tsfm-lab/eval?series=${series}&target=${target}&horizon=${horizon}`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = (await r.json()) as EvalResponse
        if (id === evReqId.current) setEv(data)
      } catch (e) {
        if (id === evReqId.current) setEvError(String(e))
      } finally {
        if (id === evReqId.current) setEvLoading(false)
      }
    }
    void load()
    return () => {
      evReqId.current++
    }
  }, [series, target, horizon])

  /* when series/target changes: reset covariate set to server default */
  useEffect(() => {
    setCovKeys(null)
  }, [series, target])

  /* ---------------- interactions ---------------- */

  const changeTarget = (t: Target) => {
    setTarget(t)
    const keep = MODELS.find((m) => m.id === model && m.targets.includes(t))
    if (!keep) setModel("tsfm")
  }

  const onCovToggle = (key: string, next: boolean) => {
    const current =
      covKeys ??
      (fc?.covariates ?? []).filter((c) => c.enabled).map((c) => c.key)
    const nextSet = new Set(current)
    if (next) nextSet.add(key)
    else nextSet.delete(key)
    setCovKeys([...nextSet])
  }

  const activeIntervals = INTERVALS.filter((i) => intervals.includes(i.label))
  const covInteractive = effModel === "tsfm" || effModel === "timestral"

  /* canonical form of the live covariate set — matches a preset iff equal as sets */
  const activeCovKeys = useMemo(() => {
    const keys =
      covKeys ??
      (fc?.covariates ?? []).filter((c) => c.enabled).map((c) => c.key)
    return [...keys].sort().join(",")
  }, [covKeys, fc])

  const fmt = (v: number | null | undefined, d = 4): string =>
    v == null || !Number.isFinite(v) ? "—" : v.toFixed(d)
  const pct = (v: number | null | undefined): string =>
    v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(0)}%`

  const covDeltaBadge = useMemo(() => {
    if (!ev || ev.target === "direction") return null
    const t = ev.rows.find((r) => r.model === "tsfm")
    const b = ev.rows.find((r) => r.model === "tsfm_base")
    if (!t || !b || !b.crps) return null
    return ((b.crps - t.crps) / b.crps) * 100
  }, [ev])

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-slate-100">
      <style>{STYLE_BLOCK}</style>

      {/* ------------------------------ header ------------------------------ */}
      <header className="border-b border-neutral-800/80">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-8">
          <div className="flex flex-wrap items-start gap-3">
            <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-2.5">
              <BrainCircuit className="h-6 w-6 text-orange-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                TSFM Probabilistic Forecast Lab
              </h1>
              <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-slate-400">
                A standalone time-series foundation model training design — and a live
                harness that measures what it can <em className="text-slate-200">probabilistically</em>
                forecast. Independent of Kairos. &ldquo;Is it truly weak?&rdquo; is answered with
                gates, not opinions.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "5 real symbols · 2y hourly",
              "Timestral-5M live (zero-shot)",
              "17 financial channels · M0–M3",
              "90 rolling origins · DM-gated",
            ].map((b) => (
              <Badge key={b} className="bg-neutral-900/60 text-slate-300">
                {b}
              </Badge>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-8 space-y-12">
        {/* ------------------------------ §1 THE LAB ------------------------------ */}
        <section aria-labelledby="lab-h">
          <div className="flex items-center gap-2.5 mb-3">
            <FlaskConical className="h-5 w-5 text-orange-400" aria-hidden />
            <h2 id="lab-h" className="text-lg font-semibold">
              The Lab — what the fan actually says
            </h2>
          </div>

          {/* series tabs */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4" role="tablist" aria-label="Dataset">
            {SERIES_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={series === t.id}
                onClick={() => setSeries(t.id)}
                className={cn(
                  "rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  series === t.id
                    ? "bg-white text-neutral-950"
                    : "bg-neutral-800/70 text-slate-300 hover:bg-neutral-700/70",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* controls */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3.5">
            <div className="grid gap-3.5 lg:grid-cols-[auto_auto_1fr_auto] lg:items-end">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Target</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(Object.keys(TARGET_META) as Target[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => changeTarget(t)}
                      aria-pressed={target === t}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[12px] transition-colors border",
                        target === t
                          ? "border-orange-500/50 bg-orange-500/15 text-orange-200"
                          : "border-neutral-800 bg-neutral-900/60 text-slate-400 hover:text-slate-200",
                      )}
                    >
                      {TARGET_META[t].short}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Forecast window</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[1, 6, 24, 72].map((h) => (
                    <button
                      key={h}
                      onClick={() => setHorizon(h)}
                      aria-pressed={horizon === h}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[12px] font-mono transition-colors border",
                        horizon === h
                          ? "border-orange-500/50 bg-orange-500/15 text-orange-200"
                          : "border-neutral-800 bg-neutral-900/60 text-slate-400 hover:text-slate-200",
                      )}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">
                  Cutoff origin — {fc ? new Date(fc.cutoff).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" }) : "…"}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="range"
                    className="range range-md w-full"
                    value={cutoff}
                    min={0}
                    max={89}
                    step={1}
                    onChange={(e) => setCutoff(Number(e.target.value))}
                    aria-label="Cutoff origin"
                  />
                  <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    {cutoff === 89 ? "live edge" : `T−${89 - cutoff}d`}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Model arm</p>
                <select
                  value={effModel}
                  onChange={(e) => setModel(e.target.value as ModelId)}
                  className="mt-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none focus:border-orange-500/50"
                  aria-label="Model arm"
                >
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* conditioning-mode presets — the M0–M3 ablation ladder */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500">
                Conditioning mode (the ablation ladder)
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {MODE_PRESETS.map((p) => {
                  const active = [...p.keys].sort().join(",") === activeCovKeys
                  return (
                    <button
                      key={p.id}
                      onClick={() => setCovKeys([...p.keys])}
                      aria-pressed={active}
                      className={cn(
                        "flex min-h-[44px] items-center rounded-md border px-3 text-[12px] transition-colors",
                        active
                          ? "border-orange-500/50 bg-orange-500/15 text-orange-200"
                          : "border-neutral-800 bg-neutral-900/60 text-slate-400 hover:text-slate-200",
                      )}
                    >
                      {p.label}
                    </button>
                  )
                })}
                <span className="ml-1 max-w-[250px] text-[11px] leading-snug text-slate-500">
                  M0 univariate → M3 full · the switches below refine any preset
                </span>
              </div>
            </div>

            <div className="divider" />

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">Intervals</span>
                {INTERVALS.map((i) => (
                  <button
                    key={i.label}
                    onClick={() =>
                      setIntervals((prev) =>
                        prev.includes(i.label)
                          ? prev.filter((p) => p !== i.label)
                          : [...prev, i.label],
                      )
                    }
                    aria-pressed={intervals.includes(i.label)}
                    className={cn(
                      "rounded px-2 py-0.5 font-mono text-[11px] border transition-colors",
                      intervals.includes(i.label)
                        ? "border-orange-500/50 bg-orange-500/15 text-orange-200"
                        : "border-neutral-800 text-slate-500 hover:text-slate-300",
                    )}
                  >
                    {i.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={showActual} onChange={setShowActual} ariaLabel="Show actual overlay" />
                <span className="text-[12px] text-slate-400">actual overlay (post-hoc)</span>
              </div>

              <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500/50" /> bull
                <span className="inline-block h-2 w-2 rounded-full bg-red-500/50 ml-1.5" /> bear
                <span className="ml-1.5">· dashed grey = CUSUM shift</span>
              </div>
            </div>
          </div>

          {/* chart + direction card */}
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
            <div className="card border-neutral-800 bg-neutral-900/40 overflow-hidden">
              <div className="card-body p-2 sm:p-3 relative">
                {fcLoading && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-950/70 backdrop-blur-[1px] rounded-xl">
                    <div className="flex items-center gap-2.5 text-[13px] text-orange-300">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500/30 border-t-orange-400" />
                      {effModel === "timestral"
                        ? "querying Timestral-5M…"
                        : "fitting quantile heads…"}
                    </div>
                  </div>
                )}
                {fcError ? (
                  <div className="p-6 text-sm text-red-300">Forecast failed: {fcError}</div>
                ) : fc ? (
                  <FanChart
                    history={fc.history}
                    fan={fc.fan}
                    intervals={activeIntervals}
                    showActual={showActual}
                    yLabel={fc.yLabel}
                    target={fc.target}
                    series={fc.series}
                  />
                ) : (
                  <div className="skeleton h-[300px] w-full" />
                )}
                {fc && (
                  <p className="px-2 pt-1 pb-0.5 text-[11px] text-slate-500 font-mono">
                    {fc.yLabel} · white = history · orange = {effModel === "timestral"
                      ? "Timestral-5M"
                      : effModel.startsWith("tsfm")
                        ? "TSFM-class"
                        : effModel} fan
                    {showActual && " · grey dash = actual"}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {target === "direction" && fc?.direction && (
                <div className="card border-orange-500/30 bg-orange-500/[0.05]">
                  <div className="card-body p-4">
                    <p className="text-[11px] uppercase tracking-wider text-orange-300/80">
                      P(close up) · +{horizon}h
                    </p>
                    <div className="mt-1 flex items-end gap-2">
                      <span className="text-3xl font-bold font-mono text-orange-200">
                        {(fc.direction.pUp * 100).toFixed(1)}%
                      </span>
                      {fc.direction.pUp >= 0.5 ? (
                        <ArrowUpRight className="h-5 w-5 text-emerald-400 mb-1" aria-hidden />
                      ) : (
                        <ArrowDownRight className="h-5 w-5 text-red-400 mb-1" aria-hidden />
                      )}
                    </div>
                    {fc.direction.actualUp !== null && (
                      <p className="mt-1 text-[12px] text-slate-400">
                        actual:{" "}
                        <span className={fc.direction.actualUp ? "text-emerald-400" : "text-red-400"}>
                          {fc.direction.actualUp ? "UP" : "DOWN"}
                        </span>
                      </p>
                    )}
                    <div className="divider my-2.5 bg-neutral-800" />
                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                      <div>
                        <p className="text-slate-500">rolling Brier</p>
                        <p className={fc.direction.histBrier < 0.25 ? "text-emerald-400" : "text-red-400"}>
                          {fmt(fc.direction.histBrier)} / 0.25
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">rolling acc</p>
                        <p className="text-slate-200">{pct(fc.direction.histAcc)} / 50%</p>
                      </div>
                    </div>
                    <p className="mt-2 text-[10.5px] leading-snug text-slate-500">
                      P(up) read off the monotone fan CDF — no sigmoid(rel_change) hack. n = {fc.direction.n} origins.
                    </p>
                  </div>
                </div>
              )}

              {fc && (
                <div className="card border-neutral-800 bg-neutral-900/40">
                  <div className="card-body p-4 space-y-2.5">
                    <p className="text-[11px] uppercase tracking-wider text-slate-500">
                      Rolling-origin diagnostics · h={horizon}
                    </p>
                    <div className="space-y-1.5 font-mono text-[11.5px]">
                      <div className="flex justify-between">
                        <span className="text-slate-500">pinball (log units)</span>
                        <span className="text-slate-200">{fmt(fc.local.pinball)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">CRPS ≈ 2·pinball</span>
                        <span className="text-slate-200">{fmt(fc.local.crps)}</span>
                      </div>
                      <div className="divider bg-neutral-800" />
                      {(["50", "80", "90"] as const).map((k) => {
                        const cov = fc.local.coverage[k]
                        const nominal = Number(k) / 100
                        const d = Math.abs(cov - nominal)
                        return (
                          <div key={k} className="flex justify-between">
                            <span className="text-slate-500">coverage {k}%</span>
                            <span className={d <= 0.05 ? "text-emerald-400" : d <= 0.1 ? "text-amber-400" : "text-red-400"}>
                              {pct(cov)} <span className="text-slate-600">/ {k}%</span>
                            </span>
                          </div>
                        )
                      })}
                      <div className="flex justify-between">
                        <span className="text-slate-500">mean 80% width</span>
                        <span className="text-slate-200">{fmt(fc.local.width["80"])}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">origins scored</span>
                        <span className="text-slate-200">{fc.local.n}</span>
                      </div>
                    </div>
                    {covDeltaBadge != null && (
                      <p className="text-[10.5px] leading-snug text-slate-500">
                        {covDeltaBadge >= 0 ? "Covariates buy" : "Covariates cost"}{" "}
                        <span className={covDeltaBadge >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {Math.abs(covDeltaBadge).toFixed(1)}%
                        </span>{" "}
                        CRPS vs the univariate arm on this view.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* covariates panel */}
          <div className="card border-neutral-800 bg-neutral-900/40 mt-4">
            <div className="card-body p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-slate-200">Covariates</h3>
                  <Badge className="bg-neutral-900/60 text-slate-400">leave-one-out Δ-CRPS @ 24h</Badge>
                </div>
                {!covInteractive && (
                  <p className="text-[11px] text-slate-500">
                    switches are live for the ridge stand-in and the real Timestral arm — baselines ignore
                    covariates by design
                  </p>
                )}
              </div>
              {fc ? (
                <CovariatePanel rows={fc.covariates} onToggle={onCovToggle} interactive={covInteractive} />
              ) : (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="skeleton h-12 w-full" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ------------------------------ §2 EVIDENCE ------------------------------ */}
        <section aria-labelledby="ev-h">
          <div className="flex items-center gap-2.5 mb-3">
            <Sigma className="h-5 w-5 text-orange-400" aria-hidden />
            <h2 id="ev-h" className="text-lg font-semibold">
              Evidence — rolling-origin backtest
            </h2>
            <Badge className="bg-neutral-900/60 text-slate-400">
              {series} · {TARGET_META[target].short} · {horizon}h
            </Badge>
          </div>
          <EvalSection data={ev} loading={evLoading} error={evError} />
        </section>

        {/* ------------------------------ §3 VERDICT ------------------------------ */}
        <section aria-labelledby="vd-h">
          <div className="flex items-center gap-2.5 mb-3">
            <Gauge className="h-5 w-5 text-orange-400" aria-hidden />
            <h2 id="vd-h" className="text-lg font-semibold">
              Is it truly weak? — the four gates
            </h2>
          </div>
          <VerdictGrid />
          <div className="card border-neutral-800 bg-neutral-900/40 mt-4">
            <div className="card-body p-4 sm:p-5 space-y-3 text-[13px] leading-relaxed text-slate-400">
              <p className="text-slate-200 font-medium">The verdict, layered:</p>
              <ol className="list-decimal pl-5 space-y-2">
                <li>
                  <span className="text-slate-200">
                    As a next-tick direction oracle on liquid markets: YES — truly weak.
                  </span>{" "}
                  Brier ≈ 0.25, accuracy ≈ 50%, and the conditioned arm&apos;s Brier is{" "}
                  <em>worse</em> than the coin&apos;s (0.268 vs 0.250 on BTCUSD): conditioning
                  injects noise into a probability that had no signal to sharpen. Consistent
                  with Marconi et al. (R²<sub>OOS</sub> −2.8%) and STRIDE&apos;s own finance
                  tables — and the live table above recomputes per view.
                </li>
                <li>
                  <span className="text-slate-200">
                    As a probabilistic price fan at H ≤ 72h: calibrated but unskilled.
                  </span>{" "}
                  The fan honestly prices its own ignorance (coverage ≈ nominal) while carrying
                  zero edge over the random walk. Calibration ≠ skill — an honest &ldquo;I don&apos;t
                  know&rdquo; is not a trading signal. The live table above recomputes per view.
                </li>
                <li>
                  <span className="text-slate-200">
                    As a volatility forecaster: the one lane with a measured win.
                  </span>{" "}
                  The real Timestral-5M beats Log-HAR zero-shot on BTCUSD vol 24h — CRPS ratio
                  ≈ 0.785, DM p ≈ 0.0017 (~21% CRPS skill), and the shuffle test shows its
                  covariates earning rent (Δ-CRPS ≈ +9.9% when the past-only block is
                  scrambled — the model is reading RV/ATR/EWMA, not coasting on distribution).
                  On XAUUSD vol the same arm ties HAR (ratio ≈ 1.03, p ≈ 0.54). The live table
                  above recomputes per view.
                </li>
                <li>
                  <span className="text-slate-200">
                    The real-model gate: Timestral-5M, zero-shot.
                  </span>{" "}
                  On BTCUSD price 24h the real 5.2M-param model is calibrated-but-unskilled —
                  CRPS ratio ≈ 1.05 vs the random walk, DM p ≈ 0.42 — and the shuffle test says
                  its covariates are not yet paying rent (Δ-CRPS ≈ −4% when the past-only
                  block is shuffled). On efficient price lanes the weakness is the target&apos;s
                  signal-to-noise, not the model class.
                </li>
              </ol>
              <div className="divider bg-neutral-800" />
              <p className="text-[12.5px]">
                <span className="text-slate-200">Bottom line:</span> &ldquo;weak&rdquo; is a
                property of the <span className="font-mono text-orange-300"> (target, horizon,
                baseline) </span> triple — not of TSFMs. The model class is not weak; the lane
                determines it: honestly uncertain on efficient prices (where the random walk
                already IS the null), beating Log-HAR zero-shot where vol clusters (BTCUSD),
                covariate-deaf exactly where the channels carry no extractable signal. The real
                Timestral-5M arm is already live above; the §6 runbook&apos;s next step is the
                size ladder (28M–209M) and the fine-tuned arms.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------ §4 DESIGN ------------------------------ */}
        <section aria-labelledby="ds-h">
          <div className="flex items-center gap-2.5 mb-3">
            <Ruler className="h-5 w-5 text-orange-400" aria-hidden />
            <h2 id="ds-h" className="text-lg font-semibold">
              The design — TSFM training model specification
            </h2>
          </div>
          <DesignSpec />
        </section>

        {/* ------------------------------ boundaries ------------------------------ */}
        <section aria-labelledby="bd-h">
          <div className="flex items-center gap-2.5 mb-3">
            <TriangleAlert className="h-5 w-5 text-amber-400" aria-hidden />
            <h2 id="bd-h" className="text-lg font-semibold">Boundaries</h2>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[
              [
                "Real model, zero-shot",
                "Timestral-5M runs from real weights (5.2M params) on a local CPU sidecar — never fine-tuned here. The size ladder (28M–209M) and the fine-tuned arms are the §6 runbook's next step.",
              ],
              [
                "Hourly bars only",
                "T1 next-tick on 1-minute data needs a second bar size — designed, not wired. H = 1 here is the next hourly bar.",
              ],
              [
                "90 days of origins",
                "≈87–89 origins per view gives DM tests reasonable power, but regime-specific slices (per-regime coverage) are not yet populated enough to gate on.",
              ],
              [
                "Calendar, not events",
                "Known-future covariates are calendar-only here; the event calendar (CPI/FOMC hours-to-event) is the designed next covariate — it needs a feed.",
              ],
            ].map(([t, d]) => (
              <div
                key={t}
                className="alert alert-amber flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3.5 py-3"
              >
                <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium text-amber-200">{t}</p>
                  <p className="mt-1 text-[12px] leading-snug text-slate-400">{d}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 alert alert-accent flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.05] px-3.5 py-3">
            <CircleCheckBig className="h-4 w-4 mt-0.5 text-emerald-400 shrink-0" aria-hidden />
            <p className="text-[12px] leading-snug text-slate-400">
              <span className="text-emerald-300">What IS real:</span> the 5 financial series, the
              frozen rolling-origin protocol with embargo, every baseline, every metric
              (pinball, CRPS, coverage, PIT, Diebold–Mariano), the covariate taxonomy, the
              gates — and the Timestral-5M arm itself: real zero-shot weights served by the
              local sidecar, scored by the same harness. Stand-in numbers are computed in
              this process from the raw CSVs.
            </p>
          </div>
        </section>
      </main>

      {/* ------------------------------ footer ------------------------------ */}
      <footer className="mt-auto border-t border-neutral-800/80 bg-neutral-950">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <p className="text-[11.5px] text-slate-500">
            TSFM Probabilistic Forecast Lab · standalone design, independent of Kairos · data:
            5 real broker CSVs (2024→2026, hourly) · arms: ridge stand-ins + the real Timestral-5M
            via local sidecar · harness: direct (H,τ) quantile heads, frozen rolling origins,
            DM-gated verdicts.
          </p>
        </div>
      </footer>
    </div>
  )
}
