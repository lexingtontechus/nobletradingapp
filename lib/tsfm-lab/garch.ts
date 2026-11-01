/* ---------------------------------------------------------------------------
 * TSFM Lab — GARCH-family arms (the "proven methodology" challenger)
 *
 * Implements the classic volatility family as vol-lane arms, mirroring the
 * candidate set of Cho & Matteson (arXiv 2610.31621): standard GARCH(1,1),
 * GJR-GARCH(1,1) (= threshold/TGARCH) and EGARCH(1,1), order (1,1) throughout:
 *
 *   garch  σ²_t = ω + α r²_{t−1} + β σ²_{t−1}                 (normal)
 *   gjr    σ²_t = ω + (α + γ·1{r_{t−1}<0}) r²_{t−1} + β σ²_{t−1}   (Student-t)
 *   egarch lnσ²_t = ω + α(|ε_{t−1}|−m) + γ ε_{t−1} + β lnσ²_{t−1}  (Student-t)
 *
 * MLE via Nelder–Mead on the train window (models frozen at eval start —
 * same semantics as Log-HAR and the TSFM stand-in). The filter then runs
 * causally over the whole series so every origin T uses only returns ≤ T.
 * Multi-step: aggregate conditional variance V_h(T) = Σ_{j≤h} σ²_{T+j|T}
 * (EGARCH: mean-reverting log-variance recursion; GJR: α+γ/2+β persistence).
 * Quantile fan: point 0.5·log(V_h/h) + EMPIRICAL residual quantiles over the
 * train window — the same calibration-honest convention as every other arm
 * (residuals are approximately pivotal: 0.5·log(Σr²/V_h) is a function of the
 * standardized innovations only, so the empirical quantiles absorb the
 * χ²-aggregation skew and any innovation-tail misspecification).
 *
 * Returns are rescaled to unit variance for the fit (ω would otherwise live
 * at ~1e-8 and starve the optimizer); all outputs convert back to original
 * units. Missing bars (FX weekends) carry the state forward with no
 * likelihood contribution.
 *
 * Ported verbatim from the TSFM measurement lab (src/lib/tsfm/garch.ts) —
 * the module's only dependencies are FeatureCtx / TAU / equant / QVec from
 * ./models, which this repo's port exports with identical signatures.
 * ------------------------------------------------------------------------- */

import type { FeatureCtx } from "./models"
import { TAU, equant, type QVec } from "./models"

export type GarchSpec = "garch" | "gjr" | "egarch"

export interface GarchFit {
  spec: GarchSpec
  dist: "normal" | "t"
  /** parameters in SCALED return space (r' = r/s0) */
  omega: number
  alpha: number
  gamma: number // GJR threshold / EGARCH sign asymmetry
  beta: number
  nu: number // t df (Infinity for normal)
  /** E|ε| of the unit-variance innovation (EGARCH centering) */
  absMean: number
  /** Var[r_t | past], bar-aligned, ORIGINAL units (state carried over gaps) */
  sigma2: Float64Array
  logLik: number
  nObs: number
  aic: number
  s0: number
  converged: boolean
}

/* ------------------------------ math utilities ----------------------------- */

/** ln Γ(x) — Lanczos approximation (g=7, 9 coefficients). */
function lnGamma(x: number): number {
  const C = [
    0.99999999999980993, 676.5203621218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  x -= 1
  let a = C[0]
  const t = x + 7 + 0.5
  for (let i = 1; i < 9; i++) a += C[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

const sigmoid = (u: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, u))))

/** Unit-variance scale of a Student-t(ν) innovation. */
const tScale = (nu: number) => Math.sqrt(Math.max(1e-9, (nu - 2) / nu))

/** E|ε| for the unit-variance standardized t (→ √(2/π) as ν→∞). */
function tAbsMean(nu: number): number {
  const m =
    (2 * Math.sqrt(nu) * Math.exp(lnGamma((nu + 1) / 2) - lnGamma(nu / 2))) /
    (Math.sqrt(Math.PI) * (nu - 1))
  return tScale(nu) * m
}

