/* ---------------------------------------------------------------------------
 * TSFM-lab GARCH-family sanity — fit every spec on every symbol and print
 * parameters, persistence, in-sample one-step 95% coverage and a 24-bar
 * aggregate-variance fan point.
 *
 * Run from the repo root:  bun scripts/tsfm-lab-garch-sanity.ts
 * ------------------------------------------------------------------------- */
import { getSeries } from "@/lib/tsfm-lab/data"
import { buildCtx } from "@/lib/tsfm-lab/eval"
import { fitGarchFamily, aggregateVariance, garchQuantiles } from "@/lib/tsfm-lab/garch"

const SPECS = ["garch", "gjr", "egarch"] as const
const SYMBOLS = ["BTCUSD", "XAUUSD", "USDJPY", "XAGUSD", "USDCHF"] as const

for (const sym of SYMBOLS) {
  const s = await getSeries(sym)
  const ctx = buildCtx(s, "vol")
  for (const spec of SPECS) {
    const t0 = Date.now()
    const fit = fitGarchFamily(sym, ctx.s.ret1, ctx.trainStart, ctx.trainEnd, spec)
    const ms = Date.now() - t0
    const pers =
      spec === "egarch"
        ? fit.beta
        : spec === "gjr"
          ? fit.alpha + fit.gamma / 2 + fit.beta
          : fit.alpha + fit.beta
    // in-sample one-step 95% coverage of the filtered variance path
    let hit = 0
    let n = 0
    for (let t = ctx.trainStart; t < ctx.trainEnd; t++) {
      const s2 = fit.sigma2[t]
      const r = ctx.s.ret1[t]
      if (!Number.isFinite(s2) || !Number.isFinite(r)) continue
      hit += Math.abs(r) / Math.sqrt(s2) <= 1.959964 ? 1 : 0
      n++
    }
    const T = ctx.trainEnd - 100
    const V24 = aggregateVariance(fit, T, 24)
    const q = garchQuantiles(ctx, fit, T, 24)
    const nu = Number.isFinite(fit.nu) ? ` ν=${fit.nu.toFixed(1)}` : ""
    console.log(
      `${sym.padEnd(7)} ${spec.padEnd(6)} ω=${fit.omega.toExponential(2)} α=${fit.alpha.toFixed(3)} γ=${fit.gamma.toFixed(3)} β=${fit.beta.toFixed(3)}${nu} pers=${pers.toFixed(3)} ll=${fit.logLik.toFixed(1)} aic=${fit.aic.toFixed(1)} conv=${fit.converged} ${String(ms).padStart(5)}ms | 95%cov(is)=${(hit / Math.max(1, n)).toFixed(3)} V24=${V24.toExponential(3)} q50=${q[3].toFixed(3)} q05=${q[0].toFixed(3)} q95=${q[6].toFixed(3)}`,
    )
  }
}
