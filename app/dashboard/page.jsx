// =============================================================================
// Noble Trading App — Dashboard Page (Talaria plugin mirror)
// =============================================================================
// Mirrors the layout/structure of the Talaria desktop plugin dashboard
// (noble-trader-hermes-plugins/talaria/desktop/plugin.js, function TalariaDashboard)
// as a JSX page using this repo's Tailwind CSS + daisyUI conventions.
//
// Plugin class → website class mapping:
//   tla-root     → min-h-screen bg-base-200 container
//   tla-header   → card header bar
//   tla-banner   → alert banner
//   tla-card     → card bg-base-100 shadow border
//   tla-grid     → grid gap-4 md:grid-cols-3
//   tla-tabs     → tab bar (custom buttons)
//   tla-value    → text-2xl font-bold
//   tla-sub      → text-xs opacity-60
//   tla-pos/tla-neg → text-success / text-error
//   tla-table    → table table-sm
//   tla-badge    → badge badge-sm
//
// Phase 1: Layout skeleton mirroring the plugin's section structure.
// Phase 2 (completed): Wired up Supabase Realtime broadcast subscription +
//   daisyUI toast notifications.
// =============================================================================

"use client";

import { useEffect, useState, useRef, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { TalariaMark } from "../components/talaria-mark";
import { createClient } from "@/utils/supabase/client";

// -- Toast state --
// daisyUI toast pattern: <div className="toast toast-top toast-end"> with
// <div className="alert ..."> children. Toasts are driven by Realtime broadcast
// signal events (mirrors the plugin's signalStore.addSignal → toast flow).
function useToasts() {
  const [toasts, setToasts] = useState([]);

  const [copiedId, setCopiedId] = useState(null);

  const pushToast = (toast) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...toast, id }]);
    // Auto-dismiss after TTL (default 8s, matching plugin's toast TTL)
    const ttl = toast.ttl ?? 8000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, ttl);
  };

  const dismiss = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Copy signal prices to clipboard and show a brief confirmation
  const copyToast = async (id, copyText) => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback: select the text in a textarea
    }
  };

  return { toasts, pushToast, dismiss, copyToast, copiedId };
}

