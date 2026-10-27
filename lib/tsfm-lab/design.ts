/* ---------------------------------------------------------------------------
 * TSFM Probabilistic Forecast Lab — design constants & shared types
 *
 * Single source of truth for the experimental design: quantile grid,
 * financial covariate taxonomy (target / past-only / known-future /
 * categorical), forecast windows, eval protocol, and the model arms.
 * The design doc (download/TSFM_TRAINING_MODEL_DESIGN.md) mirrors these.
 *
 * Revision R2 (Timestral edition):
 *  - The REAL foundation-model arm is Mistral Timestral-5M (5.2M params,
 *    patch 32, 21 quantiles, past-only + known-future covariate support),
 *    served by the Python sidecar on :3030 (mini-services/tsfm-sidecar).
 *  - The weather/power control is RETIRED — every series is real financial
 *    data (5 broker CSVs, hourly, 2024-10 → 2026-10).
 *  - Covariates are the financial channels the user asked to have defined:
 *    ATR, realized/EWMA VOL, volume z, drawdown, RSI, regime, trend, shift
 *    (all past-only or categorical) vs calendar/session/event flags
 *    (known-future). Roles are task-relative: RV is a covariate in the
 *    price lane and the target in the vol lane.
 * ------------------------------------------------------------------------- */

export const QUANTILES = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95] as const
export type Quantile = (typeof QUANTILES)[number]

/** Interval chips: (lo, hi) pairs of the quantile grid. */
export const INTERVALS: { label: string; lo: number; hi: number }[] = [
  { label: "50%", lo: 0.25, hi: 0.75 },
  { label: "80%", lo: 0.1, hi: 0.9 },
  { label: "90%", lo: 0.05, hi: 0.95 },
]

/** Forecast windows (bars/hours ahead). 1 = next bar ("next tick" at 1h). */
export const HORIZONS = [1, 6, 24, 72] as const
export type Horizon = (typeof HORIZONS)[number]

/** Probabilistic targets (the design's task lanes). */
export const TARGETS = ["price", "vol", "direction"] as const
export type Target = (typeof TARGETS)[number]

export const TARGET_META: Record<
  Target,
  { label: string; short: string; unit: string; blurb: string }
> = {
  price: {
    label: "Price level — T2/T3 lane",
    short: "Price",
    unit: "price",
    blurb:
      "T2 (multi-step return) + T3 (level): median path + quantile fan of log close, H bars ahead. The bar to beat is the random walk (naive) — in finance climatology IS the random-walk null.",
  },
  vol: {
    label: "Realized vol (log RV) — T4 lane",
    short: "Realized vol",
    unit: "log RV",
    blurb:
      "T4: H-hour realized volatility from hourly log-returns. The one lane where the weather intuition transfers — vol clusters and has intraday seasonality. Bars: Log-HAR (the Phase-0 winner) and the GARCH family — GARCH(1,1), GJR-t (TGARCH), EGARCH-t — the proven-methodology challengers.",
  },
  direction: {
    label: "Direction (P(up)) — T5 lane",
    short: "Direction",
    unit: "probability",
    blurb:
      "T5 (tail/direction): P(close_{T+H} > close_T) read off the fan's monotone CDF. Bar to beat: coin flip (Brier 0.25). Next-tick T1 on 1m bars is out of scope of this hourly build.",
  },
}

/* ------------------------------- series ---------------------------------- */

export type SeriesId = "BTCUSD" | "USDJPY" | "USDCHF" | "XAUUSD" | "XAGUSD"

/** Display currency per symbol — TDVA ids end in the quote currency. */
export const CCY_SYMBOL: Record<SeriesId, string> = {
  BTCUSD: "$",
  USDJPY: "¥",
  USDCHF: "CHF ",
  XAUUSD: "$",
  XAGUSD: "$",
}

export interface SeriesMeta {
  id: SeriesId
  label: string
  kind: "crypto" | "forex" | "metal"
  rows: number
  start: string
  end: string
  coverage: string
  lastClose: number
  note: string
}

/* ----------------------------- covariates -------------------------------- */

export type CovClass = "target" | "past" | "known-future" | "categorical"