/** log density of standard Student-t(ν). */
function tLogDensity(x: number, nu: number): number {
  return (
    lnGamma((nu + 1) / 2) -
    lnGamma(nu / 2) -
    0.5 * Math.log(nu * Math.PI) -
    ((nu + 1) / 2) * Math.log(1 + (x * x) / nu)
  )
}

/* ------------------------------ Nelder–Mead -------------------------------- */

interface NMResult {
  x: number[]
  fx: number
  iterations: number
  converged: boolean
}

function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  maxIter = 900,
  ftol = 1e-10,
): NMResult {
  const d = x0.length
  const step = x0.map((v) => Math.max(0.12 * Math.abs(v), 0.08))
  // initial simplex
  const pts: number[][] = [x0.slice()]
  for (let i = 0; i < d; i++) {
    const p = x0.slice()
    p[i] += step[i]
    pts.push(p)
  }
  let vals = pts.map(f)
  let iter = 0
  let converged = false
  for (; iter < maxIter; iter++) {
    // sort ascending by value
    const order = pts.map((_, i) => i).sort((a, b) => vals[a] - vals[b])
    const P = order.map((i) => pts[i])
    const V = order.map((i) => vals[i])
    if (Math.abs(V[d] - V[0]) < ftol * (Math.abs(V[0]) + ftol)) {
      converged = true
      pts.length = 0
      pts.push(...P)
      vals = V.slice()
      break
    }
    // centroid of best d
    const cen = new Array<number>(d).fill(0)
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cen[j] += P[i][j]
    for (let j = 0; j < d; j++) cen[j] /= d
    const worst = P[d]
    const reflect = cen.map((c, j) => c + (c - worst[j]))
    const fr = f(reflect)
    if (fr < V[0]) {
      const expand = cen.map((c, j) => c + 2 * (c - worst[j]))
      const fe = f(expand)
      if (fe < fr) {
        pts.length = 0
        pts.push(...P.slice(0, d), expand)
        vals = [...V.slice(0, d), fe]
      } else {
        pts.length = 0
        pts.push(...P.slice(0, d), reflect)
        vals = [...V.slice(0, d), fr]
      }
    } else if (fr < V[d - 1]) {
      pts.length = 0
      pts.push(...P.slice(0, d), reflect)
      vals = [...V.slice(0, d), fr]
    } else {
      // contract
      const contract = cen.map((c, j) => c + 0.5 * (worst[j] - c))
      const fc = f(contract)
      if (fc < V[d]) {
        pts.length = 0
        pts.push(...P.slice(0, d), contract)
        vals = [...V.slice(0, d), fc]
      } else {
        // shrink toward best
        pts.length = 0
        vals = []
        pts.push(P[0].slice())
        vals.push(V[0])
        for (let i = 1; i <= d; i++) {
          const p = P[0].map((b, j) => b + 0.5 * (P[i][j] - b))
          pts.push(p)
          vals.push(f(p))
        }
      }
    }
  }
  const bi = vals.indexOf(Math.min(...vals))
  return { x: pts[bi], fx: vals[bi], iterations: iter, converged }
}

/* ------------------------------- the filter -------------------------------- */

interface FilterOut {
  sigma2: Float64Array // scaled units, bar-aligned: Var[r'_t | past]
  ll: number
  nobs: number
  ok: boolean
}

interface UnpackedParams {
  omega: number
  alpha: number
  gamma: number
  beta: number
  nu: number
  hard: number
  soft: number
}

