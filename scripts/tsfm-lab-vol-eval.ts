/* ---------------------------------------------------------------------------
 * TSFM-lab vol-lane rolling-origin eval — every synchronous arm in
 * modelsFor("vol") (the timestral sidecar arm is skipped) scored against the
 * Log-HAR bar with Diebold–Mariano, over 5 symbols × H ∈ {6, 24, 72}.
 *
 * Run from the repo root:  bun scripts/tsfm-lab-vol-eval.ts [H ...]
 * (default horizons 6 24 72; H=1 works too after the rvH min-guard fix)
 * ------------------------------------------------------------------------- */
import { getSeries } from "@/lib/tsfm-lab/data"
import { buildCtx, evalOrigins, modelsFor, barFor, fullCovKeys, runArm, dmTest } from "@/lib/tsfm-lab/eval"
import { MODELS } from "@/lib/tsfm-lab/design"

const Hs = process.argv
  .slice(2)
  .map(Number)
  .filter((h) => [1, 6, 24, 72].includes(h))
const SYMBOLS = ["BTCUSD", "XAUUSD", "USDJPY", "XAGUSD", "USDCHF"] as const

const label = (m: string) => MODELS.find((x) => x.id === m)?.label ?? m

for (const sym of SYMBOLS) {
  const s = await getSeries(sym)
  const ctx = buildCtx(s, "vol")
  for (const H of Hs.length ? Hs : [6, 24, 72]) {
    const origins = evalOrigins(s, H)
    const full = fullCovKeys(s, "vol")
    const t0 = Date.now()
    const rows = modelsFor("vol")
      .filter((m) => m !== "timestral")
      .map((m) => runArm(ctx, m, H, origins, full))
    const barId = barFor("vol")
    const bar = rows.find((r) => r.model === barId)
    if (!bar) continue
    console.log(
      `### ${sym} vol H=${H} (n=${bar.perOriginLoss.length}, bar=${label(bar.model)} pinball=${bar.pinball.toExponential(4)}, ${Date.now() - t0}ms)`,
    )
    for (const r of rows) {
      const d = r.perOriginLoss.map((v, i) => v - bar.perOriginLoss[i])
      const [z, p] = r.model === barId ? [0, 1] : dmTest(d, 2)
      const ratio = r.pinball / bar.pinball
      const tag =
        r.model !== barId && p < 0.05 ? (ratio < 1 ? "  *** BETTER" : "  *** WORSE") : ""
      console.log(
        `${label(r.model).padEnd(34)} pinball=${r.pinball.toExponential(4)} ratio=${ratio.toFixed(3)} dmZ=${z.toFixed(2)} p=${p.toFixed(4)} cov80=${(r.cov80 * 100).toFixed(0)}% w80=${r.width80.toExponential(3)}${tag}`,
      )
    }
  }
}
