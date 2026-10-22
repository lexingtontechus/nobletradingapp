"use client";

import {
  CircleCheckBig,
  FlaskConical,
  Ruler,
  Sigma,
  TriangleAlert,
} from "lucide-react";

import { FEATURE_KEYS, FEATURE_LABELS, fmtNum, fmtP } from "@/lib/edge-lab-format";

const TONE_CLASSES = {
  rose: "text-error",
  amber: "text-warning",
  emerald: "text-success",
};

/**
 * The five headline numbers of the audit — measured, not flattering.
 * Every label is derived from the payload so a stale run cannot read as a
 * current one.
 */
export function HeroStrip({ data }) {
  // `data` is only null while the page is bouncing an unauthorised visitor to
  // /welcome — the page guards that case, but tolerate it here too so this
  // component can never be the thing that crashes the route.
  const verdicts = data?.verdicts ?? [];
  const provenFail = verdicts.filter((v) => v.verdict === "PROVEN-FAIL").length;
  const measured = verdicts.filter((v) => v.verdict === "MEASURED").length;
  const fixes = data?.fixes ?? [];

  const hmmRows = data?.hmm?.per_symbol ?? [];
  const meanSkill =
    hmmRows.length > 0
      ? hmmRows.reduce((acc, h) => acc + h.skill, 0) / hmmRows.length
      : Number.NaN;
  const negativeSkill = hmmRows.filter((h) => h.skill < 0).length;

  // Significant Spearman tests across symbol x feature.
  const sigCells = (data.edge_surface?.per_symbol ?? []).flatMap((s) =>
    FEATURE_KEYS.filter((f) => (s.spearman[f]?.p ?? 1) < 0.05).map((f) => ({
      symbol: s.symbol,
      feature: f,
      rho: s.spearman[f].rho,
      p: s.spearman[f].p,
    })),
  );
  const surfaceRows = data.edge_surface?.per_symbol ?? [];
  const totalCells = surfaceRows.length * FEATURE_KEYS.length;

  const cards = [
    {
      label: "PROVEN-FAIL",
      value: String(provenFail),
      sub: "weaknesses disproven mathematically",
      tone: "rose",
      icon: TriangleAlert,
    },
    {
      label: "MEASURED",
      value: String(measured),
      sub: "quantified, fix pending or not applicable",
      tone: "amber",
      icon: FlaskConical,
    },
    {
      label: "FIX STATUS",
      value: String(fixes.length),
      sub:
        fixes.length > 0
          ? "fixes shipped in this run"
          : "no fixes recorded in this run — the fixes array is filled by the coordinator",
      tone: fixes.length > 0 ? "emerald" : "amber",
      icon: CircleCheckBig,
    },
    {
      label: "HMM direction skill",
      value: hmmRows.length > 0 ? `${fmtNum(meanSkill, 3)} mean` : "—",
      sub:
        hmmRows.length === 0
          ? "no HMM block in this run"
          : negativeSkill === hmmRows.length
            ? `negative on all ${hmmRows.length} symbols — the live direction source has no skill`
            : `negative on ${negativeSkill} of ${hmmRows.length} symbols`,
      tone: "rose",
      icon: Sigma,
    },
    {
      label: "Edge predictability",
      value: totalCells > 0 ? `${sigCells.length} / ${totalCells}` : "—",
      sub:
        totalCells === 0
          ? "no edge-surface block in this run"
          : sigCells.length > 0
            ? `significant regime-value tests: ${sigCells
                .map(
                  (c) =>
                    `${FEATURE_LABELS[c.feature]} ${c.symbol} rho=${fmtNum(c.rho, 3)} p=${fmtP(c.p)}`,
                )
                .join("; ")}`
            : "no feature x symbol cell reaches alpha=0.05",
      tone: "amber",
      icon: Ruler,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="card bg-base-100 shadow-sm">
          <div className="card-body gap-1 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {card.label}
              </span>
              <card.icon
                className={`size-4 shrink-0 ${TONE_CLASSES[card.tone]}`}
                aria-hidden="true"
              />
            </div>
            <div
              className={`font-mono text-2xl font-semibold tracking-tight tabular-nums ${TONE_CLASSES[card.tone]}`}
            >
              {card.value}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {card.sub}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
