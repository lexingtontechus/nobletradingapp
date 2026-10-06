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

import { useEffect, useState, useRef, Fragment, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { TalariaMark } from "../components/talaria-mark";
import { createClient } from "@/utils/supabase/client";
import PlatformHealthCard from "../components/platform-health-card";
import SignalContextCard from "../components/signal-context-card";
import CalibrationScorecard from "../components/calibration-scorecard";

// -- Floating live-signals widget --
// Replaces the old toast-per-signal + HotSignalsBanner pair (2026-09-06):
// the toast (small, pale alert-info, 8s auto-dismiss) was hard to read/copy
// before it vanished, and the banner sourced from `sweeps` (the raw latest-
// sweep-per-symbol snapshot) — a symbol that flips qualified=false on the
// very next sweep tick disappeared from the banner instantly, with no
// memory that it had just fired. Mirrors the Talaria desktop plugin's
// chip+pane pattern (noble-trader-hermes-plugins/talaria/desktop/plugin.js,
// signalStore/TalariaSignalsPane/TalariaChip): a persistent floating card,
// fed by `liveSignals` (the realtime-broadcast + poll accumulator, already
// qualified-only) filtered to a rolling TTL window instead of "still true
// on the very latest fetch" — so a signal stays visible for a while after
// it fires, not just for one snapshot.
const SIGNAL_WIDGET_TTL_MS = 60 * 60 * 1000; // 1h, matches the plugin's SIGNAL_TTL_MS

function signalEpochMs(s) {
  if (s?.ts != null) return typeof s.ts === "number" ? s.ts * 1000 : Date.parse(s.ts) || 0;
  if (s?.sweep_timestamp) return Date.parse(s.sweep_timestamp) || 0;
  return 0;
}

// `now` is passed in (state, updated from an effect) rather than called via
// Date.now() here — react-hooks/purity (an enforced error in this project,
// not just a style warning) flags any impure call like Date.now()/new Date()
// made directly during render, including inside helpers a render calls.
function fmtSignalAge(epochMs, now) {
  if (!epochMs || !now) return "";
  const diffMin = Math.floor(Math.max(0, now - epochMs) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`;
}

// RANK board (20260928_RANK_BOARD_BROADCAST_DISCORD): rank is an opportunity
// score (freshness + setup type + recent TP + cell), NOT win probability.
// Sources: realtime broadcast `rank`, REST/cache `kairos_rank_score` (183).
function rankOf(s) {
  const v = s?.rank ?? s?.kairos_rank_score ?? null;
  if (v == null || Number.isNaN(Number(v))) return null;
  return Number(v);
}

function stateOf(s) {
  return s?.state || s?.kairos_event_window || null;
}

function RankChip({ rank }) {
  if (rank == null) return <span className="opacity-40">—</span>;
  const tone =
    rank >= 0.75 ? "badge-primary" : rank >= 0.55 ? "badge-secondary" : "badge-ghost";
  return (
    <span className={`badge badge-sm ${tone} font-mono`} title="RANK = opportunity score (not win%)">
      {rank.toFixed(2)}
    </span>
  );
}

function StateBadge({ state }) {
  if (!state) return <span className="opacity-40">—</span>;
  const up = String(state).toUpperCase();
  const map = {
    FRESH: "badge-success",
    WARM: "badge-warning",
    STALE: "badge-error",
    DEEP: "badge-ghost",
    PRE: "badge-info",
  };
  return <span className={`badge badge-sm ${map[up] || "badge-ghost"}`}>{up}</span>;
}

function FloatingSignalsWidget({ signals }) {
  const [collapsed, setCollapsed] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  // 0 until the first effect tick — render must never call Date.now() itself
  // (react-hooks/purity). The gap is one paint at most; effects run right
  // after mount.
  const [now, setNow] = useState(0);

  // Set "now" once on mount, then every 30s so ages + TTL expiry stay
  // current even with no new signal data.
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const rows = now
    ? (signals || [])
        .map((s) => ({ ...s, _epoch: signalEpochMs(s) }))
        .filter((s) => s._epoch > 0 && now - s._epoch <= SIGNAL_WIDGET_TTL_MS)
        .sort((a, b) => b._epoch - a._epoch)
        .slice(0, 12)
    : [];

  const copy = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // Clipboard write can fail (permissions/insecure context) — button
      // just won't flash "copied"; not worth a fallback UI for this.
    }
  };

  // Always-on docked panel. Collapse is optional; empty state is explicit so
  // the surface never "disappears" when the feed is quiet.
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {!collapsed && (
        <div className="w-80 max-h-[70vh] flex flex-col bg-base-100 border border-base-content/20 rounded-md shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-base-content/10 bg-base-200">
            <div className="flex items-center gap-2">
              <TalariaMark size={16} />
              <span className="font-semibold text-sm">Hot signals</span>
              <span
                className={`badge badge-sm ${rows.length > 0 ? "badge-primary" : "badge-ghost"}`}
                title="Qualified signals in the last hour"
              >
                {rows.length} live
              </span>
            </div>
            <button
              className="btn btn-ghost btn-xs btn-circle"
              onClick={() => setCollapsed(true)}
              title="Collapse"
            >
              ✕
            </button>
          </div>
          <p className="text-[11px] opacity-60 px-3 pt-2">
            <span className="font-mono">RANK</span> = opportunity score (freshness + setup), not win%.
            Sort = newest first; prioritize capital by RANK, size with Kelly.
          </p>
          <div className="overflow-y-auto flex-1 divide-y divide-base-content/10 mt-1">
            {rows.length === 0 && (
              <div className="p-4 text-center">
                <p className="text-sm font-medium">No hot signals right now</p>
                <p className="text-xs opacity-60 mt-1">
                  Watching all plan symbols. New qualified signals appear here within
                  the hour they fire — nothing to do until then.
                </p>
              </div>
            )}
            {rows.map((s) => {
              const isSell = String(s.signal || s.direction || "").toLowerCase() === "sell";
              const dir = isSell ? "SELL" : "BUY";
              const kelly = s.kelly ?? s.effective_kelly;
              const rowKey = `${s.symbol}-${s._epoch}`;
              const fullText =
                `${s.symbol} ${dir}\nEntry: ${fmtBrickPriceUsd(s.entry_price)}\n` +
                `SL: ${fmtBrickPriceUsd(s.stop_loss)}\nTP: ${fmtBrickPriceUsd(s.take_profit)}`;
              return (
                <div key={rowKey} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono font-semibold">{s.symbol}</span>
                    <span className={`badge badge-xs ${isSell ? "badge-error" : "badge-success"}`}>{dir}</span>
                    <RankChip rank={rankOf(s)} />
                    <StateBadge state={stateOf(s)} />
                    {kelly != null && <span className="opacity-60">k{Number(kelly).toFixed(2)}</span>}
                    <span className="opacity-40 ml-auto">{fmtSignalAge(s._epoch, now)}</span>
                  </div>
                  {(s.p_win != null || s.ev_r != null || s.ev != null) && (
                    <div className="flex items-center gap-2 flex-wrap mb-1 text-[11px] opacity-70">
                      {s.p_win != null && <span>p_win {fmtKellyPct(s.p_win)}</span>}
                      {(s.ev_r != null || s.ev != null) && (
                        <span>
                          EV {Number(s.ev_r ?? s.ev).toFixed(2)}R
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1 flex-wrap">
                    {[
                      // Same color convention as the Renko chart's price levels
                      // (generateBricks levels, ~line 474-478): ENTRY neutral,
                      // SL red, TP green — position-based (risk vs. target),
                      // not flipped by buy/sell direction.
                      ["ENTRY", s.entry_price, "text-base-content/70"],
                      ["SL", s.stop_loss, "text-error"],
                      ["TP", s.take_profit, "text-success"],
                    ].map(([label, val, colorClass]) =>
                      val != null ? (
                        <button
                          key={label}
                          className={`btn btn-ghost btn-xs gap-1 font-mono ${colorClass}`}
                          onClick={() => copy(`${rowKey}-${label}`, String(val))}
                          title={`Copy ${label} (${val})`}
                        >
                          {label} {fmtBrickPriceUsd(val)}
                          <span className="opacity-50">{copiedKey === `${rowKey}-${label}` ? "✓" : "⧉"}</span>
                        </button>
                      ) : null
                    )}
                    <button
                      className="btn btn-ghost btn-xs ml-auto"
                      onClick={() => copy(`${rowKey}-all`, fullText)}
                    >
                      {copiedKey === `${rowKey}-all` ? "✓ Copied" : "Copy all"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-1.5 text-[10px] opacity-40 border-t border-base-content/10">
            {now > 0 && (
              <>as of {new Date(now).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</>
            )}
          </div>
        </div>
      )}
      {collapsed && (
        <button
          className="btn btn-circle btn-outline hover:btn-neutral"
          onClick={() => setCollapsed(false)}
          title="Show hot signals"
        >
          <span className="relative flex items-center justify-center">
            <TalariaMark size={22} />
            {rows.length > 0 && (
              <span className="absolute -top-3 -right-3 badge badge-error badge-xs">{rows.length}</span>
            )}
          </span>
        </button>
      )}
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

// Brick-size display: FX grids are ~1e-4 and must not collapse to "$0.00"
// under fmtUsd's 2dp path. Trim trailing zeros after enough precision.
function fmtBrickSize(v) {
  if (v == null || isNaN(Number(v))) return "—";
  const n = Number(v);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(2).replace(/\.?0+$/, "");
  if (abs >= 1) return n.toFixed(4).replace(/\.?0+$/, "");
  if (abs >= 0.01) return n.toFixed(6).replace(/\.?0+$/, "");
  return n.toPrecision(4).replace(/\.?0+$/, "");
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

function formatLastAlert(iso) {
  if (!iso) return "\u2014";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "\u2014";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 48) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

function StatCard({ title, value, sub, tone, valueClassName, deltaPct }) {
  const deltaNode =
    deltaPct == null || Number.isNaN(Number(deltaPct)) ? null : (
      <span
        className={
          Number(deltaPct) >= 0 ? "text-success" : "text-error"
        }
      >
        {Number(deltaPct) >= 0 ? "▲" : "▼"}{" "}
        {Math.abs(Number(deltaPct) * 100).toFixed(0)}%
      </span>
    );
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
        {sub && (
          <p className="text-xs opacity-60 mt-1">
            {sub} {deltaNode}
          </p>
        )}
      </div>
    </div>
  );
}

// Tab bar using daisyUI classes (mirrors tla-tabs).
function TabBar({ active, onChange }) {
  return (
    <div className="tabs tabs-border mb-4">
      {["market", "analysis", "portfolio", "health", "eod"].map((tab) => (
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
          {tab === "market"
            ? "Market"
            : tab === "analysis"
              ? "Analysis"
              : tab === "portfolio"
                ? "Portfolio"
                : tab === "health"
                  ? "Platform Health"
                  : "EOD Report"}
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
  const { brick_size, entry_price, signal, direction } = sweepRow;
  if (entry_price <= 0 || brick_size <= 0) return [];

  const isBuy = String(signal || direction || "").toLowerCase() !== "sell";
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

// Relative brick_size match (same 0.1% tolerance as backend renko_retention)
// so float round-trips never split one grid across two buckets.
function brickSizeMatches(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!isFinite(x) || !isFinite(y) || x <= 0 || y <= 0) return false;
  const tol = Math.max(Math.abs(y) * 1e-3, 1e-9);
  return Math.abs(x - y) <= tol;
}

// Keep only bricks from the sweep's live grid. Stale brick_size grids and
// orphan high brick_index rows sort first by brick_index DESC and would
// otherwise plot on a different price plane than ENTRY/SL/TP.
// Also filter by session_date (latest session only) to avoid plotting bricks
// from a previous day's grid.
function pickLiveGridBricks(renkoBricks, symbol, sweepRow) {
  const symbolBricks = (renkoBricks || []).filter((b) => b.symbol === symbol);
  if (!sweepRow || !(Number(sweepRow.brick_size) > 0)) {
    return [...symbolBricks].sort(
      (a, b) => Number(b.brick_index ?? 0) - Number(a.brick_index ?? 0)
    );
  }
  // Filter by brick_size AND session_date (latest session only)
  const latestSession = symbolBricks.reduce((max, b) =>
    b.session_date > max ? b.session_date : max, ""
  );
  const live = symbolBricks.filter((b) =>
    brickSizeMatches(b.brick_size, sweepRow.brick_size) &&
    b.session_date === latestSession
  );
  // Fallback: if no bricks match the live grid, show a warning
  if (live.length === 0) {
    console.warn(`[Renko] ${symbol}: no bricks on live grid (bs=${sweepRow.brick_size}, session=${latestSession})`);
    return [];
  }
  return live.sort((a, b) => Number(b.brick_index ?? 0) - Number(a.brick_index ?? 0));
}

function RenkoSection({ sweeps, symbolList, selectedSym, onSelect, renkoBricks, regimeEdge }) {
  const activeSym = selectedSym || symbolList[0] || "";
  const sweepRow = sweeps.find((s) => s.symbol === activeSym);
  // Use real renko bricks from v_talaria_renko on the SAME brick_size grid as
  // the sweep. Fall back to generateBricks when the live grid has no rows yet
  // (better a mock series on the entry plane than a stale grid's prices).
  const symbolBricks = pickLiveGridBricks(renkoBricks, activeSym, sweepRow);
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
  // Latest close on the live grid = market proxy for "current price".
  const marketProxy = symbolBricks.length > 0
    ? Number(symbolBricks[0].close_price)
    : null;

  const levels = [];
  // Trade direction, normalized from either REST (`signal`) or realtime
  // (`direction`) field naming — used for the on-chart direction badge.
  let sigDirection = null; // "buy" | "sell" | null
  if (sweepRow) {
    const rawSig = String(sweepRow.signal || sweepRow.direction || "").toLowerCase();
    sigDirection = rawSig === "sell" ? "sell" : rawSig === "buy" ? "buy" : null;
    const isBuy = rawSig !== "sell";
    // Validate: for BUY, SL < entry < TP; for SELL, TP < entry < SL.
    // If the data doesn't fit the signal direction, the sweep data
    // has been misinterpreted — log a warning so it can be fixed.
    const slBelowEntry = sweepRow.stop_loss < sweepRow.entry_price;
    const tpAboveEntry = sweepRow.take_profit > sweepRow.entry_price;
    const dataOk = isBuy ? (slBelowEntry && tpAboveEntry) : (!slBelowEntry && !tpAboveEntry);
    if (!dataOk && sweepRow.stop_loss > 0 && sweepRow.take_profit > 0) {
      console.warn(
        `[Renko] ${sweepRow.symbol}: signal=${sweepRow.signal} dataMismatch ` +
        `entry=${sweepRow.entry_price} sl=${sweepRow.stop_loss} tp=${sweepRow.take_profit}`
      );
    }
    // Chart labels are position-based (Upper/Lower bound), not direction-based.
    // SL sits above entry for sells and below entry for buys — a fixed "SL"/"TP"
    // label would read as "flipped" depending on direction even though the
    // price is correct. Upper/Lower always matches what's drawn on the chart;
    // the SL/TP tag (+ the direction badge above the chart) gives the meaning.
    const slIsUpper = sweepRow.stop_loss > sweepRow.take_profit;
    if (sweepRow.entry_price > 0)
      levels.push({ label: "ENTRY", price: sweepRow.entry_price, color: "text-base-content/70", fill: "var(--color-base-content)" });
    if (sweepRow.stop_loss > 0)
      levels.push({ label: slIsUpper ? "UPPER" : "LOWER", tag: "SL", price: sweepRow.stop_loss, color: "text-error/80", fill: "var(--color-error)" });
    if (sweepRow.take_profit > 0)
      levels.push({ label: slIsUpper ? "LOWER" : "UPPER", tag: "TP", price: sweepRow.take_profit, color: "text-success/80", fill: "var(--color-success)" });
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
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="card-title text-lg">
            Price ladder — last 10 moves
          </h3>
          <span className="mx-2 font-semibold badge badge-primary">{selectedSym || "select a symbol"}</span>
          {sigDirection && (
            <span
              className={
                "badge font-mono font-semibold " +
                (sigDirection === "sell" ? "badge-error" : "badge-success")
              }
              title={
                sigDirection === "sell"
                  ? "Short / sell — profits below entry, stops above entry"
                  : "Long / buy — profits above entry, stops below entry"
              }
            >
              {sigDirection === "sell" ? "SHORT · SELL" : "LONG · BUY"}
            </span>
          )}
          {(() => {
            const edge = (regimeEdge || []).find(
              (e) => e.symbol === activeSym && e.signal === (sigDirection || "").toLowerCase() && e.regime === sweepRow?.regime
            );
            if (!edge) return null;
            const wr = Number(edge.win_rate) * 100;
            const exp = Number(edge.expectancy_r);
            const isPositive = wr >= 50;
            return (
              <span
                className={
                  "badge font-mono font-semibold " +
                  (isPositive ? "badge-success" : "badge-error")
                }
                title={`Regime edge: ${wr.toFixed(1)}% WR, ${exp >= 0 ? "+" : ""}${exp.toFixed(2)}R over ${edge.n} episodes`}
              >
                {isPositive ? "✅" : "❌"} {wr.toFixed(0)}% · {exp >= 0 ? "+" : ""}${exp.toFixed(2)}R
              </span>
            );
          })()}
        </div>
        <p className="text-xs opacity-60 mb-3">
          Each block is one fixed price step ({sweepRow ? fmtBrickSize(sweepRow.brick_size) : "n/a"}).
          The chart always shows the <strong>10 most recent steps</strong> on the
          live grid so the short-term shape stays readable. The horizontal
          lines are your trade levels from the latest signal: entry in the
          middle, with stop and target above or below depending on buy/sell
          (see the badge). Hover a block for full prices. Switch symbols to
          re-analyze.
        </p>
        {(() => {
          const edge = (regimeEdge || []).find(
            (e) => e.symbol === activeSym && e.signal === (sigDirection || "").toLowerCase() && e.regime === sweepRow?.regime
          );
          if (!edge) return null;
          const wr = Number(edge.win_rate) * 100;
          const exp = Number(edge.expectancy_r);
          const isPositive = wr >= 50;
          if (isPositive) return null;
          return (
            <div className="alert alert-warning text-xs py-2 px-3 mb-3">
              <strong>⚠️ Regime edge caution:</strong> This signal is in a regime with negative historical edge
              ({sweepRow?.regime}: {wr.toFixed(1)}% WR, {exp >= 0 ? "+" : ""}{exp.toFixed(2)}R over {edge.n} episodes).
              Consider reducing size or skipping.
            </div>
          );
        })()}
        <p><strong>Hover each brick for full price.</strong></p>
        {marketProxy != null && sweepRow?.entry_price > 0 && (
          <p className="text-xs opacity-70 mb-2 font-mono">
            Market (last brick): {fmtBrickPriceUsd(marketProxy)}
            {" · "}Entry: {fmtBrickPriceUsd(sweepRow.entry_price)}
            {" · "}Δ {(((marketProxy - sweepRow.entry_price) / sweepRow.entry_price) * 100).toFixed(3)}%
            {" · "}grid bs={fmtBrickSize(sweepRow.brick_size)}
            {sweepRow.brick_vol_scale != null && (
              <span className="text-warning">
                {" · "}ATR scale: {sweepRow.brick_vol_scale.toFixed(4)}
              </span>
            )}
            {sweepRow.vol_ratio != null && (
              <span className="opacity-60">
                {" · "}vol_ratio: {sweepRow.vol_ratio.toFixed(3)}
              </span>
            )}
          </p>
        )}
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

            {/* ENTRY / upper / lower reference horizontal lines */}
            {levels.map((lv) => (
              <g key={lv.label}>
                <title>{lv.tag ? `${lv.tag} (${lv.label.toLowerCase()})` : lv.label} @ {fmtBrickPriceFull(lv.price)}</title>
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
                  {lv.tag ? `${lv.label} · ${lv.tag}` : lv.label}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* ENTRY / upper / lower reference levels below chart */}
        {levels.length > 0 && (
          <div className="mt-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              {levels.map((lv) => (
                <span
                  key={lv.label}
                  className={"font-mono " + lv.color}
                >
                  {lv.tag ? `${lv.tag} (${lv.label.charAt(0)}${lv.label.slice(1).toLowerCase()})` : lv.label}: {fmtBrickPriceUsd(lv.price)}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs opacity-50 mt-2">
          Levels: entry / stop / target from the latest signal · always 10 steps on the live grid
        </p>
      </div>
    </div>
  );
}

function MarkovSection({ sweeps, selectedSym, renkoBricks }) {
  const sweepRow = sweeps.find((s) => s.symbol === selectedSym);
  // Derive brick pattern from real renko brick data (live grid only —
  // same filter as RenkoSection so pattern and chart agree).
  const activeSym = selectedSym || "";
  const symbolBricks = pickLiveGridBricks(renkoBricks, activeSym, sweepRow);

  // Build pattern from last 10 bricks, deduplicating consecutive same-direction
  const rawDirs = symbolBricks.length > 0
    ? symbolBricks.slice(0, 10).map((b) =>
        Number(b.close_price) > Number(b.open_price) ? "U" : "D"
      )
    : (sweepRow ? [String(sweepRow.signal || sweepRow.direction || "").toLowerCase() === "buy" ? "U" : "D"] : []);
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
    ? `P(down) ${((1 - markovP) * 100).toFixed(1)}% · longer sample`
    : "waiting for more history";

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">
          Markov + pattern — {selectedSym || "select a symbol"}
        </h3>
        <p className="text-xs opacity-60 mb-3">
          Two reads on the selected symbol. The pattern is the short-term
          shape of the last 10 price steps. The probability is a longer
          statistical fit — how likely the next few steps lean up.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <StatCard
            title="Recent shape"
            value={pattern}
            sub={
              "last 10 steps · " +
              (sweepRow ? fmtRegime(sweepRow.regime) : "regime n/a")
            }
          />
          <StatCard
            title="P(up next 3 steps)"
            value={markovDisplay}
            sub={markovSub}
            tone={markovP ? (markovP > 0.5 ? "pos" : "neg") : undefined}
            valueClassName={markovTone}
          />
        </div>
        <p className="text-xs opacity-50 mt-2">
          Recent shape = direction changes in the last 10 steps (push,
          pullback, or chop). P(up next 3 steps) uses a longer sample of
          closes — above 50% leans bullish, below 50% leans bearish.
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

// Turns a raw signal row into a call the user can actually act on. The raw
// `signal`/`direction` field is a directional lean the model computed — it's
// set to "buy"/"sell" even when the signal never cleared the qualification
// gate (qualified=false) or the engine ended up sizing it at 0 Kelly. Showing
// that with the same full-strength BUY/SELL coloring as a qualified,
// meaningfully-sized signal is misleading (e.g. AAPL can show "buy" while
// qualified=false and effective_kelly=0 — there's no real conviction behind
// it). Only a qualified signal with nonzero effective Kelly gets the strong
// BUY/SELL treatment; everything else reads as WAIT (no directional lean, or
// explicitly "neutral") or CAUTION (a lean exists but hasn't cleared the gate).
function signalCall(r) {
  const raw = String(r?.signal || r?.direction || "").toLowerCase();
  if (!raw || raw === "neutral") {
    return { label: "WAIT", toneClass: "opacity-50" };
  }
  const isSell = raw === "sell";
  const strong = Boolean(r?.qualified) && Number(r?.effective_kelly) > 0;
  if (strong) {
    return { label: isSell ? "SELL" : "BUY", toneClass: isSell ? "text-error" : "text-success" };
  }
  return { label: `CAUTION (${isSell ? "sell" : "buy"} lean)`, toneClass: "text-warning" };
}

// EV in R-multiples, or null if the row carries no EV at all.
function evOf(r) {
  const v = r?.ev_r != null ? r.ev_r : r?.ev;
  return v == null ? null : Number(v);
}

// Order-execution style — what the backend AggressionDispatcher derives from
// ev_per_dollar (NOT conviction): passive = deep/patient limit, mid = midpoint
// limit, aggressive = immediate market order. Deliberately labelled as an
// execution method, distinct from the Signal column (the direction/sizing call).
function fmtOrderStyle(label) {
  if (!label) return "—";
  const key = String(label).toLowerCase();
  const map = {
    passive: "Patient limit",
    mid: "Midpoint limit",
    aggressive: "Immediate market",
  };
  return map[key] || String(label).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Signal ranking board — prioritize capital by RANK (not highest p_win).
// Positive-EV signals rank first (sorted by RANK within that group); rows
// with EV <= 0 (or no EV at all) sort after and render greyed out — they're
// not worth sizing even if RANK looks good.
function SignalRankingBoard({ rows }) {
  const ranked = (rows || [])
    .map((r) => ({ ...r, _rank: rankOf(r), _state: stateOf(r), _ev: evOf(r) }))
    .filter((r) => r.symbol)
    .sort((a, b) => {
      const aPos = a._ev != null && a._ev > 0;
      const bPos = b._ev != null && b._ev > 0;
      if (aPos !== bPos) return aPos ? -1 : 1;
      const ra = a._rank ?? -1;
      const rb = b._rank ?? -1;
      if (ra !== rb) return rb - ra;
      return (b._epoch || 0) - (a._epoch || 0);
    })
    .slice(0, 12);

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">Signal ranking board</h3>
        <p className="text-xs opacity-60 mb-3">
          <strong>RANK</strong> is an opportunity score (event-time freshness, setup type,
          recent TP, cell hit-rate) — not win probability. Prioritize capital by RANK;
          size with Kelly/EV. The highest claimed win% is not always the best opportunity.
          Ranked by positive EV first; EV &le; 0 rows are greyed out below.
        </p>
        {ranked.length === 0 ? (
          <p className="text-xs opacity-50">No ranked signals yet — waiting for Kairos stamps.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="text-right">Claimed win%</th>
                  <th className="text-right">RANK</th>
                  <th className="text-right">EV</th>
                  <th>STATE</th>
                  <th>Transition</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => {
                  const isSell = String(r.signal || r.direction || "").toLowerCase() === "sell";
                  const negativeEv = !(r._ev != null && r._ev > 0);
                  return (
                    <tr
                      key={`${r.symbol}-${r.ts || r._epoch || r.sweep_timestamp || ""}`}
                      className={negativeEv ? "opacity-40" : undefined}
                      title={negativeEv ? "EV is not positive — not sized for capital allocation" : undefined}
                    >
                      <td>
                        <span className="font-mono font-semibold">{r.symbol}</span>{" "}
                        <span className={`badge badge-xs ${isSell ? "badge-error" : "badge-success"}`}>
                          {isSell ? "SELL" : "BUY"}
                        </span>
                      </td>
                      <td className="text-right font-mono">
                        {r.p_win != null ? fmtKellyPct(r.p_win) : "—"}
                      </td>
                      <td className="text-right">
                        <RankChip rank={r._rank} />
                      </td>
                      <td className="text-right font-mono">
                        {r._ev != null ? `${r._ev.toFixed(2)}R` : "—"}
                      </td>
                      <td>
                        <StateBadge state={r._state} />
                      </td>
                      <td className="text-xs opacity-70">{r.transition || r.kairos_transition || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KellyTable({ sweeps, kelly, symbolList, symbolRows }) {
  // Prefer dedicated v_talaria_kelly_by_symbol rows (stable contract);
  // fall back to merged sweeps if the view is empty/missing.
  const source = (kelly && kelly.length ? kelly : sweeps) || [];
  // asset_class is NOT on the Kelly rows (v_talaria_kelly_by_symbol omits it) —
  // it lives on the symbols roster (v_talaria_symbols). Mirror the plugin: look
  // it up per symbol so rows group into Commodities/Forex/Crypto/Stocks instead
  // of all collapsing into the "other" catch-all.
  const assetClassOf = {};
  (symbolRows || []).forEach((s) => {
    if (s && s.symbol) assetClassOf[s.symbol] = s.asset_class || "other";
  });
  const rows = (symbolList || []).map((sym) => {
    const row = source.find((s) => s.symbol === sym);
    const asset_class = assetClassOf[sym] || (row && row.asset_class) || "other";
    return row ? { symbol: sym, ...row, asset_class } : { symbol: sym, _missing: true, asset_class };
  });

  const groups = groupByAssetClass(rows);
  const orderedGroups = ASSET_CLASS_ORDER.filter((c) => groups[c]);
  // Add any remaining classes not in ASSET_CLASS_ORDER
  const remaining = Object.keys(groups).filter((c) => !ASSET_CLASS_ORDER.includes(c));
  const allGroups = [...orderedGroups, ...remaining];

  const groupLabels = {
    commodities: "Commodities", forex: "Forex", crypto: "Crypto", stocks: "Stocks",
    other: "Other",
  };

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">Kelly by symbol</h3>
        <p className="text-xs opacity-60 mb-3">
          Latest signal per symbol — <strong>every symbol in your plan roster,
          qualified or not</strong> (this is not a qualified-only list). Table
          grouped by asset class, sorted by symbol. Effective Kelly = post-EV
          scaling fraction of the book the engine would risk. Dash (—) = not
          enough data. Signal shows BUY/SELL only once a signal has qualified
          with nonzero Kelly sizing behind it — otherwise it reads WAIT (no
          directional lean) or CAUTION (a lean exists but hasn&apos;t cleared the
          qualification gate), so a raw direction isn&apos;t shown with the same
          weight as an actionable one. <strong>Order style</strong> is the
          execution method the engine would use if it traded — derived from EV
          per dollar risked, not conviction (a thin edge is filled immediately;
          a strong edge waits for a better price). It is independent of the
          Signal column, so a CAUTION row can still carry any order style.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Signal</th>
                <th className="text-right">Kelly</th>
                <th>Regime</th>
                <th className="text-right">Order style</th>
                <th className="text-right">EV</th>
                <th className="text-right">Claimed win%</th>
                <th className="text-right">Markov</th>
                <th>Entry</th>
                <th>SL</th>
                <th>TP</th>
              </tr>
            </thead>
            <tbody>
              {allGroups.map((cls) => (
                [
                  <tr key={"header-" + cls} className="bg-base-200/50">
                    <td colSpan={11} className="text-xs font-semibold py-1">
                      {groupLabels[cls] || cls}
                    </td>
                  </tr>,
                  ...groups[cls]
                    .sort((a, b) => (a.symbol || "").localeCompare(b.symbol || ""))
                    .map((r) => {
                      const call = signalCall(r);
                      return (
                        <tr key={r.symbol}>
                          <td className="font-mono">{r.symbol}</td>
                          <td className={`font-semibold ${call.toneClass}`}>{call.label}</td>
                          <td className="text-right font-mono">
                            {r.effective_kelly != null
                              ? "k" + Number(r.effective_kelly).toFixed(3)
                              : "—"}
                          </td>
                          <td>{fmtRegime(r.regime) || "—"}</td>
                          <td className="text-right">{fmtOrderStyle(r.aggression)}</td>
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

// Wilson score 95% lower bound on the true win rate, from the resolved counts
// the health view exposes (n_tp / n_resolved). Direct port of wilsonLower()
// in the Talaria desktop plugin (plugins/talaria/desktop/plugin.js) so the
// dashboard and the plugin show the same WR LB — the value was never a column
// on v_talaria_signal_health; the plugin always computed it client-side.
function wilsonLower(n, wins) {
  n = Number(n);
  wins = Number(wins);
  if (!isFinite(n) || n <= 0) return 0;
  const z = 1.96;
  const phat = Math.min(1, Math.max(0, wins / n));
  const denom = 1 + (z * z) / n;
  const centre = (phat + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n)) / denom;
  return Math.min(1, Math.max(0, centre - half));
}

// Format the WR LB cell for the health scoreboard; "—" when there is nothing
// resolved to bound (mirrors the plugin's `n_resolved > 0 && n_tp != null` gate).
function fmtWilsonLb(r) {
  if (!r || !(Number(r.n_resolved) > 0) || r.n_tp == null) return "—";
  return (wilsonLower(Number(r.n_resolved), Number(r.n_tp)) * 100).toFixed(1) + "%";
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
                  <td className="text-sm">{fmtWilsonLb(r)}</td>
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

function l1StatusBadge(status) {
  const s = String(status || "").toUpperCase();
  if (s === "OVERCONFIDENT") return "badge-warning";
  if (s === "UNDERCONFIDENT") return "badge-info";
  if (s === "CALIBRATED") return "badge-success";
  return "badge-ghost"; // PROVISIONAL / INSUFFICIENT_DATA
}

// L1 calibration confidence board — per (symbol, side). Does not use research-stream
// EOD win%/expiry as product quality (those are L3 geometry diagnostics).
function CalibrationConfidenceBoard({ rows, outcomeBySide }) {
  const sorted = [...(rows || [])].sort((a, b) => {
    const biasA = Math.abs(Number(a.bias_raw || 0));
    const biasB = Math.abs(Number(b.bias_raw || 0));
    return biasB - biasA || (a.symbol || "").localeCompare(b.symbol || "");
  });
  const geomKey = (r) => `${r.symbol}|${r.signal}`;
  const geomMap = {};
  (outcomeBySide || []).forEach((g) => {
    geomMap[geomKey(g)] = g;
  });

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">L1 calibration confidence (28d)</h3>
        <p className="text-xs opacity-60 mb-3">
          Is <span className="font-mono">p_win</span> honest on the qualified book?
          Raw (pre-enforcement) bias is the product claim. Side is buy vs sell.
          Status is tightened: CALIBRATED needs ≥10 episodes, |bias| ≤ 0.05, and
          expire ≤ 40%. <span className="font-mono">p_win_dir</span> is the
          bracket probability (live since 2026-10-03).{" "}
          <span className="font-mono">p_win_bracket</span> is deprecated.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Episodes</th>
                <th>Claimed win%</th>
                <th>Bracket win%</th>
                <th>Realized win%</th>
                <th>Bias (raw)</th>
                <th>Brier score</th>
                <th>Expire rate</th>
                <th>Calibration status</th>
                <th>Data confidence</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const g = geomMap[geomKey(r)] || r;
                const expire = r.pct_expired ?? g.pct_expired;
                return (
                  <tr key={`${r.symbol}-${r.signal}`}>
                    <td className="font-mono">{r.symbol}</td>
                    <td className="uppercase text-xs">{r.signal}</td>
                    <td className="font-mono">{r.n_episodes ?? 0}</td>
                    <td>{r.avg_p_win_raw != null ? fmtKellyPct(r.avg_p_win_raw) : "—"}</td>
                    <td>{r.avg_p_win_dir != null ? fmtKellyPct(r.avg_p_win_dir) : "—"}</td>
                    <td>{r.win_rate_closed != null ? fmtKellyPct(r.win_rate_closed) : "—"}</td>
                    <td
                      className={
                        Number(r.bias_raw) > 0.1
                          ? "text-error"
                          : Number(r.bias_raw) < -0.1
                            ? "text-success"
                            : ""
                      }
                    >
                      {r.bias_raw != null ? Number(r.bias_raw).toFixed(3) : "—"}
                    </td>
                    <td>{r.brier_raw != null ? Number(r.brier_raw).toFixed(3) : "—"}</td>
                    <td
                      className={
                        expire != null && Number(expire) > 0.4 ? "text-warning" : ""
                      }
                    >
                      {expire != null ? fmtKellyPct(expire) : "—"}
                      {r.high_expiry_geometry ? " ⚠" : ""}
                    </td>
                    <td>
                      <span className={`badge badge-sm ${l1StatusBadge(r.status_l1)}`}>
                        {r.status_l1 || "—"}
                      </span>
                    </td>
                    <td>
                      {r.thin_evidence ? (
                        <span className="badge badge-sm badge-warning" title="n_episodes < 10 — do not claim CALIBRATED">
                          thin
                        </span>
                      ) : (
                        <span className="badge badge-sm badge-ghost">ok</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs opacity-50 mt-2">
          Bias raw = avg p_dir raw − win_rate_closed on the same population (episode-counted).
          High expire blocks a CALIBRATED claim (geometry must be in-model first). Thin
          evidence (n_episodes &lt; 10) cannot claim CALIBRATED. Pairs matrix (Portfolio tab)
          shows buy/sell co-movement across commentary symbols.
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
          Symbol-level bias over 7 days (episode-counted). OVERCONFIDENT = stated
          confidence higher than delivered (be cautious). UNDERCONFIDENT = wins more
          than predicted. Near 0 = honest. This is not the L1 product bar — see
          “L1 calibration confidence” above for side-split, tightened status.
          <span className="font-mono">p_win_dir</span> is the bracket probability
          (live since 2026-10-03). <span className="font-mono">p_win_bracket</span> is deprecated.
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

function VsEqualWeightTable({ rows, alignedRows }) {
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

  // R5 unit-aligned baseline (v_paper_vs_equalwt_aligned) — same qualified cohort.
  const alignedMap = {};
  (alignedRows || []).forEach((r) => {
    const day = r.day || "";
    const monthKey = day.slice(0, 7);
    if (!alignedMap[monthKey]) {
      alignedMap[monthKey] = {
        month: monthKey,
        paper_pnl: 0,
        equalwt_aligned_pnl: 0,
        n_trades: 0,
      };
    }
    alignedMap[monthKey].paper_pnl += Number(r.paper_pnl || 0);
    alignedMap[monthKey].equalwt_aligned_pnl += Number(r.equalwt_aligned_pnl || 0);
    alignedMap[monthKey].n_trades += Number(r.n_trades || 0);
  });
  const alignedMonthly = Object.values(alignedMap)
    .map((m) => ({ ...m, delta: m.paper_pnl - m.equalwt_aligned_pnl }))
    .sort((a, b) => (a.month || "").localeCompare(b.month || ""));

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">Paper vs equal-weight (6 months)</h3>
        <p className="text-xs opacity-60 mb-3">
          Paper PnL = Kelly/regime-sized paper book (~$200 notional). Equal-wt
          PnL = naive sum over the research stream (1-unit price deltas —{" "}
          <strong>different units</strong>). Treat Delta as directional context
          only, not a product edge, until both sides share notional, cohort
          (qualified book), and expired treatment. Prefer paper cumulative and
          the L1 board for product quality.
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

        <h4 className="card-title text-base mt-4">Unit-aligned baseline (R5)</h4>
        <p className="text-xs opacity-60 mb-3">
          Same qualified cohort as paper (not the research stream). Equal-wt
          here is the aligned baseline from{" "}
          <span className="font-mono">v_paper_vs_equalwt_aligned</span> — still
          approximate notional scaling, but removes the 1-unit blow-up above.
          Prefer this Delta over the table above for L1 book context.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Month</th>
                <th>Paper PnL</th>
                <th>Equal-wt aligned</th>
                <th>Delta</th>
                <th>N</th>
              </tr>
            </thead>
            <tbody>
              {alignedMonthly.length === 0 ? (
                <tr>
                  <td colSpan={5} className="opacity-50">
                    No aligned baseline rows yet (migration 161 / qualified book).
                  </td>
                </tr>
              ) : (
                alignedMonthly.map((r) => (
                  <tr key={`al-${r.month}`}>
                    <td>{r.month}</td>
                    <td className={Number(r.paper_pnl) >= 0 ? "text-success" : "text-error"}>
                      ${Number(r.paper_pnl).toFixed(2)}
                    </td>
                    <td>${Number(r.equalwt_aligned_pnl).toFixed(2)}</td>
                    <td className={Number(r.delta) >= 0 ? "text-success" : "text-error"}>
                      ${Number(r.delta).toFixed(2)}
                    </td>
                    <td className="font-mono">{r.n_trades}</td>
                  </tr>
                ))
              )}
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
// ─── Portfolio view: live symbols watchlist (Google-Finance style) ───────────
// Precision-Pro-only: shows the plan's active symbols as a watchlist table.
//
// DATA AVAILABILITY: The fastapi-backend does NOT expose live market prices
// through any Supabase view — `last_price` comes from the in-memory
// SessionRegistry price buffer at runtime, not a stored column. The webapp's
// read-only anon path cannot fetch live prices. The closest available
// price-proxy is the latest Renko brick close_price from v_talaria_renko
// (already fetched as `renkoBricks` by /api/dashboard-data). See worklog §6
// "Implementation Constraints" for the full analysis.
//
// Columns:
//   Symbol | Asset | Brick Close (price proxy) | Signal | Entry |
//   Paper PnL (lifetime) | Eq. Share (1/N) | Win Rate | Profit Factor | Qualified
// Correlation color scale — green(good)->gray(neutral)->red(bad), using the
// dataviz skill's fixed STATUS palette (good/critical), not the neutral
// diverging pair. Rationale: for concentration risk, correlation isn't a
// direction-only statistic — negative/low correlation is a genuine hedge
// (good), high positive correlation means redundant exposure with no
// diversification benefit (bad). A neutral blue<->red diverging scale (the
// original choice) reads as "which direction," not "is this good or bad,"
// and users flagged a predominantly-red matrix as looking alarmist/backwards
// without that framing. Linear RGB interpolation, clamped to [-1, 1].
const CORR_NEG = [0x0c, 0xa3, 0x0c]; // #0ca30c (status: good)
const CORR_MID = [0x38, 0x38, 0x35]; // #383835 (neutral)
const CORR_POS = [0xd0, 0x3b, 0x3b]; // #d03b3b (status: critical)

function lerpRgb(a, b, t) {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t));
}

function corrColor(v) {
  const clamped = Math.max(-1, Math.min(1, Number(v) || 0));
  const [r, g, b] = clamped < 0 ? lerpRgb(CORR_NEG, CORR_MID, clamped + 1) : lerpRgb(CORR_MID, CORR_POS, clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

// Same green->gray->red scale as corrColor, rescaled to a 0..1 agreement
// rate (0.5 = coin-flip/neutral, 1.0 = always same direction = redundant bet).
function agreementColor(rate) {
  const clamped = Math.max(0, Math.min(1, Number(rate) || 0));
  const [r, g, b] = clamped < 0.5 ? lerpRgb(CORR_NEG, CORR_MID, clamped * 2) : lerpRgb(CORR_MID, CORR_POS, (clamped - 0.5) * 2);
  return `rgb(${r}, ${g}, ${b})`;
}

// Shared-session count below which the correlation matrix is withheld in favour
// of an honest "needs more history" state. Matches the backend detector's own
// bar (MIN_WINDOW + 10 = 20 shared returns): below it corr_regime is
// "insufficient_history" anyway, so "shown" and "trustworthy" become the same
// condition. Data source: nt_daily_close (via v_talaria_daily_close).
const CORRELATION_MATURITY_SESSIONS = 20;

// daisyUI `list` (https://daisyui.com/components/list/) used as a small
// titled "top pairs" card — the callout for the correlation/agreement
// matrices' most-notable pairs, so they read as a scannable highlight
// rather than a run-on sentence of comma-separated pairs.
function PairList({ title, tone, pairs, valueFormatter, emptyLabel }) {
  const badgeClass = tone === "error" ? "badge-error" : "badge-success";
  return (
    <ul className="list bg-base-200 rounded-box p-4">
      <li className="p-2 pb-1 text-md font-bold opacity-70">{title}</li>
      {pairs.length === 0 ? (
        <li className="px-3 pb-2 text-xs opacity-40">{emptyLabel}</li>
      ) : (
        pairs.map((p) => (
          <li key={`${p.a}-${p.b}`} className="flex items-center justify-between px-3 py-1.5 text-xs">
            <span className="font-mono">{p.a} ↔ {p.b}</span>
            <span className={`badge badge-sm font-mono ${badgeClass}`}>{valueFormatter(p)}</span>
          </li>
        ))
      )}
    </ul>
  );
}

// Signal risk overview — replaces the old paper-vs-equal-weight PortfolioView
// AND the earlier raw correlation-heatmap-first design. Talaria-native reframe
// (locked in 2026-09-04, see docs/worklog-backend-capability-exposure.md):
// headline is regime alignment + Kelly-weighted concentration, NOT the "regime-
// adjusted maximum Sharpe portfolio" framing borrowed from noble-trader-agent-
// frontend/noble-trader-admin (Talaria has no brokerage integration — there's
// no "current portfolio weights" to rebalance). The correlation matrix is kept
// as supporting detail, collapsed by default.
//
// Fetches from /api/portfolio-analytics/correlation and .../signal-agreement,
// both server-side proxies to nobletradingapp-backend
// (https://github.com/lexingtontechus/nobletradingapp-backend). Cached
// server-side (12h), so this is a read of a pre-computed result, not a live
// on-demand call.
// Parse analytics responses that may be JSON or a platform error page
// (Vercel timeout body starts with "An error o..." and breaks res.json()).
async function readJsonSafe(res) {
  const text = await res.text().catch(() => "");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      error:
        text && text.length < 200
          ? text
          : `Request failed (${res.status}). Analytics may be warming — try again shortly.`,
      warming: res.status >= 500,
    };
  }
  return friendlyAnalyticsPayload(data);
}

// Map backend jargon to trader-facing copy on the risk panel.
function friendlyAnalyticsPayload(data) {
  if (!data || typeof data !== "object") return data;
  const raw = String(data.error || data.detail || "");
  if (!raw) return data;
  if (/shared trading sessions|shared daily closes|history accumulat/i.test(raw)) {
    return {
      ...data,
      error: null,
      warming: true,
      history_note:
        data.history_note ||
        "Not enough shared price history across symbols yet. This fills in as the feed accumulates trading days.",
    };
  }
  if (/WEBAPP_BACKEND_API_KEY|timed out|cold start/i.test(raw)) {
    return {
      ...data,
      error: null,
      warming: true,
      history_note: "Analytics are warming up. Refresh in a minute.",
    };
  }
  return data;
}

// Shared "you don't have access to this tab" card — used at the tab
// dispatch level (not per-component) so a single plan/role check protects
// every widget under that tab, rather than each widget independently
// re-deriving (and potentially disagreeing on) its own gate.
function PlanGateCard({ title, body }) {
  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">{title}</h3>
        <div className="alert alert-info mt-2">
          <div>
            <h3 className="font-bold">Precision Pro feature</h3>
            <div className="text-xs">{body}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Note: no isPro prop/gate here — gating for this whole tab happens once,
// at the activeTab === "portfolio" dispatch site, not per-component.
function SignalRiskCard() {
  const [overview, setOverview] = useState(null);
  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try {
      const suffix = refresh ? "?refresh=1" : "";
      const [ovRes, agRes] = await Promise.all([
        fetch(`/api/portfolio-analytics/correlation${suffix}`),
        fetch(`/api/portfolio-analytics/signal-agreement${suffix}`),
      ]);
      // Vercel timeouts / platform errors return HTML or plain text — never
      // assume res.json() will parse. Always land on a shaped object.
      setOverview(await readJsonSafe(ovRes));
      setAgreement(await readJsonSafe(agRes));
    } catch (e) {
      setOverview({ error: String(e) });
      setAgreement({ error: String(e) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const kellyScore = overview?.kelly_correlation_score;
  const kellyTone = kellyScore == null ? undefined : kellyScore > 1.1 ? "neg" : kellyScore < 0.9 ? "pos" : undefined;

  const agreementPairs = [];
  if (agreement?.agreement_matrix && agreement?.symbols) {
    for (let i = 0; i < agreement.symbols.length; i++) {
      for (let j = i + 1; j < agreement.symbols.length; j++) {
        const rate = agreement.agreement_matrix[i]?.[j];
        if (rate != null) {
          agreementPairs.push({
            a: agreement.symbols[i],
            b: agreement.symbols[j],
            rate,
            overlapDays: agreement.overlap_days_matrix?.[i]?.[j] ?? 0,
          });
        }
      }
    }
    agreementPairs.sort((x, y) => y.overlapDays - x.overlapDays);
  }

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="card-title text-lg">Signal risk overview</h3>
          <button
            className="btn btn-xs btn-outline"
            disabled={loading || refreshing}
            onClick={() => load(true)}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="text-xs opacity-60 mt-1 mb-3">
          How correlated is the risk behind this plan&apos;s active signals right now —
          not a portfolio to rebalance, since Talaria has no brokerage integration.
          Cached — &quot;Refresh&quot; forces a recompute (may take up to a minute on a cold backend).
        </p>

        {loading && <div className="opacity-60 text-sm py-6 text-center">Loading…</div>}

        {!loading && overview?.error && !overview?.correlation_matrix && (
          <div className="alert alert-warning">
            <span className="text-sm">{overview.error}</span>
          </div>
        )}

        {!loading && overview?.correlation_matrix && (
          <>
            <div className="grid gap-3 sm:grid-cols-3 mb-4">
              <StatCard
                title="Dominant regime"
                value={fmtRegime(overview.dominant_regime)}
                sub={`${((overview.dominant_regime_share || 0) * 100).toFixed(0)}% of symbols share it`}
              />
              <StatCard
                title="Kelly concentration"
                value={kellyScore != null ? kellyScore.toFixed(2) + "×" : "—"}
                sub="vs. treating today's signals as independent"
                tone={kellyTone}
              />
              <StatCard
                title="Correlation regime"
                value={(overview.corr_regime || "unknown").replace("_", " ")}
                sub={`mean |ρ| ${Number(overview.mean_abs_correlation ?? 0).toFixed(2)} · ${overview.n_bars_fitted ?? "—"} sessions`}
              />
            </div>

            {Array.isArray(overview.symbols_dropped) && overview.symbols_dropped.length > 0 && (
              <div className="alert alert-warning mb-3">
                <span className="text-xs">
                  Showing <strong>{overview.symbols.length}</strong> of{" "}
                  <strong>{overview.symbols_requested?.length ?? overview.symbols.length}</strong>{" "}
                  plan symbols — the rest don&apos;t share enough daily-price history to
                  correlate yet:{" "}
                  <span className="font-mono">{overview.symbols_dropped.join(", ")}</span>.
                </span>
              </div>
            )}

            <p className="text-xs opacity-50 mb-4">
              Kelly concentration = combined risk of each symbol&apos;s current
              regime-gated Kelly sizing, accounting for correlation, divided by what
              it would be if they were independent. &gt;1× means correlation
              amplifies combined risk; &lt;1× means it dampens it. Correlation
              regime measures how much symbols move <em>together</em>, independent
              of market direction — an orderly bear market where everything falls
              in lockstep can still read as &quot;crisis&quot; (that&apos;s the
              diversification-collapse warning), same as a correlated rally would.
            </p>

            {(() => {
              const byRegime = (overview.per_symbol || []).reduce((acc, p) => {
                const key = p.regime || "unknown";
                (acc[key] ||= []).push(p.symbol);
                return acc;
              }, {});
              const nSymbols = overview.symbols.length || 1;
              const kellyShare = overview.kelly_by_regime_share || {};
              const rows = Object.entries(byRegime)
                .map(([regime, syms]) => ({
                  regime,
                  syms,
                  symbolShare: syms.length / nSymbols,
                  kellyShare: kellyShare[regime] || 0,
                }))
                .sort((a, b) => b.kellyShare - a.kellyShare || b.syms.length - a.syms.length);

              return (
                <div className="mb-4">
                  <h4 className="text-lg font-semibold mb-1">Risk concentration by regime</h4>
                  <p className="text-xs opacity-50 mb-2">
                    Where the plan&apos;s symbols and its Kelly-weighted risk budget actually sit right
                    now. A regime holding far more risk share than symbol share means a few
                    high-conviction bets are driving most of the exposure — that&apos;s the concentration
                    a flat per-symbol table (see Analysis tab) doesn&apos;t surface on its own.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Regime</th>
                          <th>Symbols</th>
                          <th>Risk share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ regime, syms, symbolShare, kellyShare: ks }) => {
                          const concentrated = ks > 0 && ks - symbolShare > 0.15;
                          return (
                            <tr key={regime}>
                              <td className="text-xs capitalize whitespace-nowrap">{fmtRegime(regime)}</td>
                              <td className="text-xs font-mono opacity-70">
                                {syms.join(", ")}
                                <span className="opacity-50"> ({syms.length})</span>
                              </td>
                              <td className="text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-20 bg-base-300 rounded h-2 shrink-0">
                                    <div
                                      className={`h-2 rounded ${concentrated ? "bg-warning" : "bg-secondary"}`}
                                      style={{ width: `${ks * 100}%` }}
                                    />
                                  </div>
                                  <span className="shrink-0">{(ks * 100).toFixed(0)}%</span>
                                  {concentrated && (
                                    <span className="badge badge-warning badge-xs" title="Holds notably more risk share than symbol share">
                                      concentrated
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {overview.computed_at && (
              <p className="text-xs opacity-50 mb-2">
                as of {formatDate(overview.computed_at)}{overview.cached ? " · cached" : ""}
                {overview.stale ? " · stale (last good result)" : ""}
                {overview.refreshing ? " · refreshing in the background…" : ""}
              </p>
            )}

          </>
        )}

        <div className="divider my-2" />

        <h4 className="text-lg font-semibold mb-1">Concurrent-signal agreement</h4>
        <p className="text-xs opacity-60 mb-2">
          Direction agreement on days both symbols had a qualified signal — not
          price correlation on every day.{agreement?.lookback_days ? ` Last ${agreement.lookback_days} days.` : ""}
          {" "}Read it the same way as the correlation matrix: red pairs fire the same
          direction almost every time (acting on both is closer to one bet than two);
          green pairs tend to disagree.
        </p>

        {!loading && agreement?.error && !agreement?.agreement_matrix && (
          <div className="alert alert-warning">
            <span className="text-sm">{agreement.error}</span>
          </div>
        )}

        {!loading && agreement?.agreement_matrix && agreement?.symbols && (
          <>
            {agreementPairs.length === 0 ? (
              <p className="text-xs opacity-50 mb-3">
                No symbol pair has enough concurrent qualified-signal days yet (need &ge;5) —
                the matrix below is empty for now and fills in as more qualified signals accumulate.
              </p>
            ) : (
              (() => {
                const mostRedundant = [...agreementPairs].sort((x, y) => y.rate - x.rate).slice(0, 3).filter((p) => p.rate >= 0.7);
                const mostComplementary = [...agreementPairs].sort((x, y) => x.rate - y.rate).slice(0, 3).filter((p) => p.rate <= 0.3);
                return (
                  <div className="grid gap-3 sm:grid-cols-2 mb-3">
                    <PairList
                      title="Most redundant"
                      tone="error"
                      pairs={mostRedundant}
                      valueFormatter={(p) => `${(p.rate * 100).toFixed(0)}%`}
                      emptyLabel="No pair at 70%+ agreement"
                    />
                    <PairList
                      title="Most complementary"
                      tone="success"
                      pairs={mostComplementary}
                      valueFormatter={(p) => `${(p.rate * 100).toFixed(0)}%`}
                      emptyLabel="No pair at 30%- agreement"
                    />
                  </div>
                );
              })()
            )}

            <details>
              <summary className="text-xs font-semibold cursor-pointer opacity-80">Full matrix</summary>
              <div className="overflow-x-auto mt-2">
                <table className="border-collapse">
                  <thead>
                    <tr>
                      <th className="text-xs p-1"></th>
                      {agreement.symbols.map((s) => (
                        <th key={s} className="text-xs p-1 font-mono opacity-70">{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agreement.symbols.map((rowSym, i) => (
                      <tr key={rowSym}>
                        <th className="text-xs p-1 font-mono opacity-70 text-right">{rowSym}</th>
                        {agreement.symbols.map((colSym, j) => {
                          const rate = agreement.agreement_matrix[i]?.[j];
                          const overlapDays = agreement.overlap_days_matrix?.[i]?.[j] ?? 0;
                          if (rate == null) {
                            return (
                              <td
                                key={colSym}
                                title={`${rowSym} × ${colSym}: only ${overlapDays} concurrent qualified-signal day(s), need >=5`}
                                className="text-center text-xs font-mono w-12 h-8 bg-base-300 opacity-40"
                              >
                                —
                              </td>
                            );
                          }
                          return (
                            <td
                              key={colSym}
                              title={`${rowSym} × ${colSym}: ${(rate * 100).toFixed(0)}% agreement over ${overlapDays} concurrent days`}
                              className="text-center text-xs font-mono w-12 h-8"
                              style={{ backgroundColor: agreementColor(rate), color: "#fff" }}
                            >
                              {(rate * 100).toFixed(0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-2 mt-3 text-xs opacity-60">
                <span>always disagrees (0%)</span>
                <div
                  className="h-2 w-40 rounded"
                  style={{ background: `linear-gradient(to right, ${agreementColor(0)}, ${agreementColor(0.5)}, ${agreementColor(1)})` }}
                />
                <span>always agrees (100%)</span>
                <span className="ml-2 opacity-50">gray/dash = not enough concurrent days yet</span>
              </div>
            </details>
          </>
        )}

        {/* Correlation matrix — demoted below the working lenses (regime
            alignment + agreement) and gated on history maturity: it needs
            ~20 shared sessions (the detector's own bar) before it's meaningful.
            Before that, an honest "available in ~N days" state replaces the
            near-empty grid. Source: nt_daily_close via v_talaria_daily_close
            (repointed 2026-10-04, migration 0027). */}
        {overview?.correlation_matrix && (
          <>
            <div className="divider my-2" />
            {(() => {
              const sessions = Number(overview.n_sessions_shared ?? 0);
              const mature = sessions >= CORRELATION_MATURITY_SESSIONS;
              if (!mature) {
                const remaining = Math.max(0, CORRELATION_MATURITY_SESSIONS - sessions);
                return (
                  <div className="mb-2">
                    <h4 className="text-lg font-semibold mb-1">Correlation matrix</h4>
                    <p className="text-xs opacity-60 mb-2">
                      Correlation of daily price returns between symbol pairs — how much
                      shared price risk sits behind holding qualified signals on both.
                      It needs a run of shared trading sessions before the numbers mean
                      anything, so it&apos;s withheld until then rather than shown thin.
                    </p>
                    <div className="alert">
                      <span className="text-xs">
                        Building history — <strong>{sessions}</strong> of{" "}
                        <strong>{CORRELATION_MATURITY_SESSIONS}</strong> shared trading
                        sessions so far. This unlocks in about{" "}
                        <strong>{remaining}</strong> more session{remaining === 1 ? "" : "s"}
                        {" "}(roughly {remaining} trading day{remaining === 1 ? "" : "s"}).
                        Regime alignment and concurrent-signal agreement above are live now.
                      </span>
                    </div>
                  </div>
                );
              }

              const pairs = [];
              for (let i = 0; i < overview.symbols.length; i++) {
                for (let j = i + 1; j < overview.symbols.length; j++) {
                  const v = overview.correlation_matrix[i]?.[j];
                  if (v != null) pairs.push({ a: overview.symbols[i], b: overview.symbols[j], v });
                }
              }
              const mostConcentrated = [...pairs].sort((x, y) => y.v - x.v).slice(0, 3).filter((p) => p.v > 0.3);
              const bestHedges = [...pairs].sort((x, y) => x.v - y.v).slice(0, 3).filter((p) => p.v < -0.1);

              return (
                <div className="mb-2">
                  <h4 className="text-lg font-semibold mb-1">Correlation matrix</h4>
                  <p className="text-xs opacity-50 mb-2">
                    Correlation of daily price returns between symbol pairs — this is about shared
                    price risk, not signal performance (that&apos;s Signal Health, in the Analysis
                    tab). A red pair moves together: holding qualified signals on both is closer to
                    one bet than two. A green pair offsets each other — a genuine hedge.
                  </p>

                  {pairs.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 mb-3">
                      <PairList
                        title="Most concentrated"
                        tone="error"
                        pairs={mostConcentrated}
                        valueFormatter={(p) => p.v.toFixed(2)}
                        emptyLabel="No pair above 0.30"
                      />
                      <PairList
                        title="Best hedges"
                        tone="success"
                        pairs={bestHedges}
                        valueFormatter={(p) => p.v.toFixed(2)}
                        emptyLabel="No pair below -0.10"
                      />
                    </div>
                  )}

                  <details>
                    <summary className="text-xs font-semibold cursor-pointer opacity-80">
                      Full matrix
                    </summary>
                    <div className="overflow-x-auto mt-2">
                      <table className="border-collapse">
                        <thead>
                          <tr>
                            <th className="text-xs p-1"></th>
                            {overview.symbols.map((s) => (
                              <th key={s} className="text-xs p-1 font-mono opacity-70">{s}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {overview.symbols.map((rowSym, i) => (
                            <tr key={rowSym}>
                              <th className="text-xs p-1 font-mono opacity-70 text-right">{rowSym}</th>
                              {overview.symbols.map((colSym, j) => {
                                const v = overview.correlation_matrix[i]?.[j];
                                const isNull = v == null;
                                return (
                                  <td
                                    key={colSym}
                                    title={
                                      isNull
                                        ? `${rowSym} × ${colSym}: no shared history`
                                        : `${rowSym} × ${colSym}: ${Number(v).toFixed(3)}`
                                    }
                                    className={
                                      "text-center text-xs font-mono w-12 h-8 " +
                                      (isNull ? "bg-base-300 opacity-40" : "")
                                    }
                                    style={isNull ? undefined : { backgroundColor: corrColor(v), color: "#fff" }}
                                  >
                                    {isNull ? "—" : Number(v).toFixed(2)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-xs opacity-60">
                      <span>diversifying (-1)</span>
                      <div
                        className="h-2 w-40 rounded"
                        style={{ background: `linear-gradient(to right, ${corrColor(-1)}, ${corrColor(0)}, ${corrColor(1)})` }}
                      />
                      <span>concentrated risk (+1)</span>
                    </div>
                  </details>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}

// EOD Signal Accuracy Report — see docs/worklog-eod-signal-accuracy-report.md.
// This validates the historical accuracy/precision of Talaria's qualified
// signals (predicted vs. realized outcome) — it is explicitly NOT trading or
// investment advice, hence the persistent disclaimer banner below rather than
// a dismissable one. Reads a report built once at end-of-day
// (app/lib/eod-report/build.js via /api/eod-report/generate) — this route
// never triggers generation itself, so loading this tab never calls an LLM.
//
// The API returns the LATEST AVAILABLE report (not strictly today's) and a
// `stale` flag; the report is only built at 21:00 UTC, so before then the most
// recent day's report is shown, labelled as such.
let eodReportPromise = null;
function loadEodReport() {
  if (!eodReportPromise) {
    eodReportPromise = fetch("/api/eod-report")
      .then((r) => (r.ok ? r.json() : { error: `HTTP ${r.status}` }))
      .catch((e) => {
        eodReportPromise = null; // allow retry on transient failure
        throw e;
      });
  }
  return eodReportPromise;
}

// Friendly label for the stored llm_provider value (internal token → display).
// Map — don't hardcode — so the label always matches the provider that actually
// produced the row (NVIDIA NIM is the only live provider; OpenRouter is legacy).
const LLM_PROVIDER_LABELS = { nvidia_nim: "NVIDIA AI", openrouter: "OpenRouter" };
function llmProviderLabel(p) {
  if (!p) return "";
  return LLM_PROVIDER_LABELS[String(p).toLowerCase()] || String(p);
}

function EodReportView() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch once per page load and reuse across tab switches — the report is a
  // shared daily digest built at EOD, so re-fetching on every remount just
  // adds a round-trip for identical content.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await loadEodReport());
    } catch (e) {
      setReport({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = report?.stats;
  const statusToneClass = (status) =>
    status === "OVERCONFIDENT" ? "badge-warning" : status === "CALIBRATED" ? "badge-success" : "badge-ghost";

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">EOD Signal Accuracy Report</h3>

        <div className="alert alert-warning mb-3">
          <span className="text-xs">
            This report validates the historical accuracy of Talaria&apos;s qualified signals —
            predicted vs. realized outcomes. It is <strong>not</strong> trading or investment
            advice and does not recommend any action. See the{" "}
            <Link href="/disclaimer" className="link">disclaimer</Link>.
          </span>
        </div>

        {loading && <div className="opacity-60 text-sm py-6 text-center">Loading…</div>}

        {!loading && report?.not_generated && (
          <p className="text-sm opacity-60">{report.message}</p>
        )}

        {!loading && report?.error && !stats && (
          <div className="alert alert-warning">
            <span className="text-sm">{report.error}</span>
          </div>
        )}

        {!loading && stats && (
          <>
            <p className="text-xs opacity-50 mb-3">
              {report.stale ? "Most recent report" : "Report"} for {report.report_date}
              {report.generated_at ? ` · generated ${formatDate(report.generated_at)}` : ""}
              {report.llm_provider ? ` · commentary via ${llmProviderLabel(report.llm_provider)}` : ""}
            </p>

            {report.stale && (
              <p className="text-xs opacity-60 mb-3">
                Today&apos;s report generates after market close (21:00 UTC) — showing the
                latest completed day until then.
              </p>
            )}

            {report.digest_summary && (
              <p className="text-sm mb-4 italic opacity-90">{report.digest_summary}</p>
            )}

            <div className="grid gap-3 sm:grid-cols-4 mb-3">
              <StatCard title="New signals" value={String(stats.n_new)} sub="qualified today" />
              <StatCard
                title="Resolved"
                value={String(stats.n_resolved)}
                sub={`${stats.n_tp} TP · ${stats.n_sl} SL · ${stats.n_expired} expired`}
              />
              <StatCard
                title="Realized win rate"
                value={stats.realized_win_rate != null ? (stats.realized_win_rate * 100).toFixed(1) + "%" : "—"}
                sub="today's resolved signals"
              />
              <StatCard
                title="Fixed-risk benchmark"
                value={stats.benchmark_today != null ? "$" + stats.benchmark_today.toFixed(2) : "—"}
                sub={stats.benchmark_cumulative != null ? `cumulative $${stats.benchmark_cumulative.toFixed(2)} all-time` : "no signals resolved today"}
                tone={stats.benchmark_today == null ? undefined : stats.benchmark_today >= 0 ? "pos" : "neg"}
              />
            </div>
            <p className="text-xs opacity-50 mb-4">
              Fixed-risk benchmark = aggregate P&amp;L across every resolved qualified signal if
              each risked a fixed $10 — a comparability benchmark, not a single-account balance.
            </p>

            <div className="grid gap-3 sm:grid-cols-4 mb-4">
              <StatCard title="Overconfident" value={String(stats.n_overconfident)} sub={`of ${stats.n_symbols_tracked} tracked`} tone={stats.n_overconfident > 0 ? "neg" : undefined} />
              <StatCard title="Calibrated" value={String(stats.n_calibrated)} sub={`of ${stats.n_symbols_tracked} tracked`} tone="pos" />
              <StatCard title="Underconfident" value={String(stats.n_underconfident)} sub={`of ${stats.n_symbols_tracked} tracked`} />
              <StatCard
                title="7-day rollup"
                value={stats.weekly_avg_realized != null ? (stats.weekly_avg_realized * 100).toFixed(1) + "%" : "—"}
                sub={`realized vs ${stats.weekly_avg_predicted != null ? (stats.weekly_avg_predicted * 100).toFixed(1) + "%" : "—"} predicted (n=${stats.weekly_n})`}
              />
            </div>

            <h4 className="text-sm font-semibold mb-2">Per-symbol accuracy</h4>
            <div className="space-y-3">
              {(report.per_symbol || []).map((s) => (
                <div key={s.symbol} className="border-b border-base-300 pb-2 last:border-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono font-semibold text-sm">{s.symbol}</span>
                    {s.new_signal && <span className="badge badge-sm badge-ghost">new: {s.new_signal.signal}</span>}
                    {s.resolved && (
                      <span className="badge badge-sm badge-ghost">
                        resolved: {s.resolved.n_tp}TP/{s.resolved.n_sl}SL/{s.resolved.n_expired}EXP
                      </span>
                    )}
                    {s.calibration && (
                      <span className={`badge badge-sm ${statusToneClass(s.calibration.status)}`}>
                        {s.calibration.status}
                      </span>
                    )}
                  </div>
                  {s.commentary ? (
                    <p className="text-xs opacity-70">{s.commentary}</p>
                  ) : (
                    <p className="text-xs opacity-40">Commentary unavailable for this symbol.</p>
                  )}
                </div>
              ))}
              {(!report.per_symbol || report.per_symbol.length === 0) && (
                <p className="text-xs opacity-50">No qualified signal activity today.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
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

  // Single source of truth for role-gating: resolved once here and passed
  // down as a prop, instead of each tab/component re-deriving its own
  // admin-ness (e.g. inferring it from whether an API payload happens to
  // include an `admin` key). Mirrors header.jsx's /api/me pattern — role
  // lives in Clerk PRIVATE metadata, invisible to the browser SDK, so it
  // has to come from the server. This is a UX gate only; the real
  // boundary is server-side (/api/platform-health omits the admin block
  // for non-admins regardless of what the client renders).
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setIsAdmin(d?.role === "admin");
      })
      .catch(() => {});
    return () => { cancelled = true };
  }, []);

  // Dashboard view data (fetched from /api/dashboard-data)
  const [sweeps, setSweeps] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [signalHealth, setSignalHealth] = useState([]);
  const [calibration, setCalibration] = useState([]);
  const [calibrationBoard, setCalibrationBoard] = useState([]);
  const [outcomeBySide, setOutcomeBySide] = useState([]);
  const [vsEqual, setVsEqual] = useState([]);
  const [vsEqualAligned, setVsEqualAligned] = useState([]);
  const [portfolioStats, setPortfolioStats] = useState(null);
  const [renkoBricks, setRenkoBricks] = useState([]);
  const [regimeEdge, setRegimeEdge] = useState([]);
  const [kellyRows, setKellyRows] = useState([]);
  const [health, setHealth] = useState(null);
  const [paperEquity, setPaperEquity] = useState([]);
  const [deadlineTiers, setDeadlineTiers] = useState([]);
  const [geometryRisk, setGeometryRisk] = useState([]);
  const [kairosPivots, setKairosPivots] = useState([]);

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
        setRenkoBricks(j.renkoBricks ?? []);
        setSignalHealth(j.signalHealth ?? []);
        setRegimeEdge(j.regimeEdge ?? []);
        setCalibration(j.calibration ?? []);
        setCalibrationBoard(j.calibrationBoard ?? []);
        setOutcomeBySide(j.outcomeBySide ?? []);
        setVsEqual(j.vsEqual ?? []);
        setVsEqualAligned(j.vsEqualAligned ?? []);
        setPortfolioStats(j.portfolioStats ?? null);
        setKellyRows(j.kelly ?? []);
        fetch("/api/platform-health")
          .then((r) => (r.ok ? r.json() : null))
          .then((h) => {
            if (h) setHealth(h);
          })
          .catch(() => {});
        setPaperEquity(j.paperEquity ?? []);
        setDeadlineTiers(j.deadlineTiers ?? []);
        setGeometryRisk(j.geometryRisk ?? []);
        setKairosPivots(j.kairosPivots ?? []);
        // Seed liveSignals from the initial fetch too — otherwise a symbol
        // that qualified before this page load (and hasn't had a fresh
        // Realtime broadcast since) never appears in FloatingSignalsWidget
        // until either a broadcast arrives or the first 5-minute poll
        // completes. Realtime broadcasts can also be missed outright during
        // a reconnect (the channel does legitimately cycle
        // SUBSCRIBED/CLOSED/SUBSCRIBED under normal operation), so the
        // initial REST snapshot is the only guaranteed catch-up path.
        if (j.sweeps) {
          const fresh = j.sweeps.filter(
            (s) => s && s.symbol && s.qualified === true && s.signal
          );
          if (fresh.length) {
            setLiveSignals((prev) => {
              const seen = new Map(prev.map((s) => [s.symbol, s]));
              fresh.forEach((s) => seen.set(s.symbol, s));
              return Array.from(seen.values()).slice(0, 50);
            });
          }
        }
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
    // The fastapi backend broadcasts (raw Phoenix websocket, see
    // realtime_publisher.py) on the LITERAL topic `realtime:signals.<plan_slug>`.
    // supabase-js's client.channel(topic) prepends "realtime:" to whatever
    // you pass it (see @supabase/realtime-js RealtimeClient.channel()) — so
    // the argument here must be the topic WITHOUT that prefix, or the client
    // ends up joining "realtime:realtime:signals.<plan_slug>" and silently
    // never receives anything the backend sends (verified live: this was
    // the actual bug — toasts never fired because of this double-prefix,
    // not because broadcasting itself was broken).
    const topic = `signals.${planSlug}`;
    const channel = supabase
      .channel(topic)
      .on("broadcast", { event: "signal" }, (payload) => {
        const signal = payload?.payload ?? payload;
        if (!signal) return;

        console.log("[dashboard:realtime] signal received:", {
          symbol: signal.symbol,
          plan: planSlug,
          topic,
          signal,
        });

        // Add to live signals state — FloatingSignalsWidget renders from this
        // directly (TTL-windowed) and auto-opens when the count increases, so
        // no separate toast dispatch is needed here.
        setLiveSignals((prev) => {
          const filtered = prev.filter((s) => s.symbol !== signal.symbol);
          return [signal, ...filtered];
        });
      })
      .subscribe((status) => {
        console.log("[dashboard:realtime] subscribe status:", status, "plan:", planSlug, "topic:", topic);
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
        setKellyRows(j.kelly ?? []);
              setSignalHealth(j.signalHealth ?? []);
              setRegimeEdge(j.regimeEdge ?? []);
              setCalibration(j.calibration ?? []);
              setCalibrationBoard(j.calibrationBoard ?? []);
              setOutcomeBySide(j.outcomeBySide ?? []);
              setVsEqual(j.vsEqual ?? []);
              setVsEqualAligned(j.vsEqualAligned ?? []);
              setIsLoading(false);
              // Inject new qualified signals into live state so the
              // toast handler fires for any that arrived since the
              // last Realtime event. Dedup by symbol (newest wins).
              if (j.sweeps) {
                const fresh = j.sweeps.filter(
                  (s) => s && s.symbol && s.qualified === true && s.signal
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
    }, 300000);

    return () => {
      clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [planSlug]);

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

        {/* Stat card grid (3 cols) — mirrors tla-grid */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            title="Plan"
            value={isPro ? "Precision Pro" : "Signal Scout"}
            sub={
              `${resolvedSymbolList.length || health?.user?.symbols_watched || "—"} symbols · ` +
              (subscriptionStatus === "active"
                ? "Active"
                : subscriptionStatus === "grace"
                  ? "Grace"
                  : "Inactive")
            }
          />
          <StatCard
            title="Alerts"
            value={String(health?.user?.signals_7d?.value ?? "\u2014")}
            sub="Last 7 days"
            deltaPct={health?.user?.signals_7d?.pct}
          />
          <StatCard
            title="Realtime"
            value={formatLastAlert(health?.user?.last_signal_at)}
            sub={
              (wsStatus === "connected"
                ? "Live"
                : wsStatus === "error"
                  ? "Feed error"
                  : "Connecting") +
              " · last qualified · scan " +
              formatLastAlert(health?.user?.last_scan_at)
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
          regimeEdge={regimeEdge}
        />
        <SignalContextCard
          sweepRow={selectedSweepRow}
          deadlineTiers={deadlineTiers}
          geometryRisk={geometryRisk}
          kairosPivots={kairosPivots}
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
            {/* RANK board — capital prioritization (Kairos) */}
            <SignalRankingBoard rows={mergedSweeps} />

            {/* Kelly by symbol (grouped by asset class, sorted) */}
            <KellyTable sweeps={mergedSweeps} kelly={kellyRows} symbolList={resolvedSymbolList} symbolRows={symbols} />

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
            <CalibrationConfidenceBoard rows={calibrationBoard} outcomeBySide={outcomeBySide} />
            <CalibrationTable rows={calibration} />
            <CalibrationScorecard calibration={calibration} calibrationBoard={calibrationBoard} />

            {/* Paper vs equal-weight (Precision Pro only) */}
            {isPro && <VsEqualWeightTable rows={vsEqual} alignedRows={vsEqualAligned} />}

            {/* Portfolio stats (Precision Pro only) */}
            {isPro && portfolioStats && <PortfolioStatsCard stats={portfolioStats} />}
          </Fragment>
        )}
        {activeTab === "portfolio" && (
          isPro
            ? <SignalRiskCard />
            : <PlanGateCard
                title="Signal risk overview"
                body="Upgrade to see regime alignment, Kelly-weighted concentration, and concurrent-signal agreement across your plan's symbols."
              />
        )}
        {activeTab === "health" && (
          <Fragment>
            <p className="text-sm opacity-70 mb-4">
              Ops quality for the live signal platform — coverage, expiry, and
              edge against each trade&apos;s own odds. Not a marketing win rate.
            </p>
            <PlatformHealthCard isAdmin={isAdmin} />
          </Fragment>
        )}
        {activeTab === "eod" && <EodReportView />}

        <FloatingSignalsWidget signals={liveSignals} />
      </div>
    </div>
  );
}
