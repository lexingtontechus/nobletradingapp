/* ---------------------------------------------------------------------------
 * TSFM Lab — harness orchestration with module-level caches (R2)
 *
 *   /api/tsfm/overview   series metadata + design constants + sidecar health
 *   /api/tsfm/forecast   fan + covariates + direction card + local metrics
 *   /api/tsfm/eval       rolling-origin metric table + PIT + ablations + gates
 *
 * Heavy results are computed once per cache key and memoized for the
 * process lifetime. Stand-in fits are LRU-cached by covariate signature;
 * Timestral-5M responses are LRU-cached per (series,target,H,keys,origin) in
 * the sidecar client — the real model is queried at most once per cell.
 * ------------------------------------------------------------------------- */

import { getSeries, SERIES_IDS, type SeriesData } from "./data"
import {
  MODELS,
  COVARIATES,
  type SeriesId,
  type Target,
  type ModelId,
  type ForecastResponse,
  type ForecastPoint,
  type HistoryPoint,
  type CovariateRow,
  type EvalResponse,
} from "./design"
import {
  COV_KEYS,
  TAU,
  cdfFromQuantiles,
  fitStandInAt,
  predictStandInAt,
  armPredict,
  makeVolTargets,
  calendarValue,
  calendarNamesFor,
  isKnownFutureKey,
  type FeatureCtx,
  type QVec,
  type StandInFitH,
  type CovKey,
} from "./models"
import {
  buildCtx,
  evalOrigins,
  originGrid,
  fullCovKeys,
  BASE_COV_KEYS,
  modelsFor,
  barFor,
  runArm,
  runTimestralArm,
  pitHistogram,
  covImportance,
  toMetricRows,
  type ArmResult,
} from "./eval"
import { sidecarHealth, timestralQuantiles } from "./sidecar"
import { EVAL } from "./design"

const ctxCache = new Map<string, FeatureCtx>()
const evalCache = new Map<string, EvalResponse>()
const importanceCache = new Map<string, Map<CovKey, number>>()
const fitCache = new Map<string, StandInFitH>()
const rvCache = new Map<string, (i: number, h: number) => number>()
const FIT_CACHE_MAX = 600

const cacheKey = (...parts: (string | number)[]): string => parts.join("|")

async function ctxFor(
  series: SeriesId,
  target: Target,
): Promise<{ ctx: FeatureCtx; s: SeriesData }> {
  const effTarget: Target = target === "direction" ? "price" : target
  const key = cacheKey(series, effTarget)
  const s = await getSeries(series)
  let ctx = ctxCache.get(key)
  if (!ctx) {
    ctx = buildCtx(s, effTarget)
    ctxCache.set(key, ctx)
  }
  return { ctx, s }
}

const covSig = (keys: Set<CovKey>): string => COV_KEYS.filter((k) => keys.has(k)).join(",")

function getFit(ctx: FeatureCtx, h: number, keys: Set<CovKey>): StandInFitH {
  const key = cacheKey(ctx.s.id, ctx.target, h, covSig(keys))
  let fit = fitCache.get(key)
  if (!fit) {
    fit = fitStandInAt(ctx, h, keys)
    if (fitCache.size >= FIT_CACHE_MAX) {
      const first = fitCache.keys().next().value
      if (first) fitCache.delete(first)
    }
    fitCache.set(key, fit)
  }
  return fit
}

function rvAt(s: SeriesData, i: number, h: number): number {
  let fn = rvCache.get(s.id)
  if (!fn) {
    fn = makeVolTargets(s).rvH
    rvCache.set(s.id, fn)
  }
  return fn(i, h)
}

/* -------------------------------- overview --------------------------------- */

