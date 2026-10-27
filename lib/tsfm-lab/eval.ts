/* ---------------------------------------------------------------------------
 * TSFM Lab — rolling-origin evaluation
 *
 * Protocol (EVAL in design.ts): origins every 24h over the final 90 days,
 * models FROZEN at eval start (train ends 72 bars before the first origin —
 * the embargo), direct (H,τ) heads scored at h = H:
 *   pinball per τ · CRPS ≈ 2·mean pinball · empirical coverage of the
 *   50/80/90% intervals · mean width · PIT histogram (20 bins) ·
 *   Diebold–Mariano z vs the bar model (Newey–West variance, lag ⌈H/24⌉+1) ·
 *   Brier/accuracy for the direction target · leave-one-covariate-out
 *   ablation importance for the covariate panel.
 * ------------------------------------------------------------------------- */

import type { SeriesData } from "./data"
import {
  EVAL,
  type Target,
  type ModelId,
  type MetricRow,
} from "./design"
import type { FeatureCtx, QVec, CovKey } from "./models"
import {
  TAU,
  cdfFromQuantiles,
  normCdf,
  armPredict,
  fitStandInAt,
  predictStandInAt,
  makeVolTargets,
} from "./models"
import { timestralQuantiles, sidecarHealth, type QMat } from "./sidecar"

export const BURN_IN = 720
export const EMBARGO = EVAL.embargoBars // 72
export const EVAL_HOURS = EVAL.originDays * 24 // 2160

export interface Origin {
  idx: number
  t: number
}

/** Fixed 90-origin grid over the final 90 days (the cutoff slider's axis). */
export function originGrid(s: SeriesData): Origin[] {
  const N = s.bars.length
  const out: Origin[] = []
  for (let i = 0; i < EVAL.originDays; i++) {
    const idx = N - EVAL_HOURS + i * EVAL.originStrideHours
    if (idx < N && idx > BURN_IN + EMBARGO + 600) out.push({ idx, t: s.bars[idx].t })
  }
  return out
}

/** Origins valid for horizon H (enough future bars for the target). */
export function evalOrigins(s: SeriesData, H: number): Origin[] {
  const N = s.bars.length
  return originGrid(s).filter((o) => o.idx + H < N)
}

export function trainEndIndex(s: SeriesData): number {
  return s.bars.length - EVAL_HOURS - EMBARGO
}

export function buildCtx(s: SeriesData, target: Target): FeatureCtx {
  const { rvH, rv168 } = makeVolTargets(s)
  const y: (i: number, h: number) => number =
    target === "vol"
      ? (i, h) => rvH(i, h)
      : (i, h) => (i + h < s.logc.length ? s.logc[i + h] : NaN)
  return {
    s,
    target,
    trainStart: BURN_IN,
    trainEnd: trainEndIndex(s),
    y,
    rv168,
  }
}

/* --------------------------------- losses ---------------------------------- */

function pinball(y: number, q: number, τ: number): number {
  const e = y - q
  return τ * Math.max(0, e) + (1 - τ) * Math.max(0, -e)
}

function lossOf(y: number, q: QVec): number {
  let s = 0
  for (let k = 0; k < TAU.length; k++) s += pinball(y, q[k], TAU[k])
  return s / TAU.length
}

function coverageOf(y: number, q: QVec, lo: number, hi: number): number {
  const i = TAU.indexOf(lo as never)
  const j = TAU.indexOf(hi as never)
  return y >= q[i] && y <= q[j] ? 1 : 0
}

function widthOf(q: QVec, lo: number, hi: number): number {
  const i = TAU.indexOf(lo as never)
  const j = TAU.indexOf(hi as never)
  return q[j] - q[i]
}