export interface CovariateSpec {
  key: string
  label: string
  cls: CovClass
  desc: string
}

/**
 * The financial covariate taxonomy, with the membership test baked into each
 * description: past-only = "computable at T, unknowable beyond"; known-future
 * = "writable for every future timestamp today, zero uncertainty"; target =
 * the series being forecast. Roles are task-relative (rv24 is a covariate in
 * the price lane, part of the target's own memory in the vol lane).
 */
export const COVARIATES: CovariateSpec[] = [
  {
    key: "target_lag",
    label: "Target series",
    cls: "target",
    desc: "The series being forecast (log close / log RV). 2048-bar context is the real Timestral-5M input; lags {0,1,24} feed the ridge stand-in. Always on.",
  },
  {
    key: "rv24",
    label: "Realized vol 24h (RV)",
    cls: "past",
    desc: "log std of the last 24 hourly returns. Computable at T, unknowable at T+1 — past-only. In the vol lane it is the target's own lag (locked).",
  },
  {
    key: "rv72",
    label: "Realized vol 72h",
    cls: "past",
    desc: "log std of last 72 hourly returns — the HAR weekly term. Past-only.",
  },
  {
    key: "atr",
    label: "ATR(14) / price",
    cls: "past",
    desc: "Normalized true-range average from past OHLC. The user's question answered: yes — ATR is a PAST-ONLY covariate, not a multivariate.",
  },
  {
    key: "ewma",
    label: "EWMA vol (λ=0.94)",
    cls: "past",
    desc: "RiskMetrics exponentially-weighted log σ. Past-only — the classic vol-clustering channel.",
  },
  {
    key: "volz",
    label: "Volume z-score (720h)",
    cls: "past",
    desc: "z-score of log1p(volume) over the trailing 720h. Future volume is unknowable — past-only.",
  },
  {
    key: "drawdown",
    label: "Drawdown (480h high)",
    cls: "past",
    desc: "log close − trailing 480h max. Past-only state of the trend/shift family.",
  },
  {
    key: "rsi",
    label: "RSI(14)",
    cls: "past",
    desc: "Wilder RSI re-centered to ±0.5. Momentum-family past-only channel.",
  },
  {
    key: "lag_ret",
    label: "Lag returns {1,24}",
    cls: "past",
    desc: "1h and 24h lagged log-returns. Past-only.",
  },
  {
    key: "trend",
    label: "Trend slope (168h)",
    cls: "past",
    desc: "Rolling weekly OLS slope of log price — the 'trend' multivariate, as a past-only channel.",
  },
  {
    key: "regime",
    label: "Regime (3-state)",
    cls: "categorical",
    desc: "Trend-rule bull/neutral/bear label — the 'regime' multivariate as a categorical covariate. Conditioned on, never forecast.",
  },
  {
    key: "shift",
    label: "Shift flag (CUSUM)",
    cls: "categorical",
    desc: "Binary CUSUM level-shift mark (recency window) — the 'shift' multivariate, categorical. Past-only.",
  },
  {
    key: "hour",
    label: "Hour of day (sin/cos ×2)",
    cls: "known-future",
    desc: "Calendar, deterministic across the horizon — known-future. In finance the vol U-shape, not the price mean, is where this pays.",
  },
  {
    key: "dow",
    label: "Day of week",
    cls: "known-future",
    desc: "Weekday number + weekend flag. Known-future by the zero-uncertainty test.",
  },
  {
    key: "session",
    label: "Session flags (London/NY)",
    cls: "known-future",
    desc: "Trading-session overlap flags — a deterministic function of the timestamp. Known-future.",
  },
  {
    key: "month_end",
    label: "Month-end flag",
    cls: "known-future",
    desc: "Last 48h of the calendar month — scheduled, known-future.",
  },
  {
    key: "opex",
    label: "OpEx (3rd Friday)",
    cls: "known-future",
    desc: "Monthly options-expiration flag — scheduled years ahead. Known-future. (FOMC/CPI flags need an event feed — designed, not yet wired.)",
  },
]

/**
 * Conditioning presets (the M0–M3 ablation ladder from the design):
 *  M0 univariate · M1 +past-only · M2 +known-future · M3 full.
 * The target channel is always on; the toggles ARE the ablation.
 */
