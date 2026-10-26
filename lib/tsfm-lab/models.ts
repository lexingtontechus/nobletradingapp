/* ---------------------------------------------------------------------------
 * TSFM Lab — forecast model arms
 *
 * Every arm emits the full 7-quantile vector for (origin T, step h) —
 * direct multi-horizon heads, monotone by construction:
 *   naive        last value + empirical H-step innovation quantiles (RW bar;
 *                in finance this IS the price-lane climatology null)
 *   svol         hour-of-day seasonal vol profile + residual quantiles — the
 *                finance-native heir of the retired weather baselines (the
 *                intraday vol U-shape; collapses to the unconditional vol
 *                distribution at H=24)
 *   ewma         RiskMetrics EWMA variance + residual quantiles (vol)
 *   har          Log-HAR (RV_24/RV_72/RV_168) + residual quantiles (vol bar)
 *   tsfm         covariate-conditioned ridge location+scale head with
 *                empirical standardized-residual quantiles — the harness
 *                stand-in for the foundation model (TimesFM-2.5 / Chronos-2
 *                + LoRA quantile head). tsfm_base = univariate ablation.
 * ------------------------------------------------------------------------- */

import type { SeriesData } from "./data"
import { QUANTILES, type Target, type ModelId } from "./design"

export const TAU = QUANTILES
export type QVec = number[]

/* ------------------------------- utilities -------------------------------- */

/** Empirical quantile with linear interpolation over a SORTED array. */
export function equant(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0]
  const idx = p * (n - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(n - 1, lo + 1)
  const fr = idx - lo
  return sorted[lo] * (1 - fr) + sorted[hi] * fr
}

const quantilesOf = (vals: number[]): QVec => {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b)
  return TAU.map((τ) => equant(s, τ))
}

/** Monotone CDF from the 7-quantile vector (piecewise linear, clamped). */
export function cdfFromQuantiles(q: QVec, y: number): number {
  const ps = TAU as readonly number[]
  if (!Number.isFinite(y)) return NaN
  if (y <= q[0]) {
    const slope = ps[0] / Math.max(1e-12, q[0] - q[1])
    return Math.max(1e-4, ps[0] - (q[0] - y) * slope)
  }
  if (y >= q[6]) {
    const slope = (1 - ps[6]) / Math.max(1e-12, q[6] - q[5])
    return Math.min(1 - 1e-4, ps[6] + (y - q[6]) * slope)
  }
  for (let i = 0; i < 6; i++) {
    if (y <= q[i + 1]) {
      const fr = (y - q[i]) / Math.max(1e-12, q[i + 1] - q[i])
      return ps[i] + fr * (ps[i + 1] - ps[i])
    }
  }
  return 0.5
}

export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2)
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z >= 0 ? 1 - p : p
}

/** Solve (A + λI) x = b via Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[], λ: number): number[] {
  const d = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let i = 0; i < d; i++) M[i][i] += λ
  for (let c = 0; c < d; c++) {
    let piv = c
    for (let r = c + 1; r < d; r++)
      if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-12) continue
    if (piv !== c) {
      const tmp = M[c]
      M[c] = M[piv]
      M[piv] = tmp
    }
    for (let r = c + 1; r < d; r++) {
      const f = M[r][c] / M[c][c]
      if (f === 0) continue
      for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array<number>(d).fill(0)
  for (let r = d - 1; r >= 0; r--) {
    let s = M[r][d]
    for (let k = r + 1; k < d; k++) s -= M[r][k] * x[k]
    x[r] = Math.abs(M[r][r]) < 1e-12 ? 0 : s / M[r][r]
  }
  return x
}

/* ----------------------------- target access ------------------------------ */

/** Prefix-sum machinery: H-hour realized vol (log) + log-price targets. */
export function makeVolTargets(s: SeriesData) {
  const { ret1 } = s
  const n = ret1.length
  const csum = new Float64Array(n + 1)
  const ccnt = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) {
    const r = Number.isFinite(ret1[i]) ? ret1[i] : 0
    csum[i + 1] = csum[i] + r * r
    ccnt[i + 1] = ccnt[i] + (Number.isFinite(ret1[i]) ? 1 : 0)
  }
  const rvH = (i: number, h: number) => {
    const a = Math.max(0, i + 1)
    const b = Math.min(n, i + 1 + h)
    const cnt = ccnt[b] - ccnt[a]
    if (b - a < h || cnt < Math.max(2, Math.floor(h / 3))) return NaN
    return 0.5 * Math.log(Math.max(1e-18, (csum[b] - csum[a]) / cnt))
  }
  const rv168 = new Float64Array(n).fill(NaN)
  for (let i = 168; i < n; i++) rv168[i] = rvH(i - 168, 168)
  return { rvH, rv168 }
}

