/**
 * @fileoverview Utility functions and constants for the Kairos Edge Lab dashboard.
 * Ported from lib/edge-lab-format.ts.
 */

/** Chart series hex colors (used in edge-surface plots). */
export const SERIES_COLORS = {
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  teal: "#14b8a6",
  zinc: "#a1a1aa",
  violet: "#8b5cf6",
};

/** Three regime labels for time-series display. */
export const REGIME_COLORS = {
  trend_up: "#10b981",
  trend_down: "#f43f5e",
  neutral: "rgba(161,161,170,0.25)",
};

/** Human labels for the five regime-value features. */
export const FEATURE_LABELS = {
  er_abs: "ER |trend|",
  chop: "Chop",
  vol: "Vol",
  hurst: "Hurst",
  adx: "ADX",
};

export const FEATURE_KEYS = ["er_abs", "chop", "vol", "hurst", "adx"];

/** ChartTooltip wrapper styles (daisyUI-themed). */
export const TOOLTIP_WRAPPER_STYLE = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--card-foreground)",
  fontSize: "12px",
  boxShadow: "0 4px 24px rgb(0 0 0 / 0.25)",
};

export const TOOLTIP_LABEL_STYLE = {
  color: "var(--muted-foreground)",
  fontFamily: "var(--font-mono), monospace",
  fontSize: "11px",
};

export const AXIS_TICK_STYLE = {
  fill: "var(--muted-foreground)",
  fontSize: 11,
};

/** Check if x is a finite number. */
function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** "24.4%" from 0.2439. Non-finite → "—". */
export function fmtPct(x, dp = 1) {
  if (!isFiniteNumber(x)) return "—";
  return `${(x * 100).toFixed(dp)}%`;
}

/** Signed R-style: "+0.26" / "-0.02" (ASCII sign, mono-friendly). */
export function fmtR(x, dp = 2) {
  if (!isFiniteNumber(x)) return "—";
  const sign = x > 0 ? "+" : x < 0 ? "-" : "";
  return `${sign}${Math.abs(x).toFixed(dp)}`;
}

/** p-value: "<0.001" below 0.001, else 3 decimals. */
export function fmtP(p) {
  if (!isFiniteNumber(p)) return "—";
  return p < 0.001 ? "<0.001" : p.toFixed(3);
}

/** Plain number, "—" for non-finite. */
export function fmtNum(x, dp = 2) {
  if (!isFiniteNumber(x)) return "—";
  return x.toFixed(dp);
}

/**
 * Evenly sample `arr` down to at most `max` points, always keeping the last
 * point (so terminal drawdown / final equity stays visible).
 * @param {Array} arr - Input array
 * @param {number} max - Maximum output length
 * @returns {Array} Decimated array
 */
export function decimate(arr, max = 800) {
  if (arr.length <= max) return [...arr];
  const out = [];
  const step = arr.length / (max - 1);
  for (let i = 0; i < max - 1; i++) {
    out.push(arr[Math.min(arr.length - 1, Math.floor(i * step))]);
  }
  out.push(arr[arr.length - 1]);
  return out;
}

/**
 * Compact date label for hourly ISO stamps: "Sep 12".
 * @param {string} iso - ISO timestamp string
 * @returns {string} Formatted date label
 */
export function fmtDateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}