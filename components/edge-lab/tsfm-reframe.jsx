"use client";

import { fmtNum } from "@/lib/edge-lab-format";

const ARM_COLORS = {
  har_ewma: "bg-success",
  har: "bg-info",
  chronos2_cov: "bg-primary",
};

const ARM_LABELS = {
  har_ewma: "HAR-EWMA",
  har: "HAR",
  chronos2_cov: "Chronos-2 (cov)",
};

export function TsfmReframe({ data }) {
  const vb = data.tsfm_reframe.vol_backtest;
  const recalib = data.tsfm_reframe.recalib;
  const nCells = Number(vb.n_cells);

  const cards = [
    {
      label: "HAR > naive",
      value: `${vb.har_beats_naive_holm_cells}`,
      sub: "Holm-significant cells",
      tone: "text-success",
    },
    {
      label: "HAR-EWMA > naive",
      value: `${vb.har_ewma_beats_naive}`,
      sub: "Holm-significant cells",
      tone: "text-success",
    },
    {
      label: "Chronos-2 zero-shot > HAR",
      value: `${vb.chronos_beats_har_sig_cells}/${nCells}`,
      sub: "Holm-significant cells",
      tone: "text-error",
    },
    {
      label: "Recalibration",
      value: `${recalib.accepted}`,
      sub: `cells accepted · b=${fmtNum(recalib.mean_b, 2)} · k=${fmtNum(recalib.mean_k, 2)}`,
      tone: "text-warning",
    },
  ];

  const arms = Object.entries(vb.qlike_best_by_arm).sort((a, b) => b[1] - a[1]);
  const maxArm = Math.max(1, ...arms.map(([, v]) => Number(v)));

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card bg-base-100 shadow-sm">
            <div className="card-body gap-1 p-4">
              <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {c.label}
              </span>
              <span className={`font-mono text-2xl font-semibold tabular-nums ${c.tone}`}>
                {c.value}
              </span>
              <span className="text-xs text-muted-foreground">{c.sub}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-base-300 bg-base-100 p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            QLIKE-best-by-arm · {nCells} cells (vol forecast backtest)
          </p>
          <div className="grid gap-3">
            {arms.map(([arm, count]) => (
              <div key={arm} className="grid gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{ARM_LABELS[arm] ?? arm}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {count}/{nCells}
                  </span>
                </div>
                <div
                  className="h-2.5 rounded-full bg-base-300"
                  role="img"
                  aria-label={`${ARM_LABELS[arm] ?? arm}: best QLIKE in ${count} of ${nCells} cells`}
                >
                  <div
                    className={`h-2.5 rounded-full ${ARM_COLORS[arm] ?? "bg-base-content/40"}`}
                    style={{ width: `${(Number(count) / maxArm) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="rounded-xl border border-base-300 bg-base-200/60 p-4 text-sm leading-relaxed">
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Conclusion (measured)
            </p>
            <p>{data.tsfm_reframe.conclusion}</p>
          </div>
          <p className="alert alert-warning text-xs leading-relaxed rounded-lg">
            Zero-shot TSFMs: no directional edge, lose to HAR on vol. Their role: calibrated
            vol spreads for sizing/geometry. Direction and edge come from regime values.
          </p>
        </div>
      </div>
    </div>
  );
}