/* ------------------------------ feature build ----------------------------- */

export const COV_KEYS = [
  "target_lag",
  "rv24",
  "rv72",
  "atr",
  "ewma",
  "volz",
  "drawdown",
  "rsi",
  "lag_ret",
  "trend",
  "regime",
  "shift",
  "hour",
  "dow",
  "session",
  "month_end",
  "opex",
] as const
export type CovKey = (typeof COV_KEYS)[number]

/* --------------------------- known-future calendar ------------------------ */

/** Sub-channel names each known-future toggle expands to (shared with the
 *  Timestral sidecar client so both arms see identical channels). */
export function calendarNamesFor(key: string): string[] {
  switch (key) {
    case "hour":
      return ["hour_s1", "hour_c1", "hour_s2", "hour_c2"]
    case "dow":
      return ["dow_num", "weekend"]
    case "session":
      return ["sess_london", "sess_ny"]
    case "month_end":
      return ["month_end"]
    case "opex":
      return ["opex"]
    default:
      return []
  }
}

export function isKnownFutureKey(key: string): boolean {
  return ["hour", "dow", "session", "month_end", "opex"].includes(key)
}

/** Deterministic calendar value for a named sub-channel at time tMs. */
export function calendarValue(name: string, tMs: number): number {
  const d = new Date(tMs)
  const h = d.getUTCHours()
  switch (name) {
    case "hour_s1":
      return Math.sin((2 * Math.PI * h) / 24)
    case "hour_c1":
      return Math.cos((2 * Math.PI * h) / 24)
    case "hour_s2":
      return Math.sin((4 * Math.PI * h) / 24)
    case "hour_c2":
      return Math.cos((4 * Math.PI * h) / 24)
    case "dow_num":
      return d.getUTCDay() / 6
    case "weekend":
      return d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 1 : 0
    case "sess_london":
      return h >= 7 && h < 16 ? 1 : 0
    case "sess_ny":
      return h >= 12 && h < 21 ? 1 : 0
    case "month_end":
      return new Date(tMs + 48 * 3600_000).getUTCMonth() !== d.getUTCMonth() ? 1 : 0
    case "opex":
      return d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21 ? 1 : 0
    default:
      return 0
  }
}

export interface FeatureCtx {
  s: SeriesData
  target: Target
  trainStart: number
  trainEnd: number // exclusive: last bar usable for fitting (frozen pre-eval)
  y: (i: number, h: number) => number // target value for origin i at step h
  rv168: Float64Array
}

const featureDim = (vol: boolean) =>
  (vol ? 4 : 5) + // target lags (vol: rv24, rv72, rv168, |ret1| — the target's own history)
  (vol ? 7 : 8) + // past-only block (price: rv24, rv72, ewma, volz, dd, rsi, lag1, lag24; vol: atr, ewma, volz, dd, rsi, lag1, lag24)
  1 + // trend
  2 + // regime one-hot (bear, bull)
  1 + // shift flag
  4 + // hour harmonics ×2
  8 + // dow one-hot ×7 + weekend
  2 + // session flags
  1 + // month_end
  1 // opex

/**
 * Feature row for origin i at step h. Column order (fixed):
 *  [ target lags | past-only channels | trend | regime | shift | known-future calendar ]
 * Toggled-off covariates write zeros (the masking IS the ablation).
 */