export async function overview() {
  const series = await Promise.all(
    SERIES_IDS.map(async (id) => {
      const s = await getSeries(id)
      const bars = s.bars
      const gaps =
        bars.length > 1
          ? bars.slice(1).filter((b, i) => b.t - bars[i].t > 3600_000 * 1.5).length
          : 0
      return {
        id,
        label: id,
        kind: s.kind,
        rows: bars.length,
        start: new Date(bars[0].t).toISOString().slice(0, 10),
        end: new Date(bars[bars.length - 1].t).toISOString().slice(0, 10),
        coverage: `hourly, real broker data${gaps > 0 ? `, ${gaps} session gaps` : ""}`,
        lastClose: bars[bars.length - 1].c,
        note:
          id === "BTCUSD"
            ? "24/7 crypto. Price bar: random walk."
            : id.startsWith("X")
              ? "Spot metal, ~23h weekdays. Vol bar: Log-HAR."
              : "FX major, ~24h weekdays. Price bar: random walk.",
      }
    }),
  )
  const realModel = await sidecarHealth()
  return {
    series,
    quantiles: TAU,
    horizons: [1, 6, 24, 72],
    models: MODELS,
    covariates: COVARIATES,
    realModel: {
      available: realModel.ok,
      model: realModel.model ?? "Timestral-5M",
      params: realModel.params ?? null,
      note: realModel.note ?? null,
    },
  }
}

/* -------------------------------- forecast --------------------------------- */

export interface ForecastRequest {
  series: SeriesId
  target: Target
  horizon: number
  model: ModelId
  cutoffIndex: number // 0..89 on the fixed origin grid (default 83 → ~7d before end)
  covKeys: CovKey[]
}

const HISTORY_BARS = 720

/** Anchor steps for the multi-step fan (interpolated between anchors). */
function anchorSteps(H: number): number[] {
  if (H <= 6) return Array.from({ length: H }, (_, i) => i + 1)
  if (H <= 24) return [1, 2, 3, 4, 6, 8, 12, 16, 20, 24].filter((v) => v <= H)
  return [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 72].filter((v) => v <= H)
}

const interpQ = (a: QVec, b: QVec, fr: number): QVec =>
  a.map((v, i) => v + fr * (b[i] - v))

const qVecOf = (fp: ForecastPoint): QVec => [
  fp.q05,
  fp.q10,
  fp.q25,
  fp.q50,
  fp.q75,
  fp.q90,
  fp.q95,
]