/** Diebold–Mariano with Newey–West variance. Returns [z, p]. */
export function dmTest(d: number[], lag: number): [number, number] {
  const n = d.length
  if (n < 8) return [0, 1]
  const mean = d.reduce((a, b) => a + b, 0) / n
  let g0 = 0
  for (const v of d) g0 += (v - mean) * (v - mean)
  g0 /= n
  let lrv = g0
  for (let k = 1; k <= lag; k++) {
    let gk = 0
    for (let i = k; i < n; i++) gk += (d[i] - mean) * (d[i - k] - mean)
    gk /= n
    lrv += 2 * ((n - k) / n) * gk
  }
  if (lrv <= 1e-18) return [0, 1]
  const z = mean / Math.sqrt(lrv / n)
  return [z, 2 * (1 - normCdf(Math.abs(z)))]
}

/* ------------------------------- model arms -------------------------------- */

export function modelsFor(target: Target): ModelId[] {
  // Vol lane: EWMA · GARCH family · seasonal profile · Log-HAR (the bar) ·
  // TSFM stand-ins + the real model. Other lanes: the random walk + stand-ins.
  if (target === "vol")
    return ["ewma", "garch", "gjr", "egarch", "svol", "har", "tsfm_base", "tsfm", "timestral"]
  return ["naive", "tsfm_base", "tsfm", "timestral"]
}

export function barFor(target: Target): ModelId {
  return target === "vol" ? "har" : "naive"
}

/** Covariate keys applicable to a target (the full-conditioning arm, M3). */
export function fullCovKeys(_s: SeriesData, target: Target): Set<CovKey> {
  void _s
  const keys = new Set<CovKey>([
    "target_lag",
    "trend",
    "regime",
    "hour",
    "dow",
    "session",
    "month_end",
    "opex",
  ])
  if (target === "vol") {
    keys.add("atr")
    keys.add("ewma")
    keys.add("shift")
  } else {
    keys.add("rv24")
    keys.add("rv72")
    keys.add("atr")
    keys.add("ewma")
    keys.add("volz")
    keys.add("drawdown")
    keys.add("rsi")
    keys.add("lag_ret")
    keys.add("shift")
  }
  return keys
}

export const BASE_COV_KEYS = (): Set<CovKey> => new Set<CovKey>(["target_lag"])

/* --------------------------- real-model arm -------------------------------- */

export interface TimestralArmResult extends ArmResult {
  qvecs: QVec[] // per-origin 7-τ vectors (for the PIT histogram)
  available: boolean
}

/** Run the REAL Timestral-5M arm over the rolling origins (cached sidecar
 *  calls, small parallel pool). Zero-shot — the model has never seen these
 *  symbols; covariates ride in as past-only + known-future channels.
 *  originStride > 1 evaluates a subsample (used by the ablation arms). */