function featureRow(
  ctx: FeatureCtx,
  i: number,
  h: number,
  covKeys: Set<CovKey>,
): Float64Array {
  const { s, rv168 } = ctx
  const vol = ctx.target === "vol"
  const d = featureDim(vol)
  const row = new Float64Array(d)
  const fut = new Date(s.bars[i].t + h * 3600_000)
  const dow = fut.getUTCDay()
  const nz = (v: number) => (Number.isFinite(v) ? v : 0)
  const w = (on: boolean, v: number) => (on ? v : 0)
  const on = (k: CovKey) => covKeys.has(k)
  let c = 0

  if (vol) {
    row[c++] = nz(s.rv24[i])
    row[c++] = nz(s.rv72[i])
    row[c++] = nz(rv168[i])
    row[c++] = nz(Math.abs(s.ret1[i]))
  } else {
    row[c++] = nz(s.logc[i])
    row[c++] = nz(s.logc[i - 1])
    row[c++] = nz(s.logc[i - 24])
    row[c++] = nz(s.ret1[i])
    row[c++] = nz(s.logc[i] - s.logc[i - 24])
  }
  const rv24v = nz(s.rv24[i])
  const rv72v = nz(s.rv72[i])
  const trendv = nz(s.trend[i])
  const regv = s.regime[i]
  if (!vol) {
    row[c++] = w(on("rv24"), rv24v)
    row[c++] = w(on("rv72"), rv72v)
  }
  row[c++] = w(on("atr"), nz(s.atr[i]))
  row[c++] = w(on("ewma"), nz(s.ewma[i]))
  row[c++] = w(on("volz"), nz(s.volz[i]))
  row[c++] = w(on("drawdown"), nz(s.drawdown[i]))
  row[c++] = w(on("rsi"), nz(s.rsi[i]))
  if (!vol) {
    row[c++] = w(on("lag_ret"), nz(s.ret1[i]))
    row[c++] = w(on("lag_ret"), nz(s.logc[i] - s.logc[i - 24]))
  } else {
    row[c++] = w(on("lag_ret"), nz(s.ret1[i]))
    row[c++] = w(on("lag_ret"), nz(s.logc[i] - s.logc[i - 24]))
  }
  row[c++] = w(on("trend"), trendv)
  row[c++] = w(on("regime"), regv === 0 ? 1 : 0)
  row[c++] = w(on("regime"), regv === 2 ? 1 : 0)
  row[c++] = w(on("shift"), s.shifts[i] ? 1 : 0)
  // known-future calendar at T+h
  row[c++] = w(on("hour"), Math.sin((2 * Math.PI * fut.getUTCHours()) / 24))
  row[c++] = w(on("hour"), Math.cos((2 * Math.PI * fut.getUTCHours()) / 24))
  row[c++] = w(on("hour"), Math.sin((4 * Math.PI * fut.getUTCHours()) / 24))
  row[c++] = w(on("hour"), Math.cos((4 * Math.PI * fut.getUTCHours()) / 24))
  for (let k = 0; k < 7; k++) row[c++] = w(on("dow"), dow === k ? 1 : 0)
  row[c++] = w(on("dow"), dow === 0 || dow === 6 ? 1 : 0)
  row[c++] = w(on("session"), fut.getUTCHours() >= 7 && fut.getUTCHours() < 16 ? 1 : 0)
  row[c++] = w(on("session"), fut.getUTCHours() >= 12 && fut.getUTCHours() < 21 ? 1 : 0)
  row[c++] = w(on("month_end"), calendarValue("month_end", fut.getTime()))
  row[c++] = w(on("opex"), calendarValue("opex", fut.getTime()))
  return row
}

/* ------------------------------- arm: tsfm -------------------------------- */

export interface StandInFitH {
  wLoc: number[]
  wScl: number[]
  meansA: Float64Array
  sdsA: Float64Array
  meansB: Float64Array
  sdsB: Float64Array
  muY: number // target mean (centering, A-set)
  muLr: number // log|resid| mean (centering, B-set)
  zQ: QVec // standardized-residual quantiles (held-out B-set)
  d: number
  h: number
}

/** Fit the stand-in at a single step h (direct head).
 *  Calibration-honest: the location head trains on the first 70% of the
 *  train window; residual scale + standardized-residual quantiles come from
 *  the HELD-OUT last 30% (out-of-sample residuals — in-sample z-quantiles
 *  would produce over-confident fans). */
