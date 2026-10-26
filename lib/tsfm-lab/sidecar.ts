/* ---------------------------------------------------------------------------
 * TSFM Lab — Timestral-5M sidecar client (the REAL model arm)
 *
 * Talks to the Python inference service at :3030 (mini-services/tsfm-sidecar)
 * which loads the actual Mistral Timestral-5M weights (5.2M params, patch 32,
 * 21 quantiles) via the official library. Zero-shot: never fine-tuned here.
 *
 * Mapping onto the sidecar contract:
 *   target          → context values of the target series
 *                      (price lane: log close · vol lane: σ = exp(log RV24),
 *                       output mapped back through log — monotone, valid)
 *   pastCovariates  → past-only/categorical channels + history segments of
 *                     known-future channels (name-matched)
 *   futureCovariates→ known-future channels at T+1..T+H (name-matched; the
 *                     sidecar concatenates past+future into known_covariates)
 *   quantiles[H][21]→ sliced to the harness 7-τ grid (indices discovered
 *                     from the response, not hardcoded)
 *
 * Ablation support: shufflePast / shuffleKnown circularly rotate the
 * respective covariate block (offset 7919) — "wrong values, right
 * distribution" — the covariate-deafness test.
 * ------------------------------------------------------------------------- */

import type { SeriesData } from "./data"
import { QUANTILES, type Target } from "./design"
import { COV_KEYS, calendarNamesFor, calendarValue, isKnownFutureKey, type CovKey } from "./models"

const SIDECAR_URL = process.env.TSFM_SIDECAR_URL ?? "http://127.0.0.1:3030"
export const CONTEXT_BARS = 1024 // 32 patches — generous hourly context, ~6 weeks
const SHUFFLE_OFFSET = 7919

export interface SidecarHealth {
  ok: boolean
  model?: string
  params?: number
  taus?: number[]
  note?: string
}

let healthCache: { at: number; val: SidecarHealth } | null = null

