/* ---------------------------------------------------------------------------
 * TSFM Lab — data layer (R2: financial-only)
 *
 * Loads the 5 REAL hourly OHLCV CSVs (TDVA/TradingView — the live sweep's own
 * feed, 5000 bars ≈ 208 days per symbol) and derives every covariate in the
 * financial taxonomy: realized vol (multi-scale), EWMA vol, ATR, volume z,
 * drawdown, RSI, trend, regime, CUSUM shift marks. The weather/power control of
 * R1 is retired.
 * ------------------------------------------------------------------------- */

import { promises as fs } from "fs"
import path from "path"
import { EVAL } from "./design"

export interface Bar {
  t: number // epoch ms
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface SeriesData {
  id: string
  kind: "crypto" | "forex" | "metal"
  bars: Bar[]
  // derived (bar-aligned, length = bars.length)
  logc: Float64Array // log close
  ret1: Float64Array // hourly log return (NaN for first bar)
  rv24: Float64Array // log std of last 24 returns (past covariate)
  rv72: Float64Array // log std of last 72 returns
  ewma: Float64Array // log EWMA(λ=0.94) σ — RiskMetrics vol channel
  atr: Float64Array // log ATR(14)/close
  volz: Float64Array // 720h z-score of log1p(volume)
  drawdown: Float64Array // logc − trailing 480h max
  rsi: Float64Array // Wilder RSI(14), re-centered to ±0.5
  trend: Float64Array // 168h rolling OLS slope of log close
  regime: Uint8Array // 0 bear / 1 neutral / 2 bull (trend-based proxy)
  shifts: boolean[] // CUSUM level-shift marks
}

const DATA_DIR = path.join(process.cwd(), "data", "tsfm")

/** R2 datastore — the lab's production price source. When TSFM_R2_URL is set the
 *  5 TDVA CSVs are fetched from the bucket instead of the local data/tsfm copy
 *  (same cached-CSV convention, so nothing downstream changes). Public r2.dev
 *  hostname or an S3-compatible base both work; unset → local files. */
const R2_URL = process.env.TSFM_R2_URL?.replace(/\/+$/, "") ?? ""
const R2_PREFIX = process.env.TSFM_R2_PREFIX?.replace(/^\/+|\/+$/g, "") ?? "tsfm"
const R2_TTL_MS = Number(process.env.TSFM_R2_TTL_MS ?? 300_000)
/** When R2 is unreachable, fall back to the local data/tsfm copy (the same TDVA
 *  bars) rather than failing the whole lab — set TSFM_R2_FALLBACK=0 to make R2
 *  authoritative and fail loudly instead. */
const R2_FALLBACK = process.env.TSFM_R2_FALLBACK !== "0"

const r2Cache = new Map<string, { at: number; text: string }>()

async function readSource(file: string): Promise<string> {
  const local = () => fs.readFile(path.join(DATA_DIR, file), "utf-8")
  if (!R2_URL) return local()
  const key = `${R2_PREFIX}/${file}`
  const hit = r2Cache.get(key)
  if (hit && Date.now() - hit.at < R2_TTL_MS) return hit.text
  try {
    const res = await fetch(`${R2_URL}/${key}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    r2Cache.set(key, { at: Date.now(), text })
    return text
  } catch (e) {
    if (!R2_FALLBACK) throw new Error(`R2 ${key}: ${String(e).slice(0, 120)}`)
    console.warn(`[tsfm-lab] R2 ${key} unavailable (${String(e).slice(0, 80)}) — using local data/tsfm copy`)
    return local()
  }
}

const FINANCE_FILES: Record<string, string> = {
  BTCUSD: "BTCUSD.csv",
  USDJPY: "USDJPY.csv",
  USDCHF: "USDCHF.csv",
  XAUUSD: "XAUUSD.csv",
  XAGUSD: "XAGUSD.csv",
}

/* ------------------------------ CSV parsing ------------------------------- */

async function parseCsv(file: string): Promise<Bar[]> {
  const raw = await readSource(file)
  const lines = raw.split("\n")
  const bars: Bar[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue
    const cols = line.split(",")
    if (cols.length < 6) continue
    const t = Date.parse(cols[0])
    if (!Number.isFinite(t)) continue
    const o = Number(cols[1])
    const h = Number(cols[2])
    const l = Number(cols[3])
    const c = Number(cols[4])
    const v = Number(cols[5])
    if (!Number.isFinite(c) || c <= 0) continue
    bars.push({
      t,
      o: Number.isFinite(o) ? o : c,
      h: Number.isFinite(h) ? h : c,
      l: Number.isFinite(l) ? l : c,
      c,
      v: Number.isFinite(v) ? v : 0,
    })
  }
  bars.sort((a, b) => a.t - b.t)
  return bars
}

/* ------------------------ financial channel derivation -------------------- */

/** EWMA(λ=0.94) log σ — RiskMetrics vol channel. */
function ewmaVol(ret1: Float64Array): Float64Array {
  const n = ret1.length
  const out = new Float64Array(n).fill(NaN)
  const λ = 0.94
  let v = NaN
  for (let i = 0; i < n; i++) {
    const r = ret1[i]
    if (!Number.isFinite(r)) continue
    v = Number.isFinite(v) ? λ * v + (1 - λ) * r * r : r * r
    out[i] = 0.5 * Math.log(Math.max(1e-18, v))
  }
  return out
}

/** 720h rolling z-score of log1p(volume). */
function volumeZ(bars: Bar[], w = 720): Float64Array {
  const n = bars.length
  const out = new Float64Array(n).fill(NaN)
  const lv = new Float64Array(n)
  for (let i = 0; i < n; i++)
    lv[i] = bars[i].v > 0 ? Math.log1p(bars[i].v) : NaN
  let sum = 0
  let sumSq = 0
  let cnt = 0
  const dq: number[] = []
  const dq2: number[] = []
  for (let i = 0; i < n; i++) {
    const v = lv[i]
    if (Number.isFinite(v)) {
      dq.push(v)
      dq2.push(v * v)
      sum += v
      sumSq += v * v
      cnt++
      if (cnt > w) {
        sum -= dq.shift()!
        sumSq -= dq2.shift()!
        cnt--
      }
    }
    if (cnt >= 48) {
      const mean = sum / cnt
      const sd = Math.sqrt(Math.max(1e-12, (sumSq - (sum * sum) / cnt) / (cnt - 1)))
      out[i] = Number.isFinite(v) ? (v - mean) / sd : NaN
    }
  }
  return out
}

/** Drawdown from the trailing 480h high, in log space. */
function drawdown(logc: Float64Array, w = 480): Float64Array {
  const n = logc.length
  const out = new Float64Array(n).fill(NaN)
  // monotonic deque of candidate highs (indices, decreasing values)
  const idx: number[] = []
  const val: number[] = []
  for (let i = 0; i < n; i++) {
    const y = logc[i]
    if (!Number.isFinite(y)) continue
    while (val.length && val[val.length - 1] <= y) {
      idx.pop()
      val.pop()
    }
    idx.push(i)
    val.push(y)
    while (idx.length && idx[0] <= i - w) {
      idx.shift()
      val.shift()
    }
    if (i >= w) out[i] = y - val[0]
  }
  return out
}

/** Wilder RSI(14), re-centered to ±0.5. */
function rsiWilder(logc: Float64Array, w = 14): Float64Array {
  const n = logc.length
  const out = new Float64Array(n).fill(NaN)
  let avgG = NaN
  let avgL = NaN
  for (let i = 1; i < n; i++) {
    const d = logc[i] - logc[i - 1]
    if (!Number.isFinite(d)) continue
    const g = Math.max(0, d)
    const l = Math.max(0, -d)
    if (!Number.isFinite(avgG)) {
      avgG = g
      avgL = l
    } else {
      avgG = (avgG * (w - 1) + g) / w
      avgL = (avgL * (w - 1) + l) / w
    }
    if (i >= w + 1) {
      const rs = avgL < 1e-12 ? 100 : avgG / avgL
      out[i] = 100 / (1 + rs) / 100 - 0.5 // (RSI−50)/50
    }
  }
  return out
}



/* ----------------------------- feature derivation -------------------------- */

function rollingStd(x: Float64Array, w: number): Float64Array {
  const out = new Float64Array(x.length).fill(NaN)
  let sum = 0,
    sumSq = 0,
    cnt = 0
  const dq: number[] = []
  const q: number[] = []
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (Number.isFinite(v)) {
      dq.push(v)
      q.push(v * v)
      sum += v
      sumSq += v * v
      cnt++
      if (cnt > w) {
        const rv = dq.shift()!
        const rq = q.shift()!
        sum -= rv
        sumSq -= rq
        cnt--
      }
    }
    if (cnt >= Math.min(w, 24)) {
      const varr = Math.max(1e-18, (sumSq - (sum * sum) / cnt) / (cnt - 1))
      out[i] = 0.5 * Math.log(varr) // log std
    }
  }
  return out
}

function rollingAtr(bars: Bar[], w: number): Float64Array {
  const n = bars.length
  const out = new Float64Array(n).fill(NaN)
  const tr: number[] = []
  let sum = 0
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? bars[i - 1].c : bars[i].c
    const t = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - prev),
      Math.abs(bars[i].l - prev),
    )
    tr.push(t)
    sum += t
    if (tr.length > w) sum -= tr.shift()!
    if (tr.length === w) out[i] = Math.log((sum / w) / bars[i].c)
  }
  return out
}

/** 168h rolling OLS slope of log close (incremental sliding regression). */
function rollingTrend(logc: Float64Array, w: number): Float64Array {
  const n = logc.length
  const out = new Float64Array(n).fill(NaN)
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0
  const ys: number[] = []
  const xs: number[] = [] // x-indices of the window (NaN gaps must not desync them)
  for (let i = 0; i < n; i++) {
    const y = logc[i]
    if (!Number.isFinite(y)) continue
    const x = i
    ys.push(y)
    xs.push(x)
    sx += x
    sy += y
    sxy += x * y
    sxx += x * x
    if (ys.length > w) {
      const rx = xs.shift()!
      const ry = ys.shift()!
      sx -= rx
      sy -= ry
      sxy -= rx * ry
      sxx -= rx * rx
    }
    if (ys.length === w) {
      const denom = w * sxx - sx * sx
      if (denom > 1e-12) out[i] = (w * sxy - sx * sy) / denom
    }
  }
  return out
}

/** 3-state regime label from the 168h slope. Threshold eps = half the IQR
 *  of the slope over the FROZEN TRAIN window only (the eval protocol's split —
 *  no look-ahead): bull/bear = slope in the outer train quartiles, else
 *  neutral. With too little train-side slope data the label degrades to
 *  all-neutral rather than to a sign test on noise. */
function deriveRegime(trend: Float64Array, trainEnd: number): { regime: Uint8Array; eps: number } {
  const n = trend.length
  const regime = new Uint8Array(n)
  const finite: number[] = []
  for (let i = 0; i <= Math.min(trainEnd, n - 1); i++)
    if (Number.isFinite(trend[i])) finite.push(trend[i])
  finite.sort((a, b) => a - b)
  const q = (p: number) => finite[Math.floor(p * (finite.length - 1))]
  const eps = finite.length > 480 ? Math.max(1e-9, 0.5 * (q(0.75) - q(0.25))) : Infinity
  for (let i = 0; i < n; i++) {
    const t = trend[i]
    regime[i] = !Number.isFinite(t) ? 1 : t > eps ? 2 : t < -eps ? 0 : 1
  }
  return { regime, eps }
}

/** CUSUM level-shift detection on log close around a slow rolling mean. */
function detectShifts(logc: Float64Array): boolean[] {
  const n = logc.length
  const out = new Array<boolean>(n).fill(false)
  const w = 720
  let cusumPos = 0,
    cusumNeg = 0
  const buf: number[] = []
  let mean = 0
  let drift = 0
  const hist: number[] = []
  for (let i = 0; i < n; i++) {
    const y = logc[i]
    if (!Number.isFinite(y)) continue
    buf.push(y)
    mean += y
    if (buf.length > w) mean -= buf.shift()!
    if (buf.length < 48) continue
    const mu = mean / buf.length
    if (hist.length > 6) {
      const sd =
        Math.sqrt(
          hist.slice(-504).reduce((s, v) => s + (v - mu) * (v - mu), 0) /
            Math.min(504, hist.length),
        ) || 1e-6
      drift = 0.02 * sd
      cusumPos = Math.max(0, cusumPos + (y - mu) - drift)
      cusumNeg = Math.min(0, cusumNeg + (y - mu) + drift)
      const thresh = 18 * sd
      if (cusumPos > thresh || cusumNeg < -thresh) {
        out[i] = true
        cusumPos = 0
        cusumNeg = 0
      }
    }
    hist.push(y - mu)
  }
  return out
}

function derive(bars: Bar[], kind: SeriesData["kind"], id: string): SeriesData {
  const n = bars.length
  const logc = new Float64Array(n)
  const ret1 = new Float64Array(n).fill(NaN)
  for (let i = 0; i < n; i++) logc[i] = Math.log(bars[i].c)
  for (let i = 1; i < n; i++) ret1[i] = logc[i] - logc[i - 1]
  const rv24 = rollingStd(ret1, 24)
  const rv72 = rollingStd(ret1, 72)
  const ewma = ewmaVol(ret1)
  const atr = rollingAtr(bars, 14)
  const volz = volumeZ(bars)
  const dd = drawdown(logc)
  const rsi = rsiWilder(logc)
  const trend = rollingTrend(logc, 168)
  // threshold calibrated on the train segment only (EVAL split: final 90 days
  // are held out as rolling origins, plus the max-horizon embargo)
  const trainEnd = n - EVAL.originDays * 24 - EVAL.embargoBars
  const { regime } = deriveRegime(trend, trainEnd)
  const shifts = detectShifts(logc)
  return {
    id,
    kind,
    bars,
    logc,
    ret1,
    rv24,
    rv72,
    ewma,
    atr,
    volz,
    drawdown: dd,
    rsi,
    trend,
    regime,
    shifts,
  }
}

/* --------------------------------- loader ---------------------------------- */

const seriesCache = new Map<string, SeriesData>()

async function loadOne(id: string): Promise<SeriesData> {
  const file = FINANCE_FILES[id]
  if (!file) throw new Error(`unknown series ${id}`)
  const bars = await parseCsv(file)
  const kind = id === "BTCUSD" ? "crypto" : id.startsWith("X") ? "metal" : "forex"
  return derive(bars, kind as SeriesData["kind"], id)
}

export async function getSeries(id: string): Promise<SeriesData> {
  let entry = seriesCache.get(id)
  if (!entry) {
    entry = await loadOne(id)
    seriesCache.set(id, entry)
  }
  return entry
}

export const SERIES_IDS = ["BTCUSD", "USDJPY", "USDCHF", "XAUUSD", "XAGUSD"]
