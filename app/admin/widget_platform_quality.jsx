// WidgetPlatformQuality — admin signal-quality / platform-health strip.
// Client component: same /api/platform-health payload as the portal card,
// plus the admin block (scorecard-lite + roadmap). See
// docs/worklog-platform-health-and-quality-surface.md.

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

export default function WidgetPlatformQuality() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold uppercase">Signal quality</h2>
        <button type="button" className="btn btn-xs btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? (
        <div className="text-error p-2 text-sm">Health API: {error}</div>
      ) : null}

      <div className="stats stats-vertical lg:stats-horizontal shadow bg-base-200 w-full">
        <div className="stat">
          <div className="stat-title">Coverage 24h</div>
          <div className="stat-value text-primary">
            {loading ? "…" : pct(u?.sweep_coverage_24h)}
          </div>
          <div className="stat-desc">
            {a ? `${a.slots_24h ?? "—"} slots · ${a.rows_24h ?? "—"} rows` : "sweep slots"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Expiry 7d</div>
          <div className="stat-value">{loading ? "…" : pct(u?.expiry_share_7d)}</div>
          <div className="stat-desc">closed with no TP/SL</div>
        </div>
        <div className="stat">
          <div className="stat-title">Edge vs odds</div>
          <div className="stat-value">
            {loading ? "…" : signed(u?.edge_vs_no_skill_7d)}
          </div>
          <div className="stat-desc">scorecard D · publishable quality</div>
        </div>
        <div className="stat">
          <div className="stat-title">Rank stamp 24h</div>
          <div className="stat-value">
            {loading ? "…" : pct(a?.rank_stamp_share_24h)}
          </div>
          <div className="stat-desc">kairos_rank_score coverage</div>
        </div>
      </div>

      {a ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-base-300 p-3">
              <div className="text-xs uppercase opacity-60">Decided 7d</div>
              <div className="text-lg font-semibold">{a.decided_7d ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-base-300 p-3">
              <div className="text-xs uppercase opacity-60">TP rate 7d</div>
              <div className="text-lg font-semibold">{pct(a.tp_rate_7d)}</div>
            </div>
            <div className="rounded-lg border border-base-300 p-3">
              <div className="text-xs uppercase opacity-60">Settlement</div>
              <div className="text-lg font-semibold">
                {u?.eod_resolver_ok === true
                  ? "OK"
                  : u?.eod_resolver_ok === false
                    ? "Lagging"
                    : "—"}
              </div>
            </div>
          </div>
          <p className="text-xs opacity-70">{a.era_note}</p>

          {Array.isArray(a.roadmap) && a.roadmap.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>Mechanism</th>
                    <th>Status</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {a.roadmap.map((row) => (
                    <tr key={row.mechanism}>
                      <td className="font-mono text-xs">{row.mechanism}</td>
                      <td>
                        <span
                          className={`badge badge-sm ${
                            row.status === "resolved"
                              ? "badge-success"
                              : row.status === "blocked"
                                ? "badge-error"
                                : "badge-warning"
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="max-w-md truncate text-xs opacity-80">
                        {row.current_state}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <div className="text-sm opacity-70">
          Sign in as admin for scorecard detail and roadmap.
        </div>
      )}
    </div>
  );
}
