// PlatformHealthCard — dashboard "Platform Health" tab.
//
// Members see product metrics (signals, settled outcomes, vs odds).
// Admins also get ops tiles (sweep coverage, settlement, rank stamps).
// Never a raw "win rate" claim — quality is vs each trade's own odds.
//
// Role gating: the real boundary is server-side — /api/platform-health
// computes isAdmin itself and omits the `admin` payload key entirely for
// non-admins, so there is no sensitive data in the response to leak. The
// `isAdmin` prop (resolved once in DashboardPage via /api/me, same as
// header.jsx) is a second, independent check purely so the ops section
// never renders from a stray/cached payload that happens to carry an
// `admin` key — belt-and-suspenders, not the actual access control.
//
// API: GET /api/platform-health

"use client";

import { useCallback, useEffect, useState } from "react";

function pct(n) {
  if (n === null || n === undefined) return "—";
  return `${Math.round(Number(n) * 100)}%`;
}

function signed(n) {
  if (n === null || n === undefined) return "—";
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function deltaLabel(d) {
  if (!d || d.pct == null || Number.isNaN(Number(d.pct))) return null;
  const pct = Number(d.pct);
  return (
    <span className={pct >= 0 ? "text-success" : "text-error"}>
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct * 100).toFixed(0)}% vs prior 7d
    </span>
  );
}

function ago(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function PlatformHealthCard({ isAdmin = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/platform-health");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch (e) {
      setError(e?.message || "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/platform-health");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) {
          setData(j);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || "failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const u = data?.user;
  const a = data?.admin;

  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="card-title text-lg">Your signal feed</h3>
            <p className="text-xs opacity-70">
              Live across {u?.symbols_watched ?? "—"} symbols. Quality is
              measured against each trade&apos;s own odds — not a marketing win
              percentage.
            </p>
          </div>
          <button type="button" className="btn btn-xs btn-ghost" onClick={load}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-sm opacity-70">Loading…</div>
        ) : error ? (
          <div className="text-sm opacity-70">
            Stats unavailable ({error}). Signals still run independently.
          </div>
        ) : (
          <>
            {/* Product metrics — all users.
                signals_7d / signals_24h are QUALIFIED signal checks from
                v_platform_health_summary (qualified = true only), same
                population as the hot-signals feed — NOT every sweep row. */}
            <div className="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full">
              <div className="stat py-2">
                <div className="stat-title text-xs">Qualified alerts (7d)</div>
                <div className="stat-value text-xl">
                  {u?.signals_7d?.value ?? "—"}
                </div>
                <div className="stat-desc" title="Qualified signal checks only — not every scan row">
                  qualified only · {u?.signals_24h ?? "—"} in 24h{" "}
                  {deltaLabel(u?.signals_7d)}
                </div>
              </div>
              <div className="stat py-2">
                <div className="stat-title text-xs">Last alert</div>
                <div className="stat-value text-xl">{ago(u?.last_signal_at)}</div>
                <div className="stat-desc">
                  last qualified · scan {ago(u?.last_scan_at)}
                </div>
              </div>
              <div className="stat py-2">
                <div className="stat-title text-xs">Settled (7d)</div>
                <div className="stat-value text-xl">{u?.settled_7d ?? "—"}</div>
                <div className="stat-desc">W or L (not expired)</div>
              </div>
              <div className="stat py-2">
                <div className="stat-title text-xs">Vs odds</div>
                <div className="stat-value text-xl">
                  {signed(u?.edge_vs_odds_7d?.value)}
                </div>
                <div className="stat-desc">
                  above 0 beats the bracket {deltaLabel(u?.edge_vs_odds_7d)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <div className="rounded-lg border border-base-300 px-3 py-2">
                <div className="text-xs opacity-60">Win rate (W/L)</div>
                <div className="text-lg font-semibold">
                  {pct(u?.win_rate_7d?.value)}
                </div>
                <div className="text-xs opacity-60">
                  of settled {deltaLabel(u?.win_rate_7d)}
                </div>
              </div>
              <div className="rounded-lg border border-base-300 px-3 py-2">
                <div className="text-xs opacity-60">Expired</div>
                <div className="text-lg font-semibold">
                  {pct(u?.expired_share_7d?.value)}
                </div>
                <div className="text-xs opacity-60">
                  no W/L {deltaLabel(u?.expired_share_7d)}
                </div>
              </div>
            </div>

            {Array.isArray(u?.improvements) && u.improvements.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {u.improvements.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-base-300 px-3 py-2"
                  >
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-xs opacity-70">{item.detail}</div>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Ops health — admin only. Gated on both the client-resolved
                isAdmin prop AND the presence of the admin payload block —
                either one being false hides the section. */}
            {isAdmin && a ? (
              <div className="mt-4">
                <h4 className="text-sm font-semibold uppercase opacity-70 mb-2">
                  Ops health (admin)
                </h4>
                <div className="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full">
                  <div className="stat py-2">
                    <div className="stat-title text-xs">Coverage 24h</div>
                    <div className="stat-value text-lg">
                      {pct(a.sweep_coverage_24h)}
                    </div>
                    <div className="stat-desc">
                      15-min sweep slots ({a.slots_24h ?? "—"})
                    </div>
                  </div>
                  <div className="stat py-2">
                    <div className="stat-title text-xs">Settlement</div>
                    <div className="stat-value text-lg">
                      {a.eod_resolver_ok === true
                        ? "OK"
                        : a.eod_resolver_ok === false
                          ? "Lagging"
                          : "—"}
                    </div>
                    <div className="stat-desc">EOD outcome writes</div>
                  </div>
                  <div className="stat py-2">
                    <div className="stat-title text-xs">Rank stamps</div>
                    <div className="stat-value text-lg">
                      {pct(a.rank_stamp_share_24h)}
                    </div>
                    <div className="stat-desc">kairos_rank_score coverage</div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
