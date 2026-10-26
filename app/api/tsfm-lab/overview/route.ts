import { NextResponse } from "next/server"
import { overview } from "@/lib/tsfm-lab/harness"
import { COVARIATES, TARGET_META, INTERVALS, EVAL, HORIZONS, QUANTILES } from "@/lib/tsfm-lab/design"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const data = await overview()
    return NextResponse.json({
      ...data,
      covariates: COVARIATES,
      targets: TARGET_META,
      intervals: INTERVALS,
      horizons: HORIZONS,
      quantiles: QUANTILES,
      eval: EVAL,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
