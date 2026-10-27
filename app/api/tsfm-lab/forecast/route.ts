import { NextRequest, NextResponse } from "next/server"
import { forecast, type ForecastRequest } from "@/lib/tsfm-lab/harness"
import { MODELS, type SeriesId, type Target, type ModelId } from "@/lib/tsfm-lab/design"
import type { CovKey } from "@/lib/tsfm-lab/models"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const SERIES = new Set(["BTCUSD", "USDJPY", "USDCHF", "XAUUSD", "XAGUSD"])
const TARGETS = new Set(["price", "vol", "direction"])
/** Lane discipline, single-sourced from design.ts MODELS: an arm may only be
 *  forecast in a target lane it declares (e.g. the GARCH family is vol-only —
 *  zero-drift mean equation, no price/direction forecast to had). This also
 *  closes the pre-existing hole where any vol-only arm could be POSTed into
 *  the price/direction lanes. */
const MODEL_LANES = new Map<string, Set<string>>(
  MODELS.map((m) => [m.id as string, new Set<string>(m.targets)]),
)
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
    const lanes = MODEL_LANES.get(model)
    if (
      !SERIES.has(series) ||
      !TARGETS.has(target) ||
      !lanes ||
      !lanes.has(target) // arm not eligible for this lane (GARCH family: vol only)
    ) {
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