function unpack(spec: GarchSpec, u: number[]): UnpackedParams {
  let omega: number, alpha: number, gamma: number, beta: number, nu: number
  let hard = 0
  let soft = 0
  if (spec === "garch") {
    omega = Math.exp(Math.max(-20, Math.min(4, u[0])))
    alpha = Math.exp(Math.max(-14, Math.min(0, u[1])))
    beta = 0.9995 * sigmoid(u[2])
    gamma = 0
    nu = Infinity
    if (![omega, alpha, beta].every(Number.isFinite)) hard = 1
    const p = alpha + beta
    if (p > 0.9985) soft += 1e7 * (p - 0.9985) ** 2
  } else if (spec === "gjr") {
    omega = Math.exp(Math.max(-20, Math.min(4, u[0])))
    alpha = Math.exp(Math.max(-14, Math.min(0, u[1])))
    gamma = Math.exp(Math.max(-14, Math.min(0, u[2])))
    beta = 0.9995 * sigmoid(u[3])
    nu = 2.5 + 200 * sigmoid(u[4])
    if (![omega, alpha, gamma, beta, nu].every(Number.isFinite)) hard = 1
    const p = alpha + gamma / 2 + beta
    if (p > 0.9985) soft += 1e7 * (p - 0.9985) ** 2
  } else {
    omega = u[0]
    alpha = u[1]
    gamma = u[2]
    beta = 0.9995 * Math.tanh(u[3])
    nu = 2.5 + 200 * sigmoid(u[4])
    if (![omega, alpha, gamma, beta, nu].every(Number.isFinite)) hard = 1
    if (Math.abs(alpha) > 2 || Math.abs(gamma) > 2 || Math.abs(omega) > 5) hard = 1
  }
  return { omega, alpha, gamma, beta, nu, hard, soft }
}

/** One causal filter pass over the FULL bar-aligned scaled return series. */
function filterPass(
  spec: GarchSpec,
  p: UnpackedParams,
  r: Float64Array, // scaled, NaN = missing bar
  trainStart: number,
  trainEnd: number,
): FilterOut {
  const n = r.length
  const sigma2 = new Float64Array(n)
  const isT = spec !== "garch"
  const c = isT ? tScale(p.nu) : 1
  const m = isT ? tAbsMean(p.nu) : Math.sqrt(2 / Math.PI)
  let s2 = 1 // Var of scaled train returns ≈ 1 by construction
  let ll = 0
  let nobs = 0
  const LOG2PI = Math.log(2 * Math.PI)
  for (let t = 0; t < n; t++) {
    sigma2[t] = s2
    const rt = r[t]
    if (!Number.isFinite(rt)) continue // gap: state carried, no likelihood
    // likelihood of r_t under σ²_t (train window only)
    if (t >= trainStart && t < trainEnd) {
      if (!(s2 > 1e-16) || !Number.isFinite(s2)) return { sigma2, ll: -Infinity, nobs, ok: false }
      const sd = Math.sqrt(s2)
      if (isT) {
        const z = rt / (sd * c)
        ll += -Math.log(sd) - Math.log(c) + tLogDensity(z, p.nu)
      } else {
        ll += -0.5 * (LOG2PI + Math.log(s2) + (rt * rt) / s2)
      }
      nobs++
    }
    // update state for t+1
    if (spec === "garch" || spec === "gjr") {
      const neg = rt < 0 ? 1 : 0
      s2 =
        p.omega +
        (p.alpha + (spec === "gjr" ? p.gamma * neg : 0)) * rt * rt +
        p.beta * s2
      if (!(s2 > 0) || !Number.isFinite(s2)) return { sigma2, ll: -Infinity, nobs, ok: false }
      if (s2 > 1e6) return { sigma2, ll: -Infinity, nobs, ok: false }
    } else {
      const z = rt / Math.sqrt(s2)
      const ls = Math.log(s2)
      const next =
        p.omega + p.alpha * (Math.abs(z) - m) + p.gamma * z + p.beta * ls
      if (!Number.isFinite(next) || Math.abs(next) > 25)
        return { sigma2, ll: -Infinity, nobs, ok: false }
      s2 = Math.exp(next)
    }
  }
  return { sigma2, ll, nobs, ok: true }
}

/* --------------------------------- the fit --------------------------------- */

