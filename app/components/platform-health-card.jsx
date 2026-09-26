// PlatformHealthCard — user-facing platform quality strip (portal).
// Quality language: coverage, expiry, edge vs no-skill. Never a raw win rate.
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

export default function PlatformHealthCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/platform-health");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j);
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

  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="card-title text-lg">Platform health</h3>
            <p className="text-xs opacity-70">
              Quality is measured against each trade&apos;s own odds — not a
              marketing win percentage.
            </p>
          </div>
          <button type="button" className="btn btn-xs btn-ghost" onClick={load}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-sm opacity-70">Loading health…</div>
        ) : error ? (
          <div className="text-sm opacity-70">
            Health unavailable ({error}). Signals still run independently.
          </div>
        ) : (
          <>
            <div className="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full">
              <div className="stat py-2">
                <div className="stat-title text-xs">Coverage 24h</div>
                <div className="stat-value text-xl">
                  {pct(u?.sweep_coverage_24h)}
                </div>
                <div className="stat-desc">15-min sweep slots</div>
              </div>
              <div className="stat py-2">
                <div className="stat-title text-xs">Expiry 7d</div>
                <div className="stat-value text-xl">
                  {pct(u?.expiry_share_7d)}
                </div>
                <div className="stat-desc">closed with no TP/SL</div>
              </div>
              <div className="stat py-2">
                <div className="stat-title text-xs">Edge vs odds</div>
                <div className="stat-value text-xl">
                  {signed(u?.edge_vs_no_skill_7d)}
                </div>
                <div className="stat-desc">above 0 beats the bracket</div>
              </div>
              <div className="stat py-2">
                <div className="stat-title text-xs">Settlement</div>
                <div className="stat-value text-xl">
                  {u?.eod_resolver_ok === true
                    ? "OK"
                    : u?.eod_resolver_ok === false
                      ? "Lagging"
                      : "—"}
                </div>
                <div className="stat-desc">EOD outcome writes</div>
              </div>
            </div>

            {Array.isArray(u?.improvements) && u.improvements.length > 0 ? (
              <ul className="mt-2 space-y-2">
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
          </>
        )}
      </div>
    </div>
  );
}
