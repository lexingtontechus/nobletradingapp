/* ---------------------------------------------------------------------------
 * TSFM Lab — /eval cost control (Vercel Hobby = 60 s per Serverless Function)
 *
 * `evaluate()` is not one forecast. Over its 90 origins it runs the Timestral
 * arm, two covariate-deafness ablations, two PIT histograms, and a
 * leave-one-covariate-out sweep (~16 re-runs). That is hundreds of ~118 ms
 * sidecar round-trips and it does not fit in a 60 s budget.
 *
 * The 20-cell matrix this lab exists to produce is a BATCH artefact, not a
 * request/response one. This module keeps the interactive path responsive by
 * sub-sampling the DIAGNOSTIC paths only:
 *
 *   - metric rows and the verdict  → every origin (the result you read)
 *   - covariate importance         → sub-sampled (it is a ranking, not a loss)
 *   - PIT histograms               → sub-sampled
 *   - deafness ablations           → sub-sampled (already were, at stride 3)
 *
 * Sub-sampling is deterministic (`i % stride === 0`), so a given cell is
 * reproducible, and `sampling` is echoed in the response so a reader can tell a
 * full run from a sub-sampled one.
 * ------------------------------------------------------------------------- */

import { EVAL } from "./design"

/** One evaluated origin per `nOrigins` — enough for a stable loss, far cheaper. */
export function diagStride(nOrigins: number): number {
  const target = 24
  if (nOrigins <= target) return 1
  return Math.max(2, Math.ceil(nOrigins / target))
}

/** Sub-sample an origin grid deterministically. `stride <= 1` returns it as-is. */
export function strideOrigins<T>(origins: T[], stride: number): T[] {
  if (stride <= 1) return origins
  return origins.filter((_, i) => i % stride === 0)
}

/** True when a cell is too small to sub-sample meaningfully. */
export function tooSmallToStride(nOrigins: number): boolean {
  return nOrigins < 8
}

/** Budget note echoed into the response so a sub-sampled read is never mistaken
 *  for a full one. */
export function samplingNote(stride: number, nOrigins: number): string | undefined {
  if (stride <= 1) return undefined
  return `Diagnostics sub-sampled ${Math.ceil(nOrigins / stride)}/${nOrigins} origins ` +
    `(stride ${stride}) to fit the 60 s serverless cap. Metric rows and the verdict ` +
    `use all ${nOrigins} origins.`
}

/** Origins available after the embargo, for reference in logs. */
export function evalBudget(nOrigins: number): string {
  return `${nOrigins} origins × ${EVAL.originStrideHours}h stride (embargo ${EVAL.embargoBars})`
}
