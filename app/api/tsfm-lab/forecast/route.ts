import { NextRequest, NextResponse } from "next/server"
import { forecast, type ForecastRequest } from "@/lib/tsfm-lab/harness"
import type { SeriesId, Target, ModelId } from "@/lib/tsfm-lab/design"
import type { CovKey } from "@/lib/tsfm-lab/models"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const SERIES = new Set(["BTCUSD", "USDJPY", "USDCHF", "XAUUSD", "XAGUSD"])
const TARGETS = new Set(["price", "vol", "direction"])
const MODELS = new Set([
  "timestral",
  "tsfm",
  "tsfm_base",
  "naive",
  "svol",
  "ewma",
  "har",
])
const COVS = new Set([
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
])

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const series = String(body.series ?? "BTCUSD")
    const target = String(body.target ?? "price")
    const model = String(body.model ?? "tsfm")
    if (!SERIES.has(series) || !TARGETS.has(target) || !MODELS.has(model)) {
      return NextResponse.json({ error: "invalid series/target/model" }, { status: 400 })
    }
    const horizon = Number(body.horizon ?? 24)
    if (![1, 6, 24, 72].includes(horizon)) {
      return NextResponse.json({ error: "horizon must be 1, 6, 24 or 72" }, { status: 400 })
    }
    const covKeys = Array.isArray(body.covKeys)
      ? (body.covKeys.filter((k: unknown) => COVS.has(String(k))) as CovKey[])
      : []
    const cutoffIndex = Number.isFinite(Number(body.cutoffIndex))
      ? Number(body.cutoffIndex)
      : 83
    const out = await forecast({
      series: series as SeriesId,
      target: target as Target,
      horizon,
      model: model as ModelId,
      cutoffIndex,
      covKeys,
    } satisfies ForecastRequest)
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