export function fitStandInAt(ctx: FeatureCtx, h: number, covKeys: Set<CovKey>): StandInFitH {
  const { s, trainStart, trainEnd, y } = ctx
  const vol = ctx.target === "vol"
  const d = featureDim(vol)
  const lastFit = trainEnd - h // last origin index whose target is inside train
  const split = trainStart + Math.floor(0.7 * (lastFit - trainStart))
  const rowsA: number[] = []
  const rowsB: number[] = []
  for (let i = trainStart; i < lastFit; i++) {
    if (!Number.isFinite(y(i, h))) continue
    ;(i < split ? rowsA : rowsB).push(i)
  }
  const nA = rowsA.length
  const nB = rowsB.length

  const stats = (rows: number[]) => {
    const means = new Float64Array(d)
    const sds = new Float64Array(d)
    const X = new Float64Array(rows.length * d)
    for (let r = 0; r < rows.length; r++) {
      const row = featureRow(ctx, rows[r], h, covKeys)
      for (let j = 0; j < d; j++) {
        X[r * d + j] = row[j]
        means[j] += row[j]
      }
    }
    for (let j = 0; j < d; j++) means[j] /= Math.max(1, rows.length)
    for (let r = 0; r < rows.length; r++)
      for (let j = 0; j < d; j++) {
        const dv = X[r * d + j] - means[j]
        sds[j] += dv * dv
      }
    for (let j = 0; j < d; j++) sds[j] = Math.sqrt(sds[j] / Math.max(1, rows.length - 1)) || 1
    for (let r = 0; r < rows.length; r++)
      for (let j = 0; j < d; j++) X[r * d + j] = (X[r * d + j] - means[j]) / sds[j]
    return { X, means, sds }
  }

  const A0 = stats(rowsA)
  const B0 = stats(rowsB)
  const ysA = new Float64Array(nA)
  for (let r = 0; r < nA; r++) ysA[r] = y(rowsA[r], h)
  const muY = ysA.reduce((a, b) => a + b, 0) / Math.max(1, nA)

  // location head on A
  const λ = Math.max(1, nA / 500)
  const A: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0))
  const bY = new Array<number>(d).fill(0)
  for (let r = 0; r < nA; r++) {
    const yc = ysA[r] - muY
    const off = r * d
    for (let j = 0; j < d; j++) {
      const xv = A0.X[off + j]
      bY[j] += xv * yc
      for (let k = j; k < d; k++) A[j][k] += xv * A0.X[off + k]
    }
  }
  for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) A[j][k] = A[k][j]
  const wLoc = solve(A, bY, λ)

  // out-of-sample residuals on B (A-standardized features through the A-trained
  // location head — NEVER B-standardized, that would mismatch the weights);
  // scale head trains on B-standardized features (its own training set).
  const residB = new Float64Array(nB)
  const lrs = new Float64Array(nB)
  for (let r = 0; r < nB; r++) {
    const rowB = featureRow(ctx, rowsB[r], h, covKeys)
    let pred = 0
    for (let j = 0; j < d; j++)
      pred += ((rowB[j] - A0.means[j]) / A0.sds[j]) * wLoc[j]
    residB[r] = y(rowsB[r], h) - muY - pred
    lrs[r] = Math.log(Math.max(1e-6, Math.abs(residB[r])))
  }
  const muLr = lrs.reduce((a, b) => a + b, 0) / Math.max(1, nB)
  const A2: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0))
  const b2 = new Array<number>(d).fill(0)
  for (let r = 0; r < nB; r++) {
    const lc = lrs[r] - muLr
    const off = r * d
    for (let j = 0; j < d; j++) {
      const xv = B0.X[off + j]
      b2[j] += xv * lc
      for (let k = j; k < d; k++) A2[j][k] += xv * B0.X[off + k]
    }
  }
  for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) A2[j][k] = A2[k][j]
  const λ2 = Math.max(1, nB / 300)
  const wScl = solve(A2, b2, λ2)

  const zs: number[] = []
  for (let r = 0; r < nB; r++) {
    let scl = muLr // re-add the centering — z must be ~±1, not ~±0.04
    const off = r * d
    for (let j = 0; j < d; j++) scl += B0.X[off + j] * wScl[j]
    const sc = Math.exp(Math.max(-6, Math.min(3, scl)))
    zs.push(residB[r] / sc)
  }
  zs.sort((a, b) => a - b)
  return {
    wLoc,
    wScl,
    meansA: A0.means,
    sdsA: A0.sds,
    meansB: B0.means,
    sdsB: B0.sds,
    muY,
    muLr,
    zQ: quantilesOf(zs),
    d,
    h,
  }
}

/** Predict the 7-quantile vector at (origin T, step h) with the h-fit.
 *  Location standardizes with A-set stats; scale with B-set stats. */