export async function forecast(req: ForecastRequest): Promise<ForecastResponse> {
  const target = req.target
  const H = Math.max(1, Math.min(72, req.horizon || 24))
  const { ctx, s } = await ctxFor(req.series, target)
  const isDirection = target === "direction"
  const isVol = target === "vol"
  const grid = originGrid(s)
  const cutoffIndex = Math.max(0, Math.min(grid.length - 1, req.cutoffIndex ?? 83))
  const origin = grid[Math.min(grid.length - 1, cutoffIndex)]
  const T = origin.idx

  const keys =
    req.model === "tsfm_base"
      ? BASE_COV_KEYS()
      : req.model === "tsfm"
        ? new Set<CovKey>(
            req.covKeys?.length
              ? req.covKeys
              : [...fullCovKeys(s, isDirection ? "price" : target)],
          )
        : req.model === "timestral"
          ? new Set<CovKey>(
              req.covKeys?.length
                ? req.covKeys
                : [...fullCovKeys(s, isDirection ? "price" : target)],
            )
          : fullCovKeys(s, isDirection ? "price" : target)

  /* --- fan: one real sidecar call returns all H steps for Timestral --- */
  const fan: ForecastPoint[] = []
  if (req.model === "timestral") {
    const mat = await timestralQuantiles(s, isDirection ? "price" : target, T, H, keys)
    for (let h = 1; h <= H; h++) fan.push(toForecastPoint(s, T, h, mat[h - 1], isVol))
  } else if (req.model === "tsfm" || req.model === "tsfm_base") {
    const anchors = anchorSteps(H)
    const anchorQ = anchors.map((h) =>
      predictStandInAt(ctx, getFit(ctx, h, keys), T, h, keys),
    )
    for (let h = 1; h <= H; h++) {
      let ai = anchors.findIndex((a) => a >= h)
      if (ai === -1) ai = anchors.length - 1
      let q: QVec
      if (anchors[ai] === h) {
        q = anchorQ[ai]
      } else {
        const lo = Math.max(0, ai - 1)
        const h0 = anchors[lo]
        const h1 = anchors[ai]
        const fr = h1 === h0 ? 0 : (h - h0) / (h1 - h0)
        q = interpQ(anchorQ[lo], anchorQ[ai], fr)
      }
      fan.push(toForecastPoint(s, T, h, q, isVol))
    }
  } else {
    const pred = armPredict(req.model, ctx, H, keys)
    for (let h = 1; h <= H; h++) fan.push(toForecastPoint(s, T, h, pred(T, h), isVol))
  }

  /* --- history (target space; vol shows trailing 24h RV at window end) --- */
  const history: HistoryPoint[] = []
  const from = Math.max(24, T - HISTORY_BARS)
  for (let i = from; i <= T; i++) {
    const v = isVol ? s.rv24[i] : s.logc[i]
    history.push({
      t: new Date(s.bars[i].t).toISOString(),
      v: Number.isFinite(v) ? v : null,
      regime: s.regime[i],
      shift: s.shifts[i],
    })
  }

  /* --- direction card: P(up) from the fan CDF + rolling Brier/acc --- */
  let direction: ForecastResponse["direction"] = null
  if (isDirection) {
    const q = fan.length ? qVecOf(fan[fan.length - 1]) : null
    const yNow = s.logc[T]
    const pUp = q ? 1 - cdfFromQuantiles(q, yNow) : 0.5
    const yFut = T + H < s.bars.length ? s.logc[T + H] : null
    let brierAcc = 0,
      accHits = 0,
      n = 0
    for (const o of evalOrigins(s, H)) {
      if (o.idx + H >= s.bars.length) continue
      let qo: QVec
      if (req.model === "timestral") {
        qo = (await timestralQuantiles(s, "price", o.idx, H, keys))[H - 1]
      } else if (req.model === "tsfm" || req.model === "tsfm_base") {
        qo = predictStandInAt(ctx, getFit(ctx, H, keys), o.idx, H, keys)
      } else {
        qo = armPredict(req.model, ctx, H, keys)(o.idx, H)
      }
      const p = 1 - cdfFromQuantiles(qo, s.logc[o.idx])
      const up = s.logc[o.idx + H] > s.logc[o.idx]
      brierAcc += (p - (up ? 1 : 0)) ** 2
      if ((p > 0.5) === up) accHits++
      n++
    }
    direction = {
      pUp,
      actualUp: yFut === null ? null : yFut > yNow,
      histBrier: n ? brierAcc / n : 0.25,
      histAcc: n ? accHits / n : 0.5,
      n,
    }
  }

  /* --- local metrics over rolling origins for the selected arm --- */
  const evalOrig = evalOrigins(s, H)
  let local: ForecastResponse["local"]
  if (req.model === "timestral") {
    const arm = await runTimestralArm(ctx, H, evalOrig, keys)
    local = {
      pinball: arm.pinball,
      crps: arm.crps,
      coverage: { "50": arm.cov50, "80": arm.cov80, "90": arm.cov90 },
      width: { "80": arm.width80 },
      n: arm.perOriginLoss.length,
    }
  } else {
    const arm = runArm(ctx, req.model, H, evalOrig, keys)
    local = {
      pinball: arm.pinball,
      crps: arm.crps,
      coverage: { "50": arm.cov50, "80": arm.cov80, "90": arm.cov90 },
      width: { "80": arm.width80 },
      n: arm.perOriginLoss.length,
    }
  }

  /* --- covariate panel (importance lazily computed on first view) --- */
  await ensureImportance(req.series, isDirection ? "price" : target)
  const covPanel = covariatePanel(s, isDirection ? "price" : target, keys, T, H)

  return {
    series: req.series,
    target,
    horizon: H,
    model: req.model,
    cutoff: new Date(s.bars[T].t).toISOString(),
    history,
    fan,
    direction,
    covariates: covPanel,
    local,
    yLabel: isVol ? "log RV (24h trailing · h-hour direct fan, window end)" : "log price",
  }
}

/** Lazily ensure leave-one-covariate-out covariate importance exists for (series, target). */
async function ensureImportance(
  series: SeriesId,
  effTarget: Target,
): Promise<Map<CovKey, number>> {
  const key = cacheKey(series, effTarget, 24)
  let imp = importanceCache.get(key)
  if (!imp) {
    const { ctx, s } = await ctxFor(series, effTarget)
    const origins = evalOrigins(s, 24)
    const full = fullCovKeys(s, effTarget)
    imp = covImportance(ctx, 24, origins, full)
    importanceCache.set(key, imp)
  }
  return imp
}