export async function sidecarHealth(force = false): Promise<SidecarHealth> {
  if (!force && healthCache && Date.now() - healthCache.at < 30_000) return healthCache.val
  let val: SidecarHealth
  try {
    const r = await fetch(`${SIDECAR_URL}/health`, { signal: AbortSignal.timeout(4000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as { status?: string; model?: string; params?: number; taus?: number[] }
    val =
      j.status === "ok"
        ? { ok: true, model: j.model, params: j.params, taus: j.taus }
        : { ok: false, note: `sidecar status: ${j.status ?? "unknown"}` }
  } catch (e) {
    val = { ok: false, note: `sidecar unreachable on :3030 — start mini-services/tsfm-sidecar (${String(e).slice(0, 80)})` }
  }
  healthCache = { at: Date.now(), val }
  return val
}

/* ------------------------------ row builders ------------------------------ */

type Row = { name: string; vals: (number | null)[] }

const fin = (v: number): number | null => (Number.isFinite(v) ? v : null)

/** Past-only + categorical channel rows over [from..T] (context window). */
function pastOnlyRows(
  s: SeriesData,
  target: Target,
  keys: Set<CovKey>,
  from: number,
  T: number,
): Row[] {
  const n = T - from + 1
  const slice = (arr: Float64Array): (number | null)[] => {
    const out: (number | null)[] = []
    for (let i = from; i <= T; i++) out.push(fin(arr[i]))
    return out
  }
  const rows: Row[] = []
  const push = (name: string, vals: (number | null)[]) => {
    if (vals.length === n) rows.push({ name, vals })
  }
  const lag24 = (i: number) =>
    i >= 24 && Number.isFinite(s.logc[i]) && Number.isFinite(s.logc[i - 24])
      ? s.logc[i] - s.logc[i - 24]
      : NaN

  if (keys.has("rv24") && target !== "vol") push("rv24", slice(s.rv24))
  if (keys.has("rv72") && target !== "vol") push("rv72", slice(s.rv72))
  if (keys.has("atr")) push("atr", slice(s.atr))
  if (keys.has("ewma")) push("ewma", slice(s.ewma))
  if (keys.has("volz")) push("volz", slice(s.volz))
  if (keys.has("drawdown")) push("drawdown", slice(s.drawdown))
  if (keys.has("rsi")) push("rsi", slice(s.rsi))
  if (keys.has("lag_ret")) {
    push("ret_lag1", slice(s.ret1))
    const l24: (number | null)[] = []
    for (let i = from; i <= T; i++) l24.push(fin(lag24(i)))
    push("ret_lag24", l24)
  }
  if (keys.has("trend")) push("trend", slice(s.trend))
  if (keys.has("regime")) {
    const v: (number | null)[] = []
    for (let i = from; i <= T; i++) v.push(s.regime[i])
    push("regime", v)
  }
  if (keys.has("shift")) {
    const v: (number | null)[] = []
    for (let i = from; i <= T; i++) v.push(s.shifts[i] ? 1 : 0)
    push("shift", v)
  }
  return rows
}

/** History segment of the known-future channels over [from..T]. */
function calendarHistoryRows(keys: Set<CovKey>, s: SeriesData, from: number, T: number): Row[] {
  const rows: Row[] = []
  for (const key of keys) {
    if (!isKnownFutureKey(key)) continue
    for (const name of calendarNamesFor(key)) {
      const vals: (number | null)[] = []
      for (let i = from; i <= T; i++) vals.push(fin(calendarValue(name, s.bars[i].t)))
      rows.push({ name, vals })
    }
  }
  return rows
}

/** Known-future channel values over the horizon T+1..T+H. */
function calendarFutureRows(keys: Set<CovKey>, s: SeriesData, T: number, H: number): Row[] {
  const rows: Row[] = []
  for (const key of keys) {
    if (!isKnownFutureKey(key)) continue
    for (const name of calendarNamesFor(key)) {
      const vals: (number | null)[] = []
      for (let h = 1; h <= H; h++) vals.push(fin(calendarValue(name, s.bars[T].t + h * 3600_000)))
      rows.push({ name, vals })
    }
  }
  return rows
}

const rotate = (vals: (number | null)[], off: number): (number | null)[] => {
  const n = vals.length
  if (n < 2) return vals
  const k = ((off % n) + n) % n
  return [...vals.slice(n - k), ...vals.slice(0, n - k)]
}

/* --------------------------------- cache ---------------------------------- */

export type QMat = number[][] // [H][TAU.length]

const qCache = new Map<string, QMat>()
const Q_CACHE_MAX = 4000

export function covSignature(keys: Set<CovKey>): string {
  return COV_KEYS.filter((k) => keys.has(k)).join(",")
}

/* ------------------------------- main call -------------------------------- */

/** Full [H][7-τ] quantile matrix from the real Timestral-5M at origin T. */
export async function timestralQuantiles(
  s: SeriesData,
  target: Target,
  T: number,
  H: number,
  keys: Set<CovKey>,
  opts?: { shufflePast?: boolean; shuffleKnown?: boolean },
): Promise<QMat> {
  const sig = covSignature(keys)
  const mode = opts?.shufflePast ? "sp" : opts?.shuffleKnown ? "sk" : "full"
  const key = `${s.id}|${target}|${H}|${sig}|${T}|${mode}`
  const hit = qCache.get(key)
  if (hit) return hit

  const health = await sidecarHealth()
  if (!health.ok) throw new Error(health.note ?? "Timestral sidecar unavailable")

  const from = Math.max(0, T - CONTEXT_BARS + 1)
  const n = T - from + 1

  /* target context — vol lane: σ = exp(log RV24) so values are positive
     (the library clips non-negative); outputs mapped back through log. */
  const isVol = target === "vol"
  const targetVals: (number | null)[] = []
  for (let i = from; i <= T; i++) {
    const v = isVol ? Math.exp(s.rv24[i]) : s.logc[i]
    targetVals.push(fin(v))
  }

  let pastRows = [...pastOnlyRows(s, target, keys, from, T), ...calendarHistoryRows(keys, s, from, T)]
  let futureRows = calendarFutureRows(keys, s, T, H)
  if (opts?.shufflePast) {
    // rotate ONLY the past-only/categorical rows (the calendar history stays
    // aligned — the ablation targets the market-derived channels)
    const calNames = new Set(calendarHistoryRows(keys, s, from, T).map((r) => r.name))
    pastRows = pastRows.map((r) => (calNames.has(r.name) ? r : { ...r, vals: rotate(r.vals, SHUFFLE_OFFSET) }))
  }
  if (opts?.shuffleKnown) {
    futureRows = futureRows.map((r) => ({ ...r, vals: rotate(r.vals, Math.max(1, SHUFFLE_OFFSET % Math.max(2, H))) }))
  }

  const body = {
    target: targetVals,
    pastCovariates: pastRows.map((r) => r.vals),
    pastNames: pastRows.map((r) => r.name),
    futureCovariates: futureRows.length ? futureRows.map((r) => r.vals) : null,
    futureNames: futureRows.length ? futureRows.map((r) => r.name) : null,
    horizon: H,
  }

  const r = await fetch(`${SIDECAR_URL}/forecast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => "")
    throw new Error(`sidecar ${r.status}: ${txt.slice(0, 140)}`)
  }
  const j = (await r.json()) as { taus: number[]; quantiles: number[][] }
  if (!j?.quantiles?.length) throw new Error("sidecar returned no quantiles")

  /* map the model's 21-τ grid onto the harness 7-τ grid (by value lookup) */
  const taus = j.taus ?? []
  const idxOf = (τ: number): number => {
    let best = 0
    let bd = Infinity
    taus.forEach((t, i) => {
      const d = Math.abs(t - τ)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }
  const colIdx = QUANTILES.map(idxOf)
  const out: QMat = j.quantiles.map((row) => {
    const q = colIdx.map((c) => row[c])
    if (isVol) for (let k = 0; k < q.length; k++) q[k] = Math.log(Math.max(1e-12, q[k]))
    for (let k = 1; k < q.length; k++) if (q[k] < q[k - 1]) q[k] = q[k - 1]
    return q
  })

  if (qCache.size >= Q_CACHE_MAX) {
    const first = qCache.keys().next().value
    if (first) qCache.delete(first)
  }
  qCache.set(key, out)
  return out
}
