"use client";

// Admin-only manual rerun trigger for the EOD signal accuracy report.
// Calls the admin-gated proxy (app/api/eod-report/generate/route.js), which
// forwards to the canonical Edge Function implementation — this button does
// NOT run any report logic itself. Regular users never see this; it's not
// part of app/dashboard/page.jsx.
import { useState } from "react";

export default function EodReportTrigger() {
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/eod-report/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(date ? { date } : {}),
      });
      const data = await res.json();
      setResult({ ok: res.ok, data });
    } catch (e) {
      setResult({ ok: false, data: { error: String(e) } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow border border-base-300 mb-6">
      <div className="card-body">
        <h3 className="card-title text-lg">EOD Signal Accuracy Report — manual rerun</h3>
        <p className="text-xs opacity-60 mb-3">
          Regenerates a specific day&apos;s report on demand. The scheduled version
          runs automatically at 21:00 UTC daily via pg_cron — this is only for
          re-running after a fix or backfilling a missed day.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            className="input input-sm input-bordered"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder="defaults to today"
          />
          <button className="btn btn-sm btn-primary" disabled={loading} onClick={run}>
            {loading ? "Generating…" : "Regenerate"}
          </button>
        </div>
        {result && (
          <pre className={`text-xs mt-3 p-2 rounded bg-base-200 overflow-x-auto ${result.ok ? "" : "text-error"}`}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