function toForecastPoint(
  s: SeriesData,
  T: number,
  h: number,
  q: QVec,
  isVol: boolean,
): ForecastPoint {
  const idx = T + h
  const t =
    idx < s.bars.length
      ? new Date(s.bars[idx].t).toISOString()
      : new Date(s.bars[T].t + h * 3600_000).toISOString()
  const actual = isVol ? rvAt(s, T, h) : idx < s.bars.length ? s.logc[idx] : null
  return {
    h,
    t,
    q05: q[0],
    q10: q[1],
    q25: q[2],
    q50: q[3],
    q75: q[4],
    q90: q[5],
    q95: q[6],
    actual: Number.isFinite(actual as number) ? (actual as number) : null,
  }
}

/* ---------------------------- covariate panel ------------------------------ */

function covariatePanel(
  s: SeriesData,
  target: Target,
  keys: Set<CovKey>,
  T: number,
  H: number,
): CovariateRow[] {
  const isVol = target === "vol"
  const from = Math.max(24, T - 240)
  const specOf = (key: string) => COVARIATES.find((c) => c.key === key)
  const imp = importanceFor(s.id, target, 24)
  const rows: CovariateRow[] = []
  const sparkOf = (arr: Float64Array): number[] => {
    const out: number[] = []
    for (let i = from; i <= T; i++) out.push(Number.isFinite(arr[i]) ? arr[i] : 0)
    return out
  }
  const push = (
    key: CovKey,
    label: string,
    cls: CovariateRow["cls"],
    desc: string,
    spark: number[],
    opts?: { sparkFuture?: number[]; locked?: boolean },
  ) => {
    rows.push({
      key,
      label,
      cls,
      desc,
      enabled: opts?.locked ? true : keys.has(key),
      contribution: opts?.locked ? undefined : imp.get(key),
      spark,
      sparkFuture: opts?.sparkFuture,
    })
  }

  push(
    "target_lag",
    isVol ? "log RV lags {24,72,168}" : "log price lags {0,1,24}",
    "target",
    specOf("target_lag")?.desc ?? "The target series' own history.",
    sparkOf(isVol ? s.rv24 : s.logc),
    { locked: true },
  )
  push(
    "rv24",
    "Realized vol 24h",
    isVol ? "target" : "past",
    specOf("rv24")?.desc ?? "",
    sparkOf(s.rv24),
    { locked: isVol },
  )
  push(
    "rv72",
    "Realized vol 72h",
    isVol ? "target" : "past",
    specOf("rv72")?.desc ?? "",
    sparkOf(s.rv72),
    { locked: isVol },
  )
  push("atr", "ATR(14)/price", "past", specOf("atr")?.desc ?? "", sparkOf(s.atr))
  push("ewma", "EWMA vol (λ=0.94)", "past", specOf("ewma")?.desc ?? "", sparkOf(s.ewma))
  push("volz", "Volume z-score", "past", specOf("volz")?.desc ?? "", sparkOf(s.volz))
  push("drawdown", "Drawdown (480h)", "past", specOf("drawdown")?.desc ?? "", sparkOf(s.drawdown))
  push("rsi", "RSI(14)", "past", specOf("rsi")?.desc ?? "", sparkOf(s.rsi))
  if (!isVol) push("lag_ret", "Lag returns {1,24}", "past", specOf("lag_ret")?.desc ?? "", sparkOf(s.ret1))
  push("trend", "Trend slope 168h", "past", specOf("trend")?.desc ?? "", sparkOf(s.trend))
  push(
    "regime",
    "Regime (3-state)",
    "categorical",
    specOf("regime")?.desc ?? "",
    Array.from({ length: T - from + 1 }, (_, k) => s.regime[from + k]),
  )
  push(
    "shift",
    "Shift flag (CUSUM)",
    "categorical",
    specOf("shift")?.desc ?? "",
    Array.from({ length: T - from + 1 }, (_, k) => (s.shifts[from + k] ? 1 : 0)),
  )
  /* known-future calendar rows — each shows history + the horizon segment */
  const calSpark = (key: CovKey, name: string): { hist: number[]; fut: number[] } => {
    const hist: number[] = []
    for (let i = from; i <= T; i++) hist.push(calendarValue(name, s.bars[i].t))
    const fut: number[] = []
    for (let h = 1; h <= H; h++) fut.push(calendarValue(name, s.bars[T].t + h * 3600_000))
    return { hist, fut }
  }
  const calPush = (key: CovKey, label: string) => {
    const names = calendarNamesFor(key)
    const first = calSpark(key, names[0])
    push(key, label, "known-future", specOf(key)?.desc ?? "", first.hist, {
      sparkFuture: first.fut,
    })
  }
  calPush("hour", "Hour of day (sin/cos)")
  calPush("dow", "Day of week")
  calPush("session", "Session flags (London/NY)")
  calPush("month_end", "Month-end flag")
  calPush("opex", "OpEx (3rd Friday)")
  void isKnownFutureKey
  return rows
}