export const MODE_PRESETS: { id: string; label: string; keys: string[] }[] = [
  { id: "M0", label: "M0 · univariate", keys: ["target_lag"] },
  {
    id: "M1",
    label: "M1 · +past-only",
    keys: ["target_lag", "rv24", "rv72", "atr", "ewma", "volz", "drawdown", "rsi", "lag_ret", "trend", "regime", "shift"],
  },
  { id: "M2", label: "M2 · +known-future", keys: ["target_lag", "hour", "dow", "session", "month_end", "opex"] },
  {
    id: "M3",
    label: "M3 · full",
    keys: ["target_lag", "rv24", "rv72", "atr", "ewma", "volz", "drawdown", "rsi", "lag_ret", "trend", "regime", "shift", "hour", "dow", "session", "month_end", "opex"],
  },
]

/* ------------------------------- models ---------------------------------- */

export type ModelId =
  | "timestral"
  | "tsfm"
  | "tsfm_base"
  | "naive"
  | "svol"
  | "ewma"
  | "har"
  | "garch"
  | "gjr"
  | "egarch"

export interface ModelSpec {
  id: ModelId
  label: string
  role: string
  targets: Target[]
  desc: string
}

/** Model arms. `timestral` is the REAL foundation model (live weights via the
 *  :3030 sidecar). `tsfm`/`tsfm_base` are the clearly-labeled ridge stand-ins
 *  that keep the lab working even without the sidecar. */
export const MODELS: ModelSpec[] = [
  {
    id: "timestral",
    label: "Timestral-5M (real · zero-shot)",
    role: "the actual foundation model",
    targets: ["price", "vol", "direction"],
    desc: "Mistral Timestral-5M — 5.2M params, patch-based transformer (6 time-attn + 2 variate-attn layers), 21 quantiles, native past-only + known-future covariate channels. Real weights, CPU sidecar on :3030, ~35ms per forecast, ZERO-SHOT (never fine-tuned on these symbols).",
  },
  {
    id: "tsfm",
    label: "Ridge stand-in (covariates ON)",
    role: "harness stand-in, covariate-conditioned",
    targets: ["price", "vol", "direction"],
    desc: "Direct (H,τ) pinball ridge on the full covariate vector — calibration-honest (held-out residual quantiles). Demonstrates the conditioning math and powers the leave-one-out Δ-CRPS panel; clearly labeled as a stand-in.",
  },
  {
    id: "tsfm_base",
    label: "Ridge stand-in (univariate)",
    role: "ablation arm — covariate-free reference",
    targets: ["price", "vol", "direction"],
    desc: "Same quantile head, target lags only. The M0 ablation of the stand-in.",
  },
  {
    id: "naive",
    label: "Random walk (naive)",
    role: "the price bar",
    targets: ["price", "direction"],
    desc: "Last value + empirical H-step innovation quantiles (driftless RW). In finance this IS the climatology null — the unconditional-distribution bar a price forecast must beat on liquid markets. The separate weather-era climatology arm was removed for exactly this reason.",
  },
  {
    id: "svol",
    label: "Seasonal vol profile (hour-of-day)",
    role: "seasonality bar — vol lane only",
    targets: ["vol"],
    desc: "24 hour-of-day dummies + intercept (ridge) over the realized-vol window, + residual quantiles — the finance-native heir of the retired seasonal-naive/climatology bars. Vol is the one financial lane with genuine seasonality (the intraday U-shape); at H=24 the window covers a full day and the profile collapses to the unconditional vol distribution. Returns carry no exploitable seasonality, so this arm has no price-lane version — there the random walk already occupies the slot.",
  },
  {
    id: "ewma",
    label: "EWMA vol",
    role: "classic vol baseline",
    targets: ["vol"],
    desc: "Exponentially-weighted variance (λ=0.94, RiskMetrics) with empirical residual quantiles.",
  },
  {
    id: "har",
    label: "Log-HAR",
    role: "the vol-lane bar",
    targets: ["vol"],
    desc: "HAR-RV regression on log scale (RV_d, RV_w, RV_m) + residual quantiles. The documented Phase-0 winner — the bar for the vol lane.",
  },
  {
    id: "garch",
    label: "GARCH(1,1)",
    role: "the proven-methodology challenger",
    targets: ["vol"],
    desc: "MLE GARCH(1,1) with normal innovations on hourly log-returns (Nelder–Mead, frozen at eval start). Multi-step aggregate conditional variance + empirical residual quantiles. The classic conditional-variance incumbent.",
  },
  {
    id: "gjr",
    label: "GJR-GARCH(1,1)-t",
    role: "threshold / TGARCH arm",
    targets: ["vol"],
    desc: "GJR threshold asymmetry (negative shocks hit variance harder) with Student-t innovations — the 'TGARCH' variant the crypto GARCH-selection literature keeps flagging for BTC. MLE + aggregate-V fan.",
  },
  {
    id: "egarch",
    label: "EGARCH(1,1)-t",
    role: "log-variance asymmetric arm",
    targets: ["vol"],
    desc: "EGARCH: asymmetry in log-variance space, Student-t innovations — the other variant the BTC/ETH literature prefers. No positivity constraints on parameters, multiplicative volatility dynamics.",
  },
]