export function predictStandInAt(
  ctx: FeatureCtx,
  fit: StandInFitH,
  T: number,
  h: number,
  covKeys: Set<CovKey>,
): QVec {
  const row = featureRow(ctx, T, h, covKeys)
  const d = fit.d
  let loc = fit.muY,
    scl = fit.muLr
  for (let j = 0; j < d; j++) {
    const raw = row[j]
    loc += ((raw - fit.meansA[j]) / fit.sdsA[j]) * fit.wLoc[j]
    scl += ((raw - fit.meansB[j]) / fit.sdsB[j]) * fit.wScl[j]
  }
  const sc = Math.exp(Math.max(-6, Math.min(3, scl)))
  const out = fit.zQ.map((z) => loc + sc * z)
  for (let k = 1; k < out.length; k++) if (out[k] < out[k - 1]) out[k] = out[k - 1]
  return out
}

/* ------------------------------- arm: baselines --------------------------- */

export function naiveQuantiles(ctx: FeatureCtx, T: number, h: number): QVec {
  const { s, trainStart, trainEnd } = ctx
  const innov: number[] = []
  for (let t = trainStart; t + h < trainEnd; t++) {
    const dv = s.logc[t + h] - s.logc[t]
    if (Number.isFinite(dv)) innov.push(dv)
  }
  innov.sort((a, b) => a - b)
  const base = s.logc[T]
  return TAU.map((τ) => base + equant(innov, τ))
}

/* --------------------------- arm: seasonal vol ----------------------------- */

export interface SvolFit {
  wgt: number[] // [intercept, hour dummies 0..23]
  cnt: Int32Array // per-hour prefix counts over bar indices, 24 × (n+1)
  nBars: number
  resid: number[] // sorted train residuals
  h: number
}

/** Hour fractions of the realized-vol window (t, t+h] in BAR-INDEX space —
 *  the same window the RV target averages over. H=1 → pure hour-of-day
 *  profile (the U-shape); H=24 → uniform fractions, so the prediction
 *  collapses to the unconditional vol mean (the vol climatology); H in
 *  between → the blend. This is the finance translation of the retired
 *  weather baselines: the ONLY lane with genuine seasonality is vol. */
function hourFractions(fit: SvolFit, t: number, h: number): Float64Array {
  const n1 = fit.nBars + 1
  const end = Math.min(fit.nBars, t + h)
  const f = new Float64Array(24)
  for (let j = 0; j < 24; j++) f[j] = (fit.cnt[j * n1 + end] - fit.cnt[j * n1 + t]) / h
  return f
}

/** Fit the seasonal vol profile at step h: ridge on [1, f_0…f_23] over the
 *  frozen train window, residual quantiles for the fan. */
export function fitSvolAt(ctx: FeatureCtx, h: number): SvolFit {
  const { s, trainStart, trainEnd, y } = ctx
  const n = s.bars.length
  const n1 = n + 1
  const cnt = new Int32Array(24 * n1)
  const hod = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    hod[i] = new Date(s.bars[i].t).getUTCHours()
    for (let j = 0; j < 24; j++) cnt[j * n1 + i + 1] = cnt[j * n1 + i] + (j === hod[i] ? 1 : 0)
  }
  const fit: SvolFit = { wgt: [], cnt, nBars: n, resid: [], h }

  const rows: number[] = []
  for (let t = trainStart; t + h < trainEnd; t++) {
    if (Number.isFinite(y(t, h))) rows.push(t)
  }
  const d = 25
  const A: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0))
  const b = new Array<number>(d).fill(0)
  for (const t of rows) {
    const f = hourFractions(fit, t, h)
    const x = [1, ...f]
    const yv = y(t, h)
    for (let j = 0; j < d; j++) {
      b[j] += x[j] * yv
      for (let k = j; k < d; k++) A[j][k] += x[j] * x[k]
    }
  }
  for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) A[j][k] = A[k][j]
  fit.wgt = solve(A, b, Math.max(1, 1e-6 * rows.length))

  const resid: number[] = []
  for (const t of rows) {
    const f = hourFractions(fit, t, h)
    let pred = fit.wgt[0]
    for (let j = 0; j < 24; j++) pred += f[j] * fit.wgt[j + 1]
    resid.push(y(t, h) - pred)
  }
  resid.sort((a, b) => a - b)
  fit.resid = resid
  return fit
}