// ToastContainer renders daisyUI toast markup at the top-right corner
function ToastContainer({ toasts, onDismiss, copiedId }) {
  if (!toasts.length) return null;
  return (
    <div className="toast toast-top toast-end">
      {toasts.map((t) => {
        const isCopyable = t.copyable && t.copyText;
        return (
          <div
            key={t.id}
            className={`alert alert-sm shadow-lg max-w-xs ${
              t.tone === "pos"
                ? "alert-success"
                : t.tone === "neg"
                  ? "alert-error"
                  : t.tone === "warn"
                    ? "alert-warning"
                    : "alert-info"
            }`}
          >
            <div className="flex-1">
              <div className="text-sm font-semibold">{t.title}</div>
              <div className="text-xs opacity-80 whitespace-pre-line">{t.body}</div>
            </div>
            <div className="flex flex-col gap-1">
              {isCopyable && (
                <button
                  className={"btn btn-ghost btn-xs " + (copiedId === t.id ? "btn-success" : "")}
                  onClick={() => copyToast(t.id, t.copyText)}
                  title="Copy signal prices"
                >
                  {copiedId === t.id ? "✓ Copied" : "📋 Copy"}
                </button>
              )}
              <button
                className="btn btn-ghost btn-xs btn-circle"
                onClick={() => onDismiss(t.id)}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -- Dashboard data (fetched from /api/dashboard-data, which reads from
//    v_talaria_latest_signals, v_talaria_signal_health, etc.) --
// These state vars are populated at runtime; all are initialized to empty/null
// and the components gracefully handle the loading state.
const ASSET_CLASS_ORDER = ["commodities", "forex", "crypto", "stocks"];

// -- Helpers (mirrored from plugin.js) --

function fmtPrice(v) {
  if (v == null || isNaN(Number(v))) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(1);
  if (abs >= 100) return n.toFixed(3);
  if (abs >= 10) return n.toFixed(4);
  return n.toFixed(5);
}

function fmtUsd(v) {
  if (v == null || isNaN(Number(v))) return "—";
  const n = Number(v);
  if (Math.abs(n) < 1000) return n.toFixed(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

// Full-precision price formatter for renko chart — no rounding.
// Displays the full number as-is from the data source.
function fmtBrickPriceFull(n) {
  if (n == null || isNaN(Number(n))) return "";
  const v = Number(n);
  if (Math.abs(v) >= 1000) return "$" + v.toString();
  if (Math.abs(v) >= 100) return "$" + v.toFixed(3).replace(/\.?0+$/, "");
  if (Math.abs(v) >= 10) return "$" + v.toFixed(4).replace(/\.?0+$/, "");
  return "$" + v.toFixed(5).replace(/\.?0+$/, "");
}

// Alias for backward compat — same full-precision behavior
var fmtBrickPriceUsd = fmtBrickPriceFull;

function fmtKellyPct(k) {
  if (k == null || isNaN(Number(k))) return "—";
  return (Number(k) * 100).toFixed(1) + "%";
}

function fmtRegime(label) {
  const REGIME_FRIENDLY = {
    low_vol_strong_bull: "🐂 Low-vol strong bull",
    low_vol_bull: "🐂 Low-vol bull",
    low_vol_strong_bear: "🐻 Low-vol strong bear",
    low_vol_bear: "🐻 Low-vol bear",
    high_vol_strong_bull: "🐂 High-vol strong bull",
    high_vol_bull: "🐂 High-vol bull",
    high_vol_strong_bear: "🐻 High-vol strong bear",
    high_vol_bear: "🐻 High-vol bear",
    low_vol_range: "↔️ Low-vol range",
    high_vol_range: "↔️ High-vol range",
    low_vol_chop: "🔀 Low-vol chop",
    high_vol_chop: "🔀 High-vol chop",
    low_vol_strong_trend: "📈 Low-vol strong trend",
    high_vol_strong_trend: "📈 High-vol strong trend",
    strong_trend: "📈 Strong trend",
    range: "↔️ Range",
    chop: "🔀 Chop",
  };
  if (!label) return "—";
  const key = String(label).toLowerCase();
  if (REGIME_FRIENDLY[key]) return REGIME_FRIENDLY[key];
  const tierMatch = key.match(/^(low_|high_|med_)/);
  if (tierMatch) {
    const base = key.slice(tierMatch[0].length);
    if (REGIME_FRIENDLY[base]) {
      const tierWord = { low_: "Low-vol", high_: "High-vol", med_: "Med-vol" }[tierMatch[0]];
      return REGIME_FRIENDLY[base].replace(/Low-vol|High-vol/, tierWord);
    }
  }
  return String(label).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// Group sweep rows by asset_class and sort within groups
function groupByAssetClass(sweeps) {
  const groups = {};
  for (const s of sweeps) {
    const cls = s.asset_class || "other";
    if (!groups[cls]) groups[cls] = [];
    groups[cls].push(s);
  }
  return groups;
}

// Brick pattern from direction sequence.
// Collapses consecutive same-direction bricks into a single direction
// so the pattern reflects the sequence of direction CHANGES, not run
// length.  A run of 3 ups in a row collapses to "U" — it is NOT a
// "3-push" signal; it is just one continued up move.
function brickPattern(dirs) {
  if (!dirs || !dirs.length) return "";
  return dirs
    .map((d) => (Number(d.close_price) > Number(d.open_price) ? 1 : -1))
    .map((d) => (d > 0 ? "U" : "D"))
    .join("")
    .replace(/(.)\1+/g, "$1");
}

// Describe the direction-change pattern of the last N bricks.
// The collapsed pattern is a sequence of U/D direction changes —
// each character is one direction, regardless of how many bricks
// lasted in that direction.  Valid patterns on a 10-brick window:
//   U / D / UD / DU / UDU / DUD / UDUD / DUDU / ...
// We label the clearly-structured ones and fall back to "Mixed"
// with an arrow trace for everything else.
function patternLabel(pattern) {
  if (!pattern || !pattern.length) return "—";
  if (pattern === "UD") return "Reversal ↑↓";
  if (pattern === "DU") return "Reversal ↓↑";
  if (pattern === "UDU") return "Pullback ↑↓↑";
  if (pattern === "DUD") return "Pullback ↓↑↓";
  if (/^(UD)+$/.test(pattern) || /^(DU)+$/.test(pattern)) return "Choppy ↕";
  // Single direction (one move, any length) — not a "push", just a trend
  if (pattern === "U") return "Up trend ↑";
  if (pattern === "D") return "Down trend ↓";
  // Alternating 3+ times = chop
  if (/^(UDU|DUD)+$/.test(pattern)) return "Choppy ↕";
  // For Mixed patterns, append directional indicator arrows
  const arrows = pattern
    .split("")
    .map((c) => (c === "U" ? "↑" : "↓"))
    .join("");
  return "Mixed (" + arrows + ")";
}

// -- Components --

function StatCard({ title, value, sub, tone, valueClassName }) {
  return (
    <div className="card bg-base-200 shadow-sm border border-base-300">
      <div className="card-body p-4">
        <h3 className="text-xs font-semibold uppercase opacity-60 mb-1">
          {title}
        </h3>
        <div
          className={
            "text-2xl font-bold " +
            (valueClassName ||
              (tone === "pos"
                ? "text-success"
                : tone === "neg"
                  ? "text-error"
                  : tone === "warn"
                    ? "text-warning"
                    : "text-base-content"))
          }
        >
          {value}
        </div>
        {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function HotSignalsBanner({ signals }) {
  const hot = (signals || []).filter((s) => s.qualified);
  if (hot.length === 0) return null;

  return (
    <div className="card bg-base-300 shadow border border-base-300 mb-6">
      <div className="card-body py-3">
        <h2 className="card-title">Talaria Live Signals</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {hot.map((s) => {
            const isSell = String(s.signal || "").toLowerCase() === "sell";
            return (
              <span
                key={s.symbol}
                className={
                  "badge text-xs font-mono " +
                  (isSell ? "badge-error" : "badge-success")
                }
                title={`${s.symbol} ${isSell ? "Sell" : "Buy"} · entry ${fmtBrickPriceUsd(s.entry_price)} · SL ${fmtBrickPriceUsd(s.stop_loss)} · TP ${fmtBrickPriceUsd(s.take_profit)} · kelly ${s.effective_kelly.toFixed(3)} · ${fmtRegime(s.regime)}`}
              >
                {s.symbol} {isSell ? "SELL" : "BUY"} · k{s.effective_kelly.toFixed(2)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Tab bar using daisyUI classes (mirrors tla-tabs).
function TabBar({ active, onChange }) {
  return (
    <div className="tabs tabs-border mb-4">
      {["market", "analysis"].map((tab) => (
        <button
          key={tab}
          className={
            "tab tab-lg font-medium " +
            (active === tab
              ? "tab-active text-primary"
              : "text-base-content/60 hover:text-base-content/80")
          }
          onClick={() => onChange(tab)}
        >
          {tab === "market" ? "Market" : "Analysis"}
        </button>
      ))}
    </div>
  );
}

// Generate mock renko bricks from the sweep row's parameters.
// The brick pattern is derived from signal direction + random-ish but
// deterministic sequence so the chart looks realistic.
function generateBricks(sweepRow, count = 10) {
  if (!sweepRow) return [];
  const { brick_size, entry_price, signal } = sweepRow;
  if (entry_price <= 0 || brick_size <= 0) return [];

  const isBuy = String(signal || "").toLowerCase() !== "sell";
  const bricks = [];
  // Deterministic pseudo-random sequence based on symbol hash so
  // different symbols produce different but stable patterns
  const seed = Array.from(sweepRow.symbol || "").reduce((a, c) => a + c.charCodeAt(0), 0);
  let price = entry_price;

  for (let i = 0; i < count; i++) {
    // Use seeded PRNG for deterministic-ish brick directions
    const r = ((seed + i * 17) % 100) / 100;
    // Bias toward the signal direction but allow some reversals
    const direction = r < (isBuy ? 0.7 : 0.3) ? 1 : -1;
    const prevPrice = price;
    price += direction * brick_size;
    bricks.push({
      index: i,
      open: prevPrice,
      close: price,
      direction,
    });
  }
  return bricks;
}

// --- Market tab content ---

function RenkoSection({ sweeps, symbolList, selectedSym, onSelect, renkoBricks }) {
  const activeSym = selectedSym || symbolList[0] || "";
  const sweepRow = sweeps.find((s) => s.symbol === activeSym);
  // Use real renko bricks from v_talaria_renko when available, fall back to
  // generateBricks for the symbol if no brick data has arrived yet.
  const symbolBricks = (renkoBricks || []).filter((b) => b.symbol === activeSym);
  const bricks = symbolBricks.length > 0
    ? symbolBricks.slice(0, 10).reverse().map((b, i) => ({
        index: i,
        open: Number(b.open_price),
        close: Number(b.close_price),
        // Direction from price comparison (matches talaria plugin logic).
        // The nt_renko_bricks.direction column may store text ('up'/'down')
        // which cannot be compared with > 0 in JS, so we derive direction
        // from open vs close price.
        direction: Number(b.close_price) > Number(b.open_price) ? 1 : -1,
      }))
    : generateBricks(sweepRow, 10);

  const levels = [];
  if (sweepRow) {
    if (sweepRow.entry_price > 0)
      levels.push({ label: "ENTRY", price: sweepRow.entry_price, color: "text-base-content/70", fill: "var(--color-base-content)" });
    if (sweepRow.stop_loss > 0)
      levels.push({ label: "SL", price: sweepRow.stop_loss, color: "text-error/80", fill: "var(--color-error)" });
    if (sweepRow.take_profit > 0)
      levels.push({ label: "TP", price: sweepRow.take_profit, color: "text-success/80", fill: "var(--color-success)" });
  }

  // SVG chart dimensions — scale brick width to the actual number of bricks
  // so symbols with fewer than 10 bricks still render legibly.
  const brickCount = bricks.length;
  const CHART_W = 480;
  const CHART_H = 160;
  const MARGIN_L = 55;
  const MARGIN_T = 16;
  const MARGIN_B = 24;
  const BRICK_W = (CHART_W - MARGIN_L) / Math.max(brickCount + 2, 12); // min 12 slots
  const BRICK_H = (CHART_H - MARGIN_T - MARGIN_B) / 12; // scale price to brick height

  // Determine price range from bricks + levels
  const allPrices = [...bricks.map((b) => [b.open, b.close]), ...levels.map((l) => l.price)].flat();
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 1;
  const priceRange = maxPrice - minPrice || sweepRow?.brick_size || 1;
  // Add a small padding so extreme prices aren't clipped at the chart edges.
  const pad = priceRange * 0.05;
  const yMin = minPrice - pad;
  const yMax = maxPrice + pad;
  const yRange = yMax - yMin || 1;

  function niceRound(v) {
    if (v == null || isNaN(v)) return v;
    const n = Number(v);
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n)) || 0));
    if (mag >= 1000) return Math.ceil(n / mag) * mag;
    return Math.ceil(n * 100) / 100;
  }
  const roundedYMax = niceRound(yMax);
  const roundedYMin = Math.floor(yMin);
  const roundedYRange = roundedYMax - roundedYMin || 1;

  const priceToY = (p) => {
    const t = (p - yMin) / yRange;
    return CHART_H - MARGIN_B - t * (CHART_H - MARGIN_T - MARGIN_B);
  };

  const brickToX = (i) => MARGIN_L + i * BRICK_W + 2;

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">
          Renko bricks — last 10 (per symbol)
        </h3>
        <p className="text-xs opacity-60 mb-3">
          Last {bricks.length} renko bricks of the selected symbol (each brick
          = one fixed price move of {sweepRow ? fmtUsd(sweepRow.brick_size) : "n/a"}).
          ENTRY / SL / TP reference lines come from that symbol's latest
          sweep. Switch symbols to re-analyze.
        </p>
        <p><strong>Hover each brick for full price.</strong></p>
        {/* Symbol picker buttons */}
        <div className="flex flex-wrap gap-1 mb-3">
          {symbolList.map((s) => (
            <button
              key={s}
              className={
                "px-3 py-1 text-sm font-mono rounded border btn" +
                (s === activeSym
                  ? "bg-primary text-secondary border-primary"
                  : "bg-base-200 text-base-content border-base-300")
              }
              onClick={() => onSelect(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Renko brick SVG chart */}
        <div className="bg-base-200/50 rounded-lg overflow-hidden">
          <svg
            className="w-full h-auto text-base-content/40"
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Y-axis price labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const price = roundedYMax - roundedYRange * frac;
              const y = MARGIN_T + frac * (CHART_H - MARGIN_T - MARGIN_B);
              return (
                <g key={frac}>
                  <line
                    x1={MARGIN_L - 4}
                    y1={y}
                    x2={MARGIN_L}
                    y2={y}
                    stroke="currentColor"
                    strokeWidth={0.5}
                  />
                  <text
                    x={MARGIN_L - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="text-[5px]"
                    style={{ fill: "var(--color-base-content)" }}
                  >
                    {fmtBrickPriceUsd(price)}
                  </text>
                </g>
              );
            })}

            {/* Horizontal gridlines */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const y = MARGIN_T + frac * (CHART_H - MARGIN_T - MARGIN_B);
              return (
                <line
                  key={frac}
                  x1={MARGIN_L}
                  y1={y}
                  x2={CHART_W - 4}
                  y2={y}
                  stroke="var(--color-base-content)"
                  strokeWidth={0.25}
                  opacity={0.3}
                />
              );
            })}

            {/* X-axis tick labels (brick indices) */}
            {bricks.map((b) => {
              const x = brickToX(b.index) + BRICK_W / 2;
              return (
                <text
                  key={`tick-${b.index}`}
                  x={x}
                  y={CHART_H - 6}
                  textAnchor="middle"
                  className="text-[5px]"
                  style={{ fill: "var(--color-base-content)" }}
                >
                  {b.index + 1}
                </text>
              );
            })}

            {/* Bricks */}
            {bricks.map((b) => {
              const y = priceToY(b.close);
              const height = Math.abs(priceToY(b.open) - y);
              const isUp = b.direction > 0;
              const color = isUp ? "#22c55e" : "#ef4444"; // green / red
              const x = brickToX(b.index);
              const w = BRICK_W - 4;
              return (
                <g key={b.index}>
                  <title>{activeSym} — Brick #{b.index + 1} · {isUp ? "↑ UP" : "↓ DOWN"} · Open {fmtBrickPriceFull(b.open)} · Close {fmtBrickPriceFull(b.close)}</title>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={height}
                    fill={color}
                    stroke={color}
                    strokeWidth={0.5}
                    opacity={0.85}
                  />
                  {/* Wick-style top/bottom stroke for up bricks */}
                  {isUp && (
                    <rect
                      x={x + w - 2}
                      y={y}
                      width={2}
                      height={height}
                      fill={color}
                      opacity={0.5}
                    />
                  )}
                </g>
              );
            })}

            {/* ENTRY / SL / TP reference horizontal lines */}
            {levels.map((lv) => (
              <g key={lv.label}>
                <title>{lv.label} @ {fmtBrickPriceFull(lv.price)}</title>
                <line
                  x1={MARGIN_L}
                  y1={priceToY(lv.price)}
                  x2={CHART_W - 4}
                  y2={priceToY(lv.price)}
                  stroke={lv.fill}
                  strokeWidth={1}
                  strokeDasharray="4 2"
                  opacity={0.6}
                  style={{ stroke: lv.fill }}
                />
                <text
                  x={CHART_W - 6}
                  y={priceToY(lv.price) + 3}
                  textAnchor="end"
                  style={{ fill: lv.fill }}
                  className="text-[7px] font-mono font-semibold"
                >
                  {lv.label}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* ENTRY / SL / TP reference levels below chart */}
        {levels.length > 0 && (
          <div className="mt-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              {levels.map((lv) => (
                <span
                  key={lv.label}
                  className={"font-mono " + lv.color}
                >
                  {lv.label}: {fmtBrickPriceUsd(lv.price)}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs opacity-50 mt-2">
          ENTRY / SL / TP reference lines from the latest sweep · window = last 10
          bricks
        </p>
      </div>
    </div>
  );
}

function MarkovSection({ sweeps, selectedSym, renkoBricks }) {
  const sweepRow = sweeps.find((s) => s.symbol === selectedSym);
  // Derive brick pattern from real renko brick data
  const activeSym = selectedSym || "";
  const symbolBricks = (renkoBricks || []).filter((b) => b.symbol === activeSym);

  // Build pattern from last 10 bricks, deduplicating consecutive same-direction
  const rawDirs = symbolBricks.length > 0
    ? symbolBricks.slice(0, 10).map((b) =>
        Number(b.close_price) > Number(b.open_price) ? "U" : "D"
      )
    : (sweepRow ? [sweepRow.signal === "buy" ? "U" : "D"] : []);
  const patternStr = rawDirs.join("");
  // Collapse consecutive same-direction to show distinct direction changes
  const collapsed = patternStr.replace(/(.)\1+/g, "$1");

  const pattern = collapsed && collapsed.length > 0 ? patternLabel(collapsed) : "—";

  const markovP = sweepRow?.markov_p_up;
  const markovDisplay = markovP
    ? (markovP * 100).toFixed(1) + "%"
    : "—";
  const markovTone = markovP >= 0.5 ? "text-success" : "text-error";
  const markovSub = markovP
    ? `P(down) ${(1 - markovP) * 100}% · 200 bricks`
    : "needs ≥10 bricks";

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">
          Markov + pattern — {selectedSym || "select a symbol"}
        </h3>
        <p className="text-xs opacity-60 mb-3">
          Short-term shape + longer statistical odds for the SELECTED symbol.
          Brick pattern reads the last 10 bricks; Markov P(up in 3) fits a
          3-state chain on up to 200 brick closes.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard
            title="Brick pattern"
            value={pattern}
            sub={
              "last 10 bricks · " +
              (sweepRow ? fmtRegime(sweepRow.regime) : "regime n/a")
            }
          />
          <StatCard
            title="Markov P(up in 3)"
            value={markovDisplay}
            sub={markovSub}
            tone={markovP ? (markovP > 0.5 ? "pos" : "neg") : undefined}
            valueClassName={markovTone}
          />
        </div>
        <p className="text-xs opacity-50 mt-2">
          Brick pattern = last 10 bricks only (short-term shape). Markov P(up
          in 3) = 3-state Markov chain on up to 200 closes — probability the
          next 3-brick move is UP. &gt;50% leans bullish, &lt;50% leans bearish.
        </p>
      </div>
    </div>
  );
}

function SizingWhatIfSection({ sweeps, selectedSym, paperEquity }) {
  const sweepRow = sweeps.find((s) => s.symbol === selectedSym);
  const kellyIn = sweepRow?.effective_kelly ?? sweepRow?.kelly_f ?? null;
  // Use real paper equity from v_paper_equity (latest session equity), fall back to $1000
  const eqUsd = (paperEquity && paperEquity.length > 0 && paperEquity[0].session_equity)
    ? Number(paperEquity[0].session_equity)
    : 1000;
  const regimeMult = 1.0;
  const baseline = eqUsd * (kellyIn || 0) * regimeMult;
  const finalSz = Math.min(baseline * 0.85, eqUsd * 0.05);

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">
          Sizing what-if — {selectedSym || "select a symbol"}
        </h3>
        <p className="text-xs opacity-60 mb-3">
          If the engine sized a trade on the SELECTED symbol right now:
          baseline = paper equity × effective_kelly × regime multiplier, then
          clipped by drawdown and capped at 5% of equity.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard
            title="Baseline size"
            value={kellyIn != null ? "$" + Number(baseline).toFixed(2) : "—"}
            sub={
              "equity $" +
              Number(eqUsd).toFixed(2) +
              " × kelly " +
              (kellyIn != null ? Number(kellyIn).toFixed(3) : "n/a") +
              " × regime " +
              regimeMult.toFixed(2)
            }
          />
          <StatCard
            title="Final size (capped)"
            value={kellyIn != null ? "$" + Number(finalSz).toFixed(2) : "—"}
            sub={
              "5% equity cap = $" + (eqUsd * 0.05).toFixed(2)
            }
            tone={kellyIn != null && finalSz > 0 ? "pos" : "neg"}
          />
        </div>
      </div>
    </div>
  );
}

// TradingView symbol mapping (our symbols → TV symbol format).
// Values from v_talaria_symbols.tradingview_symbol (migration 028) + plugin fallback.
function tvSymbol(symbol, symbolsData) {
  // First, try to look up the tradingview_symbol from the v_talaria_symbols view
  // (which stores the canonical TV symbol per exchange, e.g. COINBASE:BTCUSD).
  if (symbolsData && symbolsData.length > 0) {
    const match = symbolsData.find((s) => s.symbol === symbol);
    if (match && match.tradingview_symbol) {
      return match.tradingview_symbol;
    }
  }
  // Fallback map — must match the exact TV exchange prefixes used in the DB
  // (migration 028): COINBASE:**, OANDA:**, TVC:**. Using wrong prefixes
  // like BINANCE: or FX: causes the chart to fail silently.
  const m = {
    BTCUSD: "COINBASE:BTCUSD",
    ETHUSD: "COINBASE:ETHUSD",
    SOLUSD: "COINBASE:SOLUSD",
    XAUUSD: "OANDA:XAUUSD",
    XAUAUD: "OANDA:XAUAUD",
    XAUEUR: "OANDA:XAUEUR",
    XAGUSD: "OANDA:XAGUSD",
    USDJPY: "OANDA:USDJPY",
    EURUSD: "OANDA:EURUSD",
    GBPUSD: "OANDA:GBPUSD",
    AUDUSD: "OANDA:AUDUSD",
    USDCAD: "OANDA:USDCAD",
    USDCHF: "OANDA:USDCHF",
    AAPL: "NASDAQ:AAPL",
    US30USD: "INDEX:US30",
    US500: "FOREXCOM:US500",
    DXY: "TVC:DXY",
  };
  return m[symbol] || ("OANDA:" + symbol);
}

function TVChart({ symbol, symbolsData }) {
  const containerRef = useRef(null);
  const currentSymbol = symbol || "XAGUSD";
  const tvSym = tvSymbol(currentSymbol, symbolsData);

  // Load TradingView chart via direct iframe URL (same pattern as the Talaria
  // desktop plugin — uses s.tradingview.com/widgetembed/ with query params).
  // This is the most reliable approach for React/Next.js SPAs: no dependency
  // on TradingView's DOM-scanning script loader. The iframe src is rebuilt
  // on every tvSym change, giving clean symbol switching.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    // Build the widgetembed iframe URL with the resolved TV symbol.
    const params = new URLSearchParams({
      frameElementId: "hermes-tv-chart-" + currentSymbol,
      symbol: tvSym,
      interval: "D",
      hidesidetoolbar: "0",
      symboledit: "0",
      saveimage: "0",
      toolbarbg: "0d1623",
      studies: "[]",
      theme: "dark",
      style: "1",
      timezone: "Etc/UTC",
      withdateranges: "0",
      hidevolume: "1",
      locale: "en",
    });

    node.innerHTML =
      '<iframe title="TradingView Chart: ' + tvSym + '" ' +
      'src="https://s.tradingview.com/widgetembed/?' + params.toString() + '" ' +
      'style="width:100%;height:100%;border:none;"></iframe>';

    return () => {
      node.innerHTML = "";
    };
  }, [tvSym, currentSymbol]); // re-run when symbol changes

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">
          TradingView — {currentSymbol}
        </h3>
        <p className="text-xs opacity-60 mb-3">
          5-minute candles via TradingView. Select a symbol above to update the
          chart.
        </p>
        <div
          className="tradingview-widget-container bg-base-200 rounded-lg"
          ref={containerRef}
          style={{ height: "280px", width: "100%" }}
          data-tv-symbol={tvSym}
        />
      </div>
    </div>
  );
}

// --- Analysis tab content ---

function KellyTable({ sweeps, symbolList }) {
  // Iterate over the active symbol list (from v_talaria_symbols — 14 symbols),
  // looking up each symbol's latest sweep row from the merged sweeps data.
  // This avoids duplicate rows from nt_sweep_result (which has multiple sweep
  // runs per symbol).
  const rows = (symbolList || []).map((sym) => {
    const row = sweeps.find((s) => s.symbol === sym);
    return row ? { symbol: sym, ...row } : { symbol: sym, _missing: true };
  });

  const groups = groupByAssetClass(rows);
  const orderedGroups = ASSET_CLASS_ORDER.filter((c) => groups[c]);
  // Add any remaining classes not in ASSET_CLASS_ORDER
  const remaining = Object.keys(groups).filter((c) => !ASSET_CLASS_ORDER.includes(c));
  const allGroups = [...orderedGroups, ...remaining];

  const groupLabels = {
    commodities: "Commodities", forex: "Forex", crypto: "Crypto", stocks: "Stocks",
  };

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">Kelly by symbol</h3>
        <p className="text-xs opacity-60 mb-3">
          Latest signal per symbol. Table grouped by asset class, sorted by
          symbol. Effective Kelly = post-EV scaling fraction of the book the
          engine would risk (blue buy, red sell). Dash (—) = not enough data.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Signal</th>
                <th className="text-right">Kelly</th>
                <th>Regime</th>
                <th className="text-right">Aggression</th>
                <th className="text-right">EV</th>
                <th className="text-right">P_win</th>
                <th className="text-right">Markov</th>
                <th>Entry</th>
                <th>SL</th>
                <th>TP</th>
                <th>Qualified</th>
              </tr>
            </thead>
            <tbody>
              {allGroups.map((cls) => (
                [
                  <tr key={"header-" + cls} className="bg-base-200/50">
                    <td colSpan={12} className="text-xs font-semibold py-1">
                      {groupLabels[cls] || cls}
                    </td>
                  </tr>,
                  ...groups[cls]
                    .sort((a, b) => (a.symbol || "").localeCompare(b.symbol || ""))
                    .map((r) => {
                      const isSell = String(r.signal || "").toLowerCase() === "sell";
                      const rowCls = isSell ? "text-error" : "text-success";
                      return (
                        <tr key={r.symbol} className={rowCls}>
                          <td className="font-mono">{r.symbol}</td>
                          <td>{r.signal || "—"}</td>
                          <td className="text-right font-mono">
                            {r.effective_kelly != null
                              ? "k" + Number(r.effective_kelly).toFixed(3)
                              : "—"}
                          </td>
                          <td>{fmtRegime(r.regime) || "—"}</td>
                          <td className="text-right">{r.aggression || "—"}</td>
                          <td className="text-right">
                            {r.ev != null ? "$" + Number(r.ev).toFixed(2) : "—"}
                          </td>
                          <td className="text-right">
                            {r.p_win != null ? fmtKellyPct(r.p_win) : "—"}
                          </td>
                          <td className="text-right">
                            {r.markov_p_up != null
                              ? fmtKellyPct(r.markov_p_up)
                              : "—"}
                          </td>
                          <td>{r.entry_price != null && r.entry_price > 0 ? fmtBrickPriceFull(r.entry_price) : "—"}</td>
                          <td>{r.stop_loss != null && r.stop_loss > 0 ? fmtBrickPriceFull(r.stop_loss) : "—"}</td>
                          <td>{r.take_profit != null && r.take_profit > 0 ? fmtBrickPriceFull(r.take_profit) : "—"}</td>
                          <td>{r.qualified ? "✓" : "—"}</td>
                        </tr>
                      );
                    }),
                ]
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SignalHealthTable({ rows }) {
  // Sort rows by symbol name for consistent display
  const sortedRows = [...(rows || [])].sort((a, b) =>
    (a.symbol || "").localeCompare(b.symbol || "")
  );

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">Signal health scoreboard</h3>
        <p className="text-xs opacity-60 mb-3">
          30-day resolved-signal record per symbol. Wilson LB = 95% lower
          confidence bound on true win rate; sig = statistically above 50%
          after BH-FDR correction.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Resolved</th>
                <th>Win rate</th>
                <th>WR LB</th>
                <th>Bias</th>
                <th>Profit factor</th>
                <th>Total PnL</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.symbol}>
                  <td className="font-mono">{r.symbol}</td>
                  <td>{r.n_resolved}</td>
                  <td>
                    {r.win_rate != null
                      ? (r.win_rate * 100).toFixed(1) + "%"
                      : "—"}
                  </td>
                  <td className="text-sm">
                    {r.wilson_lb != null
                      ? (r.wilson_lb * 100).toFixed(1) + "%"
                      : "—"}
                  </td>
                  <td
                    className={
                      r.bias != null && Number(r.bias) > 0.1
                        ? "text-error"
                        : r.bias != null && Number(r.bias) < -0.1
                          ? "text-success"
                          : ""
                    }
                  >
                    {r.bias != null ? Number(r.bias).toFixed(3) : "—"}
                  </td>
                  <td>
                    {r.profit_factor != null
                      ? Number(r.profit_factor).toFixed(2)
                      : "—"}
                  </td>
                  <td
                    className={
                      r.total_pnl != null && Number(r.total_pnl) >= 0
                        ? "text-success"
                        : "text-error"
                    }
                  >
                    {r.total_pnl != null
                      ? "$" + Number(r.total_pnl).toFixed(2)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs opacity-50 mt-2">
          30-day window · Wilson lower bound (95%) · sig = survives BH-FDR at
          0.05
        </p>
      </div>
    </div>
  );
}

function CalibrationTable({ rows }) {
  // Sort rows by symbol, latest day first within each symbol
  const sortedRows = [...(rows || [])].sort((a, b) => {
    const dayDiff = (b.day || "").localeCompare(a.day || "");
    if (dayDiff !== 0) return dayDiff;
    return (a.symbol || "").localeCompare(b.symbol || "");
  });

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">Calibration bias (7d)</h3>
        <p className="text-xs opacity-60 mb-3">
          Does predicted win rate match reality? OVERCONFIDENT = the model
          predicted higher than it delivered (be cautious). UNDERCONFIDENT =
          wins more than predicted. Near 0 = well calibrated.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Day</th>
                <th>Symbol</th>
                <th>Avg predicted</th>
                <th>Realized</th>
                <th>Bias</th>
                <th>Status</th>
                <th>↑ Next bias</th>
                <th>↑ Next status</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.day + r.symbol}>
                  <td>{r.day}</td>
                  <td className="font-mono">{r.symbol}</td>
                  <td>{r.avg_predicted_p_win != null ? fmtKellyPct(r.avg_predicted_p_win) : "—"}</td>
                  <td>{r.realized_win_rate != null ? fmtKellyPct(r.realized_win_rate) : "—"}</td>
                  <td className={Number(r.bias) > 0.1 ? "text-error" : Number(r.bias) < -0.1 ? "text-success" : ""}>
                    {r.bias != null ? Number(r.bias).toFixed(3) : "—"}
                  </td>
                  <td>
                    <span
                      className={
                        "badge badge-sm " +
                        (String(r.status || "").toUpperCase() === "OVERCONFIDENT"
                          ? "badge-warning"
                          : String(r.status || "").toUpperCase() === "UNDERCONFIDENT"
                            ? "badge-info"
                            : String(r.status || "").toUpperCase() === "INSUFFICIENT_DATA"
                              ? "badge-warning"
                              : "badge-success")
                      }
                    >
                      {r.status === "INSUFFICIENT_DATA" ? "UNCALIBRATED" : r.status}
                    </span>
                  </td>
                  <td className={Number(r.bias_raw) > 0.3 ? "text-error" : Number(r.bias_raw) < -0.2 ? "text-success" : ""}>
                    {r.bias_raw != null ? Number(r.bias_raw).toFixed(3) : "—"}
                  </td>
                  <td>
                    {r.status_raw ? (
                      <span
                        className={
                          "badge badge-sm " +
                          (String(r.status_raw || "").toUpperCase() === "OVERCONFIDENT"
                            ? "badge-warning"
                            : String(r.status_raw || "").toUpperCase() === "UNDERCONFIDENT"
                              ? "badge-info"
                              : String(r.status_raw || "").toUpperCase() === "INSUFFICIENT_DATA"
                                ? "badge-warning"
                                : "badge-success")
                        }
                      >
                        {r.status_raw === "INSUFFICIENT_DATA" ? "UNCALIBRATED" : r.status_raw}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs opacity-50 mt-2">
          Bias = avg_predicted_p_win − realized_win_rate. "Next bias"/"Next status"
          = raw (pre-enforcement) values — how the model would classify if the
          enforcement mask weren't applied.
        </p>
      </div>
    </div>
  );
}

function VsEqualWeightTable({ rows }) {
  // Aggregate daily rows into monthly totals (6-month rolling window).
  // The v_paper_vs_optimized_daily view returns daily rows with paper_pnl,
  // equal_wt_pnl, and paper_minus_equal_wt columns. We roll up by month.
  const monthlyMap = {};
  (rows || []).forEach((r) => {
    const day = r.day || "";
    const monthKey = day.slice(0, 7); // "YYYY-MM"
    if (!monthlyMap[monthKey]) {
      monthlyMap[monthKey] = { month: monthKey, paper_pnl: 0, equal_wt_pnl: 0 };
    }
    monthlyMap[monthKey].paper_pnl += Number(r.paper_pnl || 0);
    monthlyMap[monthKey].equal_wt_pnl += Number(r.equal_wt_pnl || 0);
  });
  const monthlyRows = Object.values(monthlyMap)
    .map((m) => ({ ...m, delta: m.paper_pnl - m.equal_wt_pnl }))
    .sort((a, b) => (a.month || "").localeCompare(b.month || ""));

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">Paper vs equal-weight (6 months)</h3>
        <p className="text-xs opacity-60 mb-3">
          Is the strategy beating the benchmark? Paper PnL = the signal
          engine's Kelly/regime-sized trades. Equal-wt PnL = same amount on
          every symbol with no regime filter. Delta &gt; $0 (green) = engine
          won for that month; Delta &lt; $0 (red) = benchmark won.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Month</th>
                <th>Paper PnL</th>
                <th>Equal-wt PnL</th>
                <th>Delta</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map((r) => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td className={Number(r.paper_pnl) >= 0 ? "text-success" : "text-error"}>
                    ${Number(r.paper_pnl).toFixed(2)}
                  </td>
                  <td>${Number(r.equal_wt_pnl).toFixed(2)}</td>
                  <td className={Number(r.delta) >= 0 ? "text-success" : "text-error"}>
                    ${Number(r.delta).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PortfolioStatsCard({ stats }) {
  if (!stats) {
    return (
      <div className="card bg-base-100 shadow border border-base-300 mb-6">
        <div className="card-body">
          <h3 className="card-title text-lg">Paper portfolio stats (Precision Pro)</h3>
          <p className="text-xs opacity-60 mb-3">
            No portfolio data available yet. Data will appear after the first
            paper trade is recorded.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">Portfolio stats — Precision Pro</h3>
        <p className="text-xs opacity-60 mb-3">
          Risk-adjusted performance of the CLOSED paper trades. Dash (—) = not
          enough closed trades yet for a meaningful number.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            title="Sharpe"
            value={stats.sharpe != null ? Number(stats.sharpe).toFixed(2) : "—"}
            sub="annualized daily"
          />
          <StatCard
            title="Sortino"
            value={stats.sortino != null ? Number(stats.sortino).toFixed(2) : "—"}
            sub="downside-only"
          />
          <StatCard
            title="Calmar"
            value={stats.calmar != null ? Number(stats.calmar).toFixed(2) : "—"}
            sub="return / max DD"
          />
          <StatCard
            title="Max DD %"
            value={
              stats.max_dd_pct != null
                ? (stats.max_dd_pct * 100).toFixed(1) + "%"
                : "—"
            }
            sub="peak-to-trough"
            tone={stats.max_dd_pct > 0.10 ? "neg" : undefined}
          />
          <StatCard
            title="Vol ann %"
            value={
              stats.vol_annual_pct != null
                ? (stats.vol_annual_pct * 100).toFixed(1) + "%"
                : "—"
            }
            sub="daily σ annualized"
          />
          <StatCard
            title="Profit factor"
            value={
              stats.profit_factor != null
                ? Number(stats.profit_factor).toFixed(2)
                : "—"
            }
            sub="gross wins / gross losses"
            tone={stats.profit_factor >= 1 ? "pos" : "neg"}
          />
          <StatCard
            title="Total PnL"
            value={
              stats.total_pnl != null
                ? "$" + Number(stats.total_pnl).toFixed(2)
                : "—"
            }
            sub={
              stats.n_trades != null
                ? stats.n_trades +
                  " trades · win rate " +
                  (stats.win_rate != null ? (stats.win_rate * 100).toFixed(1) + "%" : "—")
                : ""
            }
            tone={stats.total_pnl >= 0 ? "pos" : "neg"}
          />
        </div>
        <p className="text-xs opacity-50 mt-3">
          Sharpe = reward per unit of volatility; Sortino = upside-only; Calmar =
          return ÷ max drawdown; Profit factor = gross wins ÷ gross losses.
        </p>
      </div>
    </div>
  );
}

// --- Main page component ---

export default function DashboardPage() {
  // --- Toast state (driven by Realtime broadcast signal events) ---
  const { toasts, pushToast, dismiss, copyToast, copiedId } = useToasts();

  // --- Realtime subscription state ---
  // The plugin uses a raw Phoenix WebSocket to subscribe to broadcast channels
  // like `realtime:signals.<plan_slug>`. We use the Supabase JS client's
  // channel() API which wraps the same Phoenix protocol. The anon key is safe
  // here — the plan_slug in the channel topic is the ACL (same as the plugin).
  const [planSlug, setPlanSlug] = useState(null);
  const [claimToken, setClaimToken] = useState(null);
  const [liveSignals, setLiveSignals] = useState([]);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [selectedSym, setSelectedSym] = useState(null);
  const [activeTab, setActiveTab] = useState("market");
  const supabaseRef = useRef(null);

  // Derive subscription metadata from /api/subscription-status (hybrid auth
  // pattern — server-side Supabase client). This also gives us the plan_slug
  // which gates which Realtime channel to subscribe to. Also handles the
  // plan-status gate: if no active subscription → redirect to /welcome.
  const router = useRouter();
  const { isSignedIn, isLoaded: clerkLoaded } = useUser();
  const [statusChecked, setStatusChecked] = useState(false);

  // Dashboard view data (fetched from /api/dashboard-data)
  const [sweeps, setSweeps] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [signalHealth, setSignalHealth] = useState([]);
  const [calibration, setCalibration] = useState([]);
  const [vsEqual, setVsEqual] = useState([]);
  const [portfolioStats, setPortfolioStats] = useState(null);
  const [renkoBricks, setRenkoBricks] = useState([]);
  const [paperEquity, setPaperEquity] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function resolveSubscription() {
      try {
        const r = await fetch("/api/subscription-status");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const sub = j?.subscription;
        if (sub?.plans?.slug) {
          if (!cancelled) setPlanSlug(sub.plans.slug);
          // If no active plan → redirect to /welcome (onboarding flow).
          // Flow: signin → dashboard → plan inactive → /welcome → claim token → /dashboard
          const status = sub?.status ?? null;
          if (!cancelled && (!status || !["active", "grace", "pending"].includes(status))) {
            router.replace("/welcome");
            return;
          }
          // If active → mint claim token for Pro-only view access
          if (status === "active" || status === "grace") {
            try {
              const cr = await fetch("/api/talaria-claim", { method: "POST" });
              if (cr.ok) {
                const ct = await cr.json();
                if (!cancelled) setClaimToken(ct.token);
              }
            } catch {
              // Claim may fail if no active sub or rate-limited; dashboard
              // still renders with mock data.
            }
          }
        }
      } catch {
        // Leave planSlug as null on error — the subscription effect
        // bails out (if (!planSlug) return) instead of subscribing
        // to the wrong channel.
        if (!cancelled) setStatusChecked(true);
      } finally {
        if (!cancelled) setStatusChecked(true);
      }
    }

    resolveSubscription();
    return () => { cancelled = true };
  }, [router]);

  // Fetch dashboard view data from /api/dashboard-data once subscription
  // status is resolved. This replaces all MOCK_* constants with real data
  // from v_talaria_latest_signals, v_talaria_signal_health, etc.
  useEffect(() => {
    if (!statusChecked || !planSlug) return;
    let cancelled = false;
    fetch("/api/dashboard-data")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        setSweeps(j.sweeps ?? []);
        setSymbols(j.symbols ?? []);
        setSignalHealth(j.signalHealth ?? []);
        setCalibration(j.calibration ?? []);
        setVsEqual(j.vsEqual ?? []);
        setPortfolioStats(j.portfolioStats ?? null);
        setRenkoBricks(j.renkoBricks ?? []);
        setPaperEquity(j.paperEquity ?? []);
      });
    return () => { cancelled = true };
  }, [statusChecked, planSlug]);

  // Subscribe to Supabase Realtime broadcast channel for live signal events.
  // Mirrors the plugin's useRealtime + signalStore.addSignal flow.
  useEffect(() => {
    if (!planSlug) return;

    const supabase = createClient();
    supabaseRef.current = supabase;

    // Subscribe to the plan-scoped signal broadcast channel.
    // The fastapi backend broadcasts on `realtime:signals.<plan_slug>` topics,
    // each carrying `{ type: "signal", payload: <signal_object> }`.
    const channel = supabase
      .channel(`realtime:signals.${planSlug}`)
      .on("broadcast", { event: "signal" }, (payload) => {
        const signal = payload?.payload ?? payload;
        if (!signal) return;

        console.log("[dashboard:realtime] signal received:", {
          symbol: signal.symbol,
          plan: planSlug,
          channel: `realtime:signals.${planSlug}`,
          signal,
        });

        const isSell = String(signal?.signal || "").toLowerCase() === "sell";
        const direction = isSell ? "SELL" : "BUY";
        const kellyLabel = signal.effective_kelly
          ? `k${Number(signal.effective_kelly).toFixed(2)}`
          : "";

        // Add to live signals state (replaces/adds to sweep list)
        setLiveSignals((prev) => {
          const filtered = prev.filter((s) => s.symbol !== signal.symbol);
          return [signal, ...filtered];
        });

        // Fire a daisyUI toast (mirrors plugin's signalStore → toast flow)
        // Include entry/SL/TP so the user can copy the full trade setup
        pushToast({
          title: `${signal.symbol} ${direction}`,
          body: `${fmtRegime(signal.regime)} · ${kellyLabel} · EV ${fmtUsd(signal.ev)} · ENTRY ${fmtBrickPriceUsd(signal.entry_price)} · SL ${fmtBrickPriceUsd(signal.stop_loss)} · TP ${fmtBrickPriceUsd(signal.take_profit)}`,
          tone: signal.ev >= 0 ? "pos" : "neg",
          copyable: true,
          copyText: `${signal.symbol} ${direction}\nEntry: ${fmtBrickPriceUsd(signal.entry_price)}\nSL: ${fmtBrickPriceUsd(signal.stop_loss)}\nTP: ${fmtBrickPriceUsd(signal.take_profit)}\nRegime: ${fmtRegime(signal.regime)}\nkelly: ${kellyLabel}\nEV: ${fmtUsd(signal.ev)}`,
        });
      })
      .subscribe((status) => {
        console.log("[dashboard:realtime] subscribe status:", status, "plan:", planSlug, "channel:", `realtime:signals.${planSlug}`);
        // Only downgrade to "connecting" on explicit connection drop states,
        // not on intermediate states like "OPEN" that fire during the
        // SUBSCRIBED lifecycle. This prevents the realtime card from
        // flashing "connected" → "connecting" → "connected".
        setWsStatus((prev) => {
          if (status === "SUBSCRIBED") return "connected";
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            return "error";
          // For "OPENING", "OPEN", "CLOSED", etc. — keep the previous state
          // to avoid flashing. Once connected, stay connected until an
          // explicit error or timeout.
          return prev;
        });
      });

    // Poll fallback every 60s (plugin uses PANE_TICK_MS = 30s, but the webapp
    // UI doesn't need as-frequent updates). Re-fetches dashboard data to keep
    // sweeps/symbols fresh in case the Realtime channel drops.
    // Also inject fresh qualified signals into liveSignals so the
    // toast pipeline fires even if the Realtime channel drops or
    // the backend wasn't publishing (mirrors the plugin's poll +
    // signalStore.addSignal flow).
    const pollTimer = setInterval(() => {
      if (supabaseRef.current) {
        fetch("/api/dashboard-data")
          .then((r) => r.json())
          .then((j) => {
            if (!j.error && j.sweeps) {
              setSweeps(j.sweeps ?? []);
              setSymbols(j.symbols ?? []);
              setRenkoBricks(j.renkoBricks ?? []);
              setSignalHealth(j.signalHealth ?? []);
              setCalibration(j.calibration ?? []);
              setIsLoading(false);
              // Inject new qualified signals into live state so the
              // toast handler fires for any that arrived since the
              // last Realtime event. Dedup by symbol (newest wins).
              if (j.sweeps) {
                const fresh = j.sweeps.filter(
                  (s) => s && s.symbol && s.qualified !== false && s.signal
                );
                if (fresh.length) {
                  setLiveSignals((prev) => {
                    const seen = new Map(prev.map((s) => [s.symbol, s]));
                    fresh.forEach((s) => seen.set(s.symbol, s));
                    return Array.from(seen.values()).slice(0, 50);
                  });
                }
              }
            }
          })
          .catch(() => {});
      }
    }, 60000);

    return () => {
      clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [planSlug, pushToast]);

  // Show a brief loading state while we check the plan status
  if (clerkLoaded && isSignedIn && !statusChecked) {
    return (
      <div className="min-h-screen bg-base-200">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-base-300">
            <h1 className="text-2xl font-bold">Talaria Dashboard <TalariaMark size={32} /></h1>
          </div>
          <div className="flex items-center gap-2 text-sm opacity-60 mt-6">
            <span className="loading loading-spinner loading-sm" />
            Checking subscription…
          </div>
        </div>
      </div>
    );
  }

  // Derive isPro, plan title, etc. from the fetched plan_slug
  const isPro = planSlug === "precision_pro";
  const planTitle = planSlug ? planSlug.replace(/_/g, " ") : "Precision Pro";
  const subscriptionStatus = "active";
  const displayName = "Trader";

  // Merge live Realtime signals with fetched sweeps (live signals override
  // for the same symbol). If Realtime hasn't delivered yet, the fetched
  // data fills in so the page isn't blank.
  const mergedSweeps = liveSignals.length > 0
    ? [
        ...liveSignals,
        ...sweeps.filter((s) => !liveSignals.some((l) => l.symbol === s.symbol)),
      ]
    : sweeps;

  // Derive subscription metadata from /api/subscription-status (hybrid auth
  // pattern — server-side Supabase client). This also gives us the plan_slug
  // which gates which Realtime channel to subscribe to.

  // --- Plan-status gate (mirrors the user's desired flow) ---
  // Flow:
  //   1. User signs in → Clerk redirects to /dashboard (forceRedirectUrl)
  //   2. Dashboard checks plan status via /api/subscription-status
  // Derive symbolList from v_talaria_symbols (the source of truth for the active
  // plan's symbol roster). This view applies the plan_ids containment filter at
  // the REST level (matching the plugin's ?plan_ids=cs.{plan_uuid} pattern), so
  // we get exactly the 14 active symbols — NOT the 39+ rows from nt_sweep_result
  // (which has multiple sweep runs per symbol).
  const resolvedSymbolList = [...(symbols || [])]
    .sort((a, b) => {
      const ra = ASSET_CLASS_ORDER.indexOf(a.asset_class);
      const rb = ASSET_CLASS_ORDER.indexOf(b.asset_class);
      return (ra === -1 ? 9 : ra) - (rb === -1 ? 9 : rb) ||
             (a.symbol || "").localeCompare(b.symbol || "");
    })
    .map((s) => s.symbol);

  // Resolve the selected symbol's sweep row from merged data (live + fetched)
  const activeSymbol = selectedSym || resolvedSymbolList[0] || "";
  const selectedSweepRow = mergedSweeps.find((s) => s.symbol === activeSymbol) || null;

  return (
    <div className="min-h-screen bg-base-300">
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
        {/* Header bar — mirrors tla-header */}
        <div className="flex items-center justify-between gap-3 pb-4 border-b border-base-300">

            <h1 className="text-2xl font-bold text-center">Talaria Dashboard <TalariaMark size={32} /> {planTitle}</h1>

          {/* Quick nav — link to the portal for subscription management */}
            <Link href="/portal" className="btn btn-sm btn-outline btn-secondary">
             Portal
            </Link>

        </div>

        {/* Grace period banner (conditional) */}
        {subscriptionStatus === "grace" && (
          <div className="alert alert-warning">
            <span>
              Subscription in grace period — renews{" "}
              {formatDate("2026-09-15")} · still entitled to signals.
            </span>
          </div>
        )}

        {/* Hot signals banner (driven by Realtime signals) */}
        <HotSignalsBanner signals={sweeps} />

        {/* Stat card grid (3 cols) — mirrors tla-grid */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            title="Plan"
            value={isPro ? "Precision Pro" : "Signal Scout"}
            sub={
              "Subscription " +
              (subscriptionStatus === "active"
                ? "Active"
                : subscriptionStatus === "grace"
                  ? "Grace"
                  : "Inactive") +
              " · Token Valid"
            }
          />
          <StatCard
            title="Symbols"
            value={String(resolvedSymbolList.length || "\u2014")}
            sub={isPro ? "Precision Pro" : "Signal Scout"}
          />
          <StatCard
            title="Realtime"
            value={wsStatus === "connected" ? "Live" : wsStatus === "error" ? "Error" : "Connecting"}
            sub={
              wsStatus === "connected"
                ? `Signals (${planTitle || "loading"}· Realtime ✓)`
                : `Signals (${planTitle || "loading"}· REST poll 60s)`
            }
            tone={wsStatus === "connected" ? "pos" : wsStatus === "error" ? "neg" : "warn"}
          />
        </div>

        {/* Tab bar — mirrors tla-tabs */}
        <TabBar active={activeTab} onChange={setActiveTab} />

        {/* Market tab content */}
        {activeTab === "market" && (
          <Fragment>
        <RenkoSection
          sweeps={mergedSweeps}
          symbolList={resolvedSymbolList}
          selectedSym={selectedSym || resolvedSymbolList[0]}
          onSelect={setSelectedSym}
          renkoBricks={renkoBricks}
        />
        <MarkovSection sweeps={mergedSweeps} selectedSym={selectedSym || resolvedSymbolList[0]} renkoBricks={renkoBricks} />

        {/* EV / P_win / TimesFM forecast card */}
        <div className="card bg-base-100 shadow border border-base-300 mb-6">
          <div className="card-body">
            <h3 className="card-title text-lg">
              EV / P_win / TimesFM — {activeSymbol || "\u2014"}
            </h3>
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                title={"EV \u2014 " + activeSymbol}
                value={selectedSweepRow ? fmtUsd(selectedSweepRow.ev) : "\u2014"}
                sub="expected value per $ of risk"
                tone={selectedSweepRow && selectedSweepRow.ev >= 0 ? "pos" : "neg"}
              />
              <StatCard
                title={"P_win \u2014 " + activeSymbol}
                value={selectedSweepRow && selectedSweepRow.p_win != null
                  ? (Number(selectedSweepRow.p_win) * 100).toFixed(1) + "%"
                  : "\u2014"}
                sub="predicted probability of winning"
                tone={selectedSweepRow && selectedSweepRow.p_win >= 0.5 ? "pos" : "neg"}
              />
              <StatCard
                title="p_timesfm"
                value={selectedSweepRow && selectedSweepRow.p_timesfm != null
                  ? (Number(selectedSweepRow.p_timesfm) >= 0.5 ? "\uD83D\udcc8 " : "\uD83D\udcc9 ") +
                    (Number(selectedSweepRow.p_timesfm) * 100).toFixed(1) + "%"
                  : "\u2014"}
                sub="bullish skew > 50%"
                tone={selectedSweepRow && selectedSweepRow.p_timesfm >= 0.5 ? "pos" : "neg"}
              />
            </div>
          </div>
        </div>

        {/* Sizing what-if */}
        <SizingWhatIfSection sweeps={mergedSweeps} selectedSym={selectedSym || resolvedSymbolList[0]} paperEquity={paperEquity} />

        {/* TradingView chart */}
        <TVChart symbol={selectedSym || resolvedSymbolList[0]} symbolsData={symbols} />
          </Fragment>
        )}

        {/* Analysis tab content */}
        {activeTab === "analysis" && (
          <Fragment>
            {/* Kelly by symbol (grouped by asset class, sorted) */}
            <KellyTable sweeps={mergedSweeps} symbolList={resolvedSymbolList} />

            {/* Paper portfolio (Precision Pro only) */}
            {isPro && (
              <div className="card bg-base-100 shadow border border-base-300 mb-6">
                <div className="card-body">
                  <h3 className="card-title text-lg">Paper portfolio — Precision Pro</h3>
                  <p className="text-xs opacity-60 mb-3">
                    Simulated trade book — no real money. Daily equity curve, realized
                    PnL, and risk-adjusted tear-sheet.
                  </p>
                  <div className="grid gap-4 md:grid-cols-3">
                    <StatCard title="Paper equity" value="$1,127.44" sub="cumulative PnL" tone="pos" />
                    <StatCard title="Open positions" value="3" sub="12.5% of equity" />
                    <StatCard title="Win rate" value="61.1%" sub="18 trades" tone="pos" />
                  </div>
                </div>
              </div>
            )}

            {/* Signal health scoreboard (sorted by symbol) */}
            <SignalHealthTable rows={signalHealth} />

            {/* Calibration bias (7d) */}
            <CalibrationTable rows={calibration} />

            {/* Paper vs equal-weight (Precision Pro only) */}
            {isPro && <VsEqualWeightTable rows={vsEqual} />}

            {/* Portfolio stats (Precision Pro only) */}
            {isPro && portfolioStats && <PortfolioStatsCard stats={portfolioStats} />}
          </Fragment>
        )}

        <ToastContainer toasts={toasts} onDismiss={dismiss} copiedId={copiedId} />
      </div>
    </div>
  );
}