const fitCache = new Map<string, GarchFit>()

function initialU(spec: GarchSpec, var1: number): number[][] {
  // operate in scaled space where unconditional var ≈ 1; multi-start guards
  // local optima (e.g. GJR pegging γ at the stability boundary)
  const logit = (b: number) => Math.log(b / (1 - b))
  if (spec === "garch") {
    const mk = (a: number, b: number) =>
      [Math.log(Math.max(1e-6, (1 - a - b) * var1)), Math.log(a), logit(Math.min(0.999, b))].slice()
    return [mk(0.08, 0.9), mk(0.15, 0.8), mk(0.03, 0.96)]
  }
  if (spec === "gjr") {
    const mk = (a: number, g: number, b: number) =>
      [
        Math.log(Math.max(1e-6, (1 - a - g / 2 - b) * var1)),
        Math.log(a),
        Math.log(g),
        logit(Math.min(0.999, b)),
        0.1,
      ].slice()
    return [mk(0.05, 0.05, 0.88), mk(0.1, 0.15, 0.8), mk(0.02, 0.02, 0.95)]
  }
  const mk = (a: number, g: number, b: number) => [-0.02, a, g, Math.atanh(b), 0.1].slice()
  return [mk(0.12, -0.06, 0.98), mk(0.25, -0.1, 0.95), mk(0.08, -0.03, 0.995)]
}

export function fitGarchFamily(
  seriesId: string,
  ret1: Float64Array,
  trainStart: number,
  trainEnd: number,
  spec: GarchSpec,
): GarchFit {
  const key = `${seriesId}|${spec}`
  const hit = fitCache.get(key)
  if (hit) return hit

  // scale: std of finite train returns
  let sum = 0,
    cnt = 0
  for (let t = trainStart; t < trainEnd; t++) {
    const v = ret1[t]
    if (Number.isFinite(v)) {
      sum += v
      cnt++
    }
  }
  const mean = cnt > 0 ? sum / cnt : 0
  let vs = 0
  for (let t = trainStart; t < trainEnd; t++) {
    const v = ret1[t]
    if (Number.isFinite(v)) vs += (v - mean) ** 2
  }
  const s0 = Math.sqrt(Math.max(1e-12, vs / Math.max(1, cnt - 1)))
  const r = new Float64Array(ret1.length)
  for (let t = 0; t < ret1.length; t++) {
    const v = ret1[t]
    r[t] = Number.isFinite(v) ? (v - mean) / s0 : NaN
  }
  // recompute scaled variance (≈1, used only for init)
  let v1 = 0
  for (let t = trainStart; t < trainEnd; t++) if (Number.isFinite(r[t])) v1 += r[t] * r[t]
  v1 /= Math.max(1, cnt - 1)

  const nll = (u: number[]): number => {
    const p = unpack(spec, u)
    if (p.hard > 0) return 1e12
    const out = filterPass(spec, p, r, trainStart, trainEnd)
    if (!out.ok || !Number.isFinite(out.ll)) return 1e12
    return -out.ll + p.soft
  }

  let best: NMResult | null = null
  for (const u0 of initialU(spec, v1)) {
    let cand = nelderMead(nll, u0)
    const restart = nelderMead(nll, cand.x)
    if (restart.fx < cand.fx) cand = restart
    if (!best || cand.fx < best.fx) best = cand
  }

  const p = unpack(spec, best ? best.x : initialU(spec, v1)[0])
  const out = filterPass(spec, p, r, trainStart, trainEnd)
  const k = spec === "garch" ? 3 : 5
  const dist: "normal" | "t" = spec === "garch" ? "normal" : "t"
  const fit: GarchFit = {
    spec,
    dist,
    omega: p.omega,
    alpha: p.alpha,
    gamma: p.gamma,
    beta: p.beta,
    nu: p.nu,
    absMean: dist === "t" ? tAbsMean(p.nu) : Math.sqrt(2 / Math.PI),
    sigma2: new Float64Array(out.sigma2.length),
    logLik: out.ll,
    nObs: out.nobs,
    aic: -2 * out.ll + 2 * k,
    s0,
    converged: best ? best.converged : false,
  }
  // convert the filtered variance path back to ORIGINAL units
  const s02 = s0 * s0
  for (let t = 0; t < out.sigma2.length; t++) fit.sigma2[t] = out.sigma2[t] * s02
  fitCache.set(key, fit)
  return fit
}