export function svolQuantiles(ctx: FeatureCtx, fit: SvolFit, T: number, h: number): QVec {
  void ctx
  const f = hourFractions(fit, T, h)
  let pred = fit.wgt[0]
  for (let j = 0; j < 24; j++) pred += f[j] * fit.wgt[j + 1]
  return TAU.map((τ) => pred + equant(fit.resid, τ))
}

export function ewmaQuantiles(ctx: FeatureCtx, T: number, h: number): QVec {
  const { s, trainStart, trainEnd } = ctx
  const λ = 0.94
  const n = s.logc.length
  const sigma2 = new Float64Array(n).fill(NaN)
  let v = NaN
  for (let i = 1; i < n; i++) {
    const r = s.ret1[i]
    if (!Number.isFinite(r)) continue
    v = Number.isFinite(v) ? λ * v + (1 - λ) * r * r : r * r
    sigma2[i] = v
  }
  const resid: number[] = []
  for (let t = trainStart; t + h < trainEnd; t++) {
    if (!Number.isFinite(sigma2[t])) continue
    const yv = ctx.y(t, h)
    if (Number.isFinite(yv))
      resid.push(yv - 0.5 * Math.log(Math.max(1e-18, sigma2[t])))
  }
  resid.sort((a, b) => a - b)
  const base = 0.5 * Math.log(Math.max(1e-18, sigma2[T]))
  return TAU.map((τ) => base + equant(resid, τ))
}

export function harQuantiles(ctx: FeatureCtx, T: number, h: number): QVec {
  const { s, rv168, trainStart, trainEnd, y } = ctx
  const rowsI: number[] = []
  for (let t = trainStart; t + h < trainEnd; t++) {
    if (
      Number.isFinite(s.rv24[t]) &&
      Number.isFinite(s.rv72[t]) &&
      Number.isFinite(rv168[t]) &&
      Number.isFinite(y(t, h))
    )
      rowsI.push(t)
  }
  const A: number[][] = Array.from({ length: 4 }, () => new Array<number>(4).fill(0))
  const b = new Array<number>(4).fill(0)
  for (const t of rowsI) {
    const x = [1, s.rv24[t], s.rv72[t], rv168[t]]
    const yv = y(t, h)
    for (let j = 0; j < 4; j++) {
      b[j] += x[j] * yv
      for (let k = j; k < 4; k++) A[j][k] += x[j] * x[k]
    }
  }
  for (let j = 0; j < 4; j++) for (let k = 0; k < j; k++) A[j][k] = A[k][j]
  const wgt = solve(A, b, Math.max(1, 1e-6 * rowsI.length))
  const resid: number[] = []
  for (const t of rowsI) {
    const x = [1, s.rv24[t], s.rv72[t], rv168[t]]
    let pred = 0
    for (let j = 0; j < 4; j++) pred += x[j] * wgt[j]
    resid.push(y(t, h) - pred)
  }
  resid.sort((a, b) => a - b)
  const xT = [1, s.rv24[T], s.rv72[T], rv168[T]]
  let pred = 0
  for (let j = 0; j < 4; j++) pred += xT[j] * wgt[j]
  return TAU.map((τ) => pred + equant(resid, τ))
}

/* ------------------------------ arm dispatch ------------------------------ */

export type ArmPredict = (T: number, h: number) => QVec

/** Baseline arms are stateless per call; tsfm arms bind a fitted head. */
export function armPredict(
  model: ModelId,
  ctx: FeatureCtx,
  h: number,
  covKeys: Set<CovKey>,
  fits?: Map<number, StandInFitH>,
): ArmPredict {
  switch (model) {
    case "naive":
      return (T) => naiveQuantiles(ctx, T, h)
    case "svol": {
      const fit = fitSvolAt(ctx, h)
      return (T) => svolQuantiles(ctx, fit, T, h)
    }
    case "ewma":
      return (T) => ewmaQuantiles(ctx, T, h)
    case "har":
      return (T) => harQuantiles(ctx, T, h)
    case "tsfm":
    case "tsfm_base": {
      const fit = fits?.get(h) ?? fitStandInAt(ctx, h, covKeys)
      return (T) => predictStandInAt(ctx, fit, T, h, covKeys)
    }
    case "timestral":
      // the real model is async (sidecar HTTP) — never dispatched here
      throw new Error("timestral arm is async — use runTimestralArm() from ./eval")
  }
}