export async function runTimestralArm(
  ctx: FeatureCtx,
  H: number,
  origins: Origin[],
  covKeys: Set<CovKey>,
  opts?: {
    shufflePast?: boolean
    shuffleKnown?: boolean
    forceDirection?: boolean
    originStride?: number
  },
): Promise<TimestralArmResult> {
  const isDirection = opts?.forceDirection || ctx.target === "direction"
  const stride = Math.max(1, opts?.originStride ?? 1)
  const active = stride > 1 ? origins.filter((_, i) => i % stride === 0) : origins

  /* small parallel pool — the sidecar serializes inference internally, but
     JSON build/parse and HTTP overlap; 4 workers cut wall time ~2.5× */
  const mats: QMat[] = new Array(active.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= active.length) return
      const o = active[i]
      mats[i] = await timestralQuantiles(ctx.s, ctx.target, o.idx, H, covKeys, opts)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))

  const perOriginLoss: number[] = []
  const pUps: number[] = []
  const losses: number[] = []
  const qvecs: QVec[] = []
  let cov50 = 0,
    cov80 = 0,
    cov90 = 0,
    widthAcc = 0,
    brierAcc = 0,
    accHits = 0,
    n = 0
  for (let k = 0; k < active.length; k++) {
    const o = active[k]
    const mat = mats[k]
    const q = mat[Math.min(H, mat.length) - 1]
    qvecs.push(q)
    if (isDirection) {
      if (o.idx + H >= ctx.s.logc.length) continue
      const yNow = ctx.s.logc[o.idx]
      const yFut = ctx.s.logc[o.idx + H]
      const pUp = 1 - cdfFromQuantiles(q, yNow)
      const actualUp = yFut > yNow
      const b = (pUp - (actualUp ? 1 : 0)) ** 2
      perOriginLoss.push(b)
      losses.push(b)
      pUps.push(pUp)
      brierAcc += b
      if ((pUp > 0.5) === actualUp) accHits++
      n++
    } else {
      const y = ctx.y(o.idx, H)
      if (!Number.isFinite(y)) continue
      let s = 0
      for (let k = 0; k < TAU.length; k++) {
        const e = y - q[k]
        s += TAU[k] * Math.max(0, e) + (1 - TAU[k]) * Math.max(0, -e)
      }
      const l = s / TAU.length
      perOriginLoss.push(l)
      losses.push(l)
      cov50 += y >= q[2] && y <= q[4] ? 1 : 0
      cov80 += y >= q[1] && y <= q[5] ? 1 : 0
      cov90 += y >= q[0] && y <= q[6] ? 1 : 0
      widthAcc += q[5] - q[1]
      n++
    }
  }
  const nn = Math.max(1, n)
  const pinball = losses.reduce((a, b) => a + b, 0) / nn
  return {
    model: "timestral",
    perOriginLoss,
    pinball,
    crps: pinball * EVAL.crpsFactor,
    cov50: cov50 / nn,
    cov80: cov80 / nn,
    cov90: cov90 / nn,
    width80: widthAcc / nn,
    brier: isDirection ? brierAcc / nn : null,
    acc: isDirection ? accHits / nn : null,
    pUpSeries: isDirection ? pUps : null,
    qvecs,
    available: n > 0,
  }
}

/* --------------------------------- runner ---------------------------------- */

export interface ArmResult {
  model: ModelId
  perOriginLoss: number[]
  pinball: number
  crps: number
  cov50: number
  cov80: number
  cov90: number
  width80: number
  brier: number | null
  acc: number | null
  pUpSeries: number[] | null
}

export function runArm(
  ctx: FeatureCtx,
  model: ModelId,
  H: number,
  origins: Origin[],
  covKeys: Set<CovKey>,
  forceDirection = false,
): ArmResult {
  const isDirection = forceDirection || ctx.target === "direction"
  // direction derives from the price fan; y is logc at T+H
  const priceCtx: FeatureCtx = isDirection ? { ...ctx, target: "price" } : ctx
  const pred = armPredict(model, priceCtx, H, covKeys)
  const perOriginLoss: number[] = []
  const pUps: number[] = []
  const losses: number[] = []
  let cov50 = 0,
    cov80 = 0,
    cov90 = 0,
    widthAcc = 0,
    brierAcc = 0,
    accHits = 0,
    n = 0
  for (const o of origins) {
    const q = pred(o.idx, H)
    if (isDirection) {
      if (o.idx + H >= ctx.s.logc.length) continue
      const yNow = ctx.s.logc[o.idx]
      const yFut = ctx.s.logc[o.idx + H]
      const pUp = 1 - cdfFromQuantiles(q, yNow)
      const actualUp = yFut > yNow
      const b = (pUp - (actualUp ? 1 : 0)) ** 2
      perOriginLoss.push(b)
      losses.push(b)
      pUps.push(pUp)
      brierAcc += b
      if ((pUp > 0.5) === actualUp) accHits++
      n++
    } else {
      const y = ctx.y(o.idx, H)
      if (!Number.isFinite(y)) continue
      const l = lossOf(y, q)
      perOriginLoss.push(l)
      losses.push(l)
      cov50 += coverageOf(y, q, 0.25, 0.75)
      cov80 += coverageOf(y, q, 0.1, 0.9)
      cov90 += coverageOf(y, q, 0.05, 0.95)
      widthAcc += widthOf(q, 0.1, 0.9)
      n++
    }
  }
  const nn = Math.max(1, n)
  const pinball = losses.reduce((a, b) => a + b, 0) / nn
  return {
    model,
    perOriginLoss,
    pinball,
    crps: pinball * EVAL.crpsFactor,
    cov50: cov50 / nn,
    cov80: cov80 / nn,
    cov90: cov90 / nn,
    width80: widthAcc / nn,
    brier: isDirection ? brierAcc / nn : null,
    acc: isDirection ? accHits / nn : null,
    pUpSeries: isDirection ? pUps : null,
  }
}