function importanceFor(series: string, target: Target, H: number): Map<CovKey, number> {
  const key = cacheKey(series, target, H)
  return importanceCache.get(key) ?? new Map()
}

/* ---------------------------------- eval ----------------------------------- */

export async function evaluate(
  series: SeriesId,
  target: Target,
  horizon: number,
): Promise<EvalResponse> {
  const H = Math.max(1, Math.min(72, horizon || 24))
  const key = cacheKey("eval", series, target, H)
  const hit = evalCache.get(key)
  if (hit) return hit

  const { ctx, s } = await ctxFor(series, target)
  const effTarget: Target = target === "direction" ? "price" : target
  const origins = evalOrigins(s, H)
  const full = fullCovKeys(s, effTarget)
  const base = BASE_COV_KEYS()
  const armKeys = (m: ModelId) => (m === "tsfm_base" ? base : full)

  /* sync arms (baselines + ridge stand-ins) */
  const arms: ArmResult[] = []
  for (const m of modelsFor(target)) {
    if (m === "timestral") continue
    arms.push(runArm(ctx, m, H, origins, armKeys(m), target === "direction"))
  }

  /* the REAL model arm + deafness ablations + its own PIT */
  let timestral: EvalResponse["timestral"]
  let pitTimestral: number[] | undefined
  let ablation: EvalResponse["ablation"]
  const health = await sidecarHealth()
  if (health.ok) {
    try {
      const tArm = await runTimestralArm(ctx, H, origins, full, {
        forceDirection: target === "direction",
      })
      arms.push(tArm)
      /* PIT histogram from the real model's per-origin quantile vectors */
      const bins = new Array<number>(20).fill(0)
      let pn = 0
      for (let k = 0; k < origins.length && k < tArm.qvecs.length; k++) {
        const o = origins[k]
        const q = tArm.qvecs[k]
        let f: number
        if (target === "direction") {
          f = 1 - cdfFromQuantiles(q, s.logc[o.idx])
        } else {
          const y = ctx.y(o.idx, H)
          if (!Number.isFinite(y)) continue
          f = cdfFromQuantiles(q, y)
        }
        bins[Math.min(19, Math.max(0, Math.floor(f * 20)))]++
        pn++
      }
      pitTimestral = bins.map((b) => b / Math.max(1, pn))
      /* covariate-deafness: "wrong values, right distribution" — subsampled
         (stride 3, it's a diagnostic) and compared against the full arm
         restricted to the same origins for a fair delta */
      const abStride = 3
      const subLoss =
        tArm.perOriginLoss.length === origins.length
          ? origins
              .map((_, i) => i)
              .filter((i) => i % abStride === 0)
              .map((i) => tArm.perOriginLoss[i])
              .filter(Number.isFinite)
          : tArm.perOriginLoss
      const subCrps =
        (subLoss.reduce((a, b) => a + b, 0) / Math.max(1, subLoss.length)) * EVAL.crpsFactor
      const spArm = await runTimestralArm(ctx, H, origins, full, {
        shufflePast: true,
        originStride: abStride,
        forceDirection: target === "direction",
      })
      const skArm = await runTimestralArm(ctx, H, origins, full, {
        shuffleKnown: true,
        originStride: abStride,
        forceDirection: target === "direction",
      })
      const delta = (x: number) => ((x - subCrps) / Math.max(1e-12, subCrps)) * 100
      ablation = {
        shufflePast: { crps: spArm.crps, deltaPct: delta(spArm.crps) },
        shuffleKnown: { crps: skArm.crps, deltaPct: delta(skArm.crps) },
      }
      timestral = { available: true }
    } catch (e) {
      timestral = { available: false, note: String(e).slice(0, 160) }
    }
  } else {
    timestral = { available: false, note: health.note ?? "sidecar unavailable" }
  }

  const bar = barFor(target)
  const labels = Object.fromEntries(MODELS.map((m) => [m.id, m.label])) as Record<
    ModelId,
    string
  >
  const rows = toMetricRows(arms, bar, labels)
  const pit = pitHistogram(ctx, H, origins, full)
  const pitBase = pitHistogram(ctx, H, origins, base)

  const impKey = cacheKey(series, effTarget, H)
  if (!importanceCache.has(impKey)) {
    importanceCache.set(impKey, covImportance(ctx, H, origins, full))
  }

  /* the gate is evaluated on the REAL model when it is live, else the stand-in */
  const realRow = timestral?.available ? rows.find((r) => r.model === "timestral") : null
  const tsfmRow = realRow ?? rows.find((r) => r.model === "tsfm")
  const whichModel = realRow
    ? "Timestral-5M (real · zero-shot)"
    : "the ridge stand-in (sidecar offline — start mini-services/tsfm-sidecar)"
  const tsfmBaseRow = rows.find((r) => r.model === "tsfm_base")
  let verdict: EvalResponse["verdict"]
  if (target === "direction") {
    const b = tsfmRow?.brier ?? 0.25
    const a = tsfmRow?.acc ?? 0.5
    verdict = {
      gate: `Beat the coin flip (Brier < 0.25 AND accuracy > 50%) — ${whichModel}`,
      passed: b < 0.25 ? (a > 0.5 ? true : null) : false,
      detail:
        b < 0.25 && a > 0.5
          ? `Direction skill detected: Brier ${b.toFixed(4)} vs 0.25, accuracy ${(a * 100).toFixed(1)}%.`
          : b >= 0.25
            ? `No direction skill: Brier ${b.toFixed(4)} ≥ 0.25 — P(up) carries no information beyond the coin.`
            : `Mixed: Brier ${b.toFixed(4)} < 0.25 but accuracy ${(a * 100).toFixed(1)}% ≤ 50%.`,
    }
  } else {
    const ratio = tsfmRow?.skillRatio ?? 1
    const dmP = tsfmRow?.dmP ?? 1
    const barLabel = labels[bar]
    const covGain = tsfmBaseRow?.crps
      ? ((tsfmBaseRow.crps - (tsfmRow?.crps ?? 0)) / tsfmBaseRow.crps) * 100
      : 0
    verdict = {
      gate: `Beat ${barLabel} (CRPS ratio < 1, DM p < 0.05) — ${whichModel}`,
      passed: ratio < 1 ? (dmP < 0.05 ? true : null) : false,
      detail:
        ratio < 1 && dmP < 0.05
          ? `Significant skill vs ${barLabel}: CRPS ratio ${ratio.toFixed(3)}, DM p ${dmP.toFixed(4)}. Covariates buy ${covGain >= 0 ? "+" : ""}${covGain.toFixed(1)}% vs the univariate stand-in.`
          : ratio < 1
            ? `Point estimate better than ${barLabel} (ratio ${ratio.toFixed(3)}) but NOT significant (DM p ${dmP.toFixed(3)}) — treat as unproven.`
            : `No skill vs ${barLabel}: CRPS ratio ${ratio.toFixed(3)} ≥ 1 (DM p ${dmP?.toFixed(3) ?? "—"}).`,
    }
  }

  const resp: EvalResponse = {
    series,
    target,
    horizon: H,
    rows,
    bar,
    pit,
    pitBase,
    pitTimestral,
    ablation,
    timestral,
    verdict,
    n: origins.length,
  }
  evalCache.set(key, resp)
  return resp
}