/* ----------------------------- eval protocol ----------------------------- */

export const EVAL = {
  /** Rolling origins: final 90 days, one origin per 24h. */
  originDays: 90,
  originStrideHours: 24,
  /** Models are frozen at eval start (zero-shot semantics — no peeking). */
  frozen: true,
  /** Purge/embargo gap between train and first origin = max horizon. */
  embargoBars: 72,
  /** Pinball loss × 2 approximates CRPS for quantile forecasts. */
  crpsFactor: 2,
} as const

/* ------------------------------ API contract ----------------------------- */

export interface ForecastPoint {
  h: number // hours ahead
  t: string // ISO timestamp
  q05: number
  q10: number
  q25: number
  q50: number
  q75: number
  q90: number
  q95: number
  actual?: number | null
}

export interface HistoryPoint {
  t: string
  v: number | null
  regime?: number
  shift?: boolean
}

export interface CovariateRow {
  key: string
  label: string
  cls: CovClass
  desc: string
  enabled: boolean // toggle state mirrors the arm (full vs base)
  contribution?: number // Δ-CRPS when removed (permutation importance, %)
  last?: number
  spark: number[]
  sparkFuture?: number[] // known-future covariates show the horizon too
}

export interface DirectionCard {
  pUp: number
  actualUp: boolean | null
  histBrier: number
  histAcc: number
  n: number
}

export interface ForecastResponse {
  series: SeriesId
  target: Target
  horizon: number
  model: ModelId
  cutoff: string
  history: HistoryPoint[]
  fan: ForecastPoint[]
  direction: DirectionCard | null
  covariates: CovariateRow[]
  local: {
    pinball: number // mean pinball across τ (target units)
    crps: number
    coverage: Record<string, number>
    width: Record<string, number>
    n: number
  }
  yLabel: string
}

export interface MetricRow {
  model: ModelId
  label: string
  pinball: number
  crps: number
  cov50: number
  cov80: number
  cov90: number
  width80: number
  dmZ: number | null // vs bar model
  dmP: number | null
  skillRatio: number | null // pinball / bar pinball (<1 = better)
  brier: number | null // direction target only
  acc: number | null // direction target only
}

/** Covariate-deafness ablation: circularly shift a covariate block and
 *  re-measure CRPS. If Δ ≈ 0 the model was never reading the channel. */
export interface AblationBlock {
  crps: number | null
  deltaPct: number | null // % CRPS change vs the full Timestral arm (positive = worse without alignment)
}

export interface EvalResponse {
  series: SeriesId
  target: Target
  horizon: number
  rows: MetricRow[]
  bar: ModelId
  pit: number[] // 20-bin PIT histogram for the ridge stand-in arm
  pitBase: number[] // PIT for the univariate stand-in
  pitTimestral?: number[] // PIT for the real model (when available)
  ablation?: {
    shufflePast: AblationBlock
    shuffleKnown: AblationBlock
  }
  timestral?: { available: boolean; note?: string }
  verdict: {
    gate: string
    passed: boolean | null
    detail: string
  }
  n: number
}
