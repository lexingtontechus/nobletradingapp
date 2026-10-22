"use client";

/**
 * Semantic chips for the Edge Lab audit.
 * daisyUI badge classes, not shadcn — the repo has no components/ui/badge.
 * Unknown kinds degrade to a neutral badge that still prints the raw token.
 */

/** @type {Record<string, string>} */
const VERDICT_BADGE = {
  "PROVEN-FAIL": "badge-error",
  MEASURED: "badge-warning",
  "PROVEN-OK": "badge-success",
};

/** @type {Record<string, string>} */
const FIX_BADGE = {
  "FIXED-LIVE": "badge-success",
  "FIXED (migration)": "badge-info",
  "MEASURED-ONLY": "badge-ghost",
};

export function VerdictChip({ kind, className }) {
  const tone = VERDICT_BADGE[kind] || "badge-ghost";
  return (
    <span
      className={`badge badge-sm font-mono whitespace-nowrap ${tone} ${className || ""}`}
    >
      {kind}
    </span>
  );
}

/**
 * Fix status. An absent status means "nothing fixed in this run" — the artifact
 * ships `fixes: []` until the coordinator fills it — so the default is
 * MEASURED-ONLY rather than a blank chip.
 */
export function FixStatusChip({ status, className }) {
  const label = status || "MEASURED-ONLY";
  const tone = FIX_BADGE[label] || "badge-ghost";
  return (
    <span
      className={`badge badge-sm font-mono whitespace-nowrap ${tone} ${className || ""}`}
    >
      {label}
    </span>
  );
}

/** Mono id badge, e.g. W-C1. */
export function IdChip({ id, className }) {
  return (
    <span className={`badge badge-sm badge-ghost font-mono ${className || ""}`}>
      {id}
    </span>
  );
}

/** Small dot + label legend item for hand-rolled chart legends. */
export function LegendItem({ color, children, dashed }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className="inline-block h-0.5 w-4 rounded-full"
        style={{
          backgroundColor: dashed ? "transparent" : color,
          ...(dashed
            ? {
                backgroundImage: `linear-gradient(to right, ${color} 55%, transparent 55%)`,
                backgroundSize: "6px 2px",
              }
            : {}),
        }}
      />
      {children}
    </span>
  );
}