/* ---------------------------- multi-step forecast -------------------------- */

/** Conditional variance of bar T+j given info at T (scaled space), j = 1..h. */
function variancePathScaled(fit: GarchFit, T: number, h: number): Float64Array {
  const n = fit.sigma2.length
  const out = new Float64Array(h)
  // σ²_{T+1|T}: the filter's own next-bar variance (uses the actual r_T state)
  const s1 =
    fit.sigma2[Math.min(T + 1, n - 1)] / (fit.s0 * fit.s0)
  out[0] = s1
  if (fit.spec === "egarch") {
    let ls = Math.log(Math.max(1e-16, s1))
    for (let j = 2; j <= h; j++) {
      ls = fit.omega + fit.beta * ls
      out[j - 1] = Math.exp(Math.max(-25, Math.min(25, ls)))
    }
  } else {
    const pers =
      fit.spec === "gjr" ? fit.alpha + fit.gamma / 2 + fit.beta : fit.alpha + fit.beta
    let s2 = s1
    for (let j = 2; j <= h; j++) {
      s2 = fit.omega + pers * s2
      out[j - 1] = Math.min(1e8, s2)
    }
  }
  return out
}

/** Aggregate conditional variance of bars T+1..T+h, ORIGINAL units. */
export function aggregateVariance(fit: GarchFit, T: number, h: number): number {
  const path = variancePathScaled(fit, T, h)
  let v = 0
  const s02 = fit.s0 * fit.s0
  for (let j = 0; j < h; j++) v += path[j]
  return v * s02
}

/* ------------------------- quantile arm + residuals ------------------------ */

const residQCache = new Map<string, QVec>()

/** Empirical residual quantiles for (series, spec, h) over the train window. */
function residualQuantiles(ctx: FeatureCtx, fit: GarchFit, h: number): QVec {
  const key = `${ctx.s.id}|${fit.spec}|${h}`
  const hit = residQCache.get(key)
  if (hit) return hit
  const { trainStart, trainEnd, y } = ctx
  const resid: number[] = []
  for (let t = trainStart; t + h < trainEnd; t++) {
    const yv = y(t, h)
    if (!Number.isFinite(yv)) continue
    const V = aggregateVariance(fit, t, h)
    resid.push(yv - 0.5 * Math.log(Math.max(1e-18, V / h)))
  }
  resid.sort((a, b) => a - b)
  const q: QVec = TAU.map((τ) => equant(resid, τ))
  residQCache.set(key, q)
  return q
}

/** The GARCH-family quantile arm: respects (T, h) — the fan widens with h. */
export function garchQuantiles(
  ctx: FeatureCtx,
  fit: GarchFit,
  T: number,
  h: number,
): QVec {
  const V = aggregateVariance(fit, T, h)
  const point = 0.5 * Math.log(Math.max(1e-18, V / h))
  const rq = residualQuantiles(ctx, fit, h)
  const out = rq.map((z) => point + z)
  for (let k = 1; k < out.length; k++) if (out[k] < out[k - 1]) out[k] = out[k - 1]
  return out
}

/** Bind a fitted GARCH-family arm for a series context. */
export function garchArm(
  spec: GarchSpec,
  ctx: FeatureCtx,
): (T: number, h: number) => QVec {
  const fit = fitGarchFamily(ctx.s.id, ctx.s.ret1, ctx.trainStart, ctx.trainEnd, spec)
  return (T, h) => garchQuantiles(ctx, fit, T, h)
}
