import { NextRequest, NextResponse } from "next/server"
import { evaluate } from "@/lib/tsfm-lab/harness"
import type { SeriesId, Target } from "@/lib/tsfm-lab/design"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const SERIES = new Set(["BTCUSD", "USDJPY", "USDCHF", "XAUUSD", "XAGUSD"])
const TARGETS = new Set(["price", "vol", "direction"])

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const series = String(sp.get("series") ?? "BTCUSD")
    const target = String(sp.get("target") ?? "price")
    const horizon = Number(sp.get("horizon") ?? 24)
    if (!SERIES.has(series) || !TARGETS.has(target)) {
      return NextResponse.json({ error: "invalid series/target" }, { status: 400 })
    }
    if (![1, 6, 24, 72].includes(horizon)) {
      return NextResponse.json({ error: "horizon must be 1, 6, 24 or 72" }, { status: 400 })
    }
    const out = await evaluate(series as SeriesId, target as Target, horizon)
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