/** PIT histogram (20 bins) for a fitted tsfm arm. */
export function pitHistogram(
  ctx: FeatureCtx,
  H: number,
  origins: Origin[],
  covKeys: Set<CovKey>,
): number[] {
  const isDirection = ctx.target === "direction"
  const priceCtx: FeatureCtx = isDirection ? { ...ctx, target: "price" } : ctx
  const fit = fitStandInAt(priceCtx, H, covKeys)
  const bins = new Array<number>(20).fill(0)
  let n = 0
  for (const o of origins) {
    const q = predictStandInAt(priceCtx, fit, o.idx, H, covKeys)
    if (isDirection) {
      const yNow = ctx.s.logc[o.idx]
      const pUp = 1 - cdfFromQuantiles(q, yNow)
      const f = pUp // PIT of the binary outcome via predicted P(up)
      bins[Math.min(19, Math.max(0, Math.floor(f * 20)))]++
    } else {
      const y = ctx.y(o.idx, H)
      if (!Number.isFinite(y)) continue
      const f = cdfFromQuantiles(q, y)
      bins[Math.min(19, Math.max(0, Math.floor(f * 20)))]++
    }
    n++
  }
  return bins.map((b) => b / Math.max(1, n))
}

/** Leave-one-covariate-out ablation importance (% Δ-CRPS vs full arm). */
export function covImportance(
  ctx: FeatureCtx,
  H: number,
  origins: Origin[],
  full: Set<CovKey>,
): Map<CovKey, number> {
  const base = runArm(ctx, "tsfm", H, origins, full)
  const out = new Map<CovKey, number>()
  for (const key of full) {
    if (key === "target_lag") continue
    const reduced = new Set(full)
    reduced.delete(key)
    const arm = runArm(ctx, "tsfm", H, origins, reduced)
    out.set(key, ((arm.crps - base.crps) / base.crps) * 100)
  }
  return out
}

/* ------------------------------ metric rows -------------------------------- */

export function toMetricRows(
  arms: ArmResult[],
  bar: ModelId | null,
  labels: Record<ModelId, string>,
): MetricRow[] {
  const barArm = bar ? arms.find((a) => a.model === bar) : undefined
  return arms.map((a) => {
    let dmZ: number | null = null
    let dmP: number | null = null
    let skillRatio: number | null = null
    if (barArm && barArm.model !== a.model) {
      const d = a.perOriginLoss.map((v, i) => v - barArm.perOriginLoss[i])
      const lag = 2
      const [z, p] = dmTest(d, lag)
      dmZ = z
      dmP = p
      skillRatio = barArm.pinball > 1e-18 ? a.pinball / barArm.pinball : null
    }
    return {
      model: a.model,
      label: labels[a.model],
      pinball: a.pinball,
      crps: a.crps,
      cov50: a.cov50,
      cov80: a.cov80,
      cov90: a.cov90,
      width80: a.width80,
      dmZ,
      dmP,
      skillRatio,
      brier: a.brier,
      acc: a.acc,
    }
  })
}
