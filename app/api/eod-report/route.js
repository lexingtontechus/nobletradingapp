// =============================================================================
// Noble Trading App — Next.js API Route: eod-report
// =============================================================================
// Reads an already-built EOD signal accuracy report from v_eod_report — this
// route NEVER calls the LLM or triggers generation (see .../generate/route.js
// for that), it only serves whatever was already built once for the day.
//
// Available to any signed-in subscriber (both Signal Scout and Precision
// Pro) — signal-accuracy transparency reads as a baseline trust feature,
// not a compute-heavy Pro-gated analytic like correlation/portfolio stats.
// Flagging this as a judgment call, not an explicit product decision.
//
// Availability: the report is built ONCE per day at 21:00 UTC (pg_cron ->
// eod-report-generate; see migration 0017). A report for date D therefore only
// satisfies "today" from 21:00 UTC on D until 00:00 UTC on D+1 — a 3-hour
// window. US market hours (13:30–20:00 UTC) fall entirely BEFORE generation,
// so a same-day "today only" lookup is blank for the other 21 hours/day. To
// avoid that blank, a request with NO date returns the LATEST AVAILABLE report
// (ordered by report_date DESC) and flags it stale when it isn't today's.
//
// GET /api/eod-report                     — latest available report
// GET /api/eod-report?date=YYYY-MM-DD      — that exact day's report
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { cached } from "@/utils/api-cache";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const todayUtc = () => new Date().toISOString().slice(0, 10);

// Fetch a single report row (by exact date, or the most recent available).
// Cached in-process for 5 min: the underlying row is built once/day and is
// immutable, so a short TTL just avoids a PostgREST round-trip per tab switch.
async function fetchReport(exactDate) {
  const cacheKey = `eod:${exactDate || "latest"}`;
  return cached(cacheKey, 300_000, async () => {
    if (exactDate) {
      const { data, error } = await supabase
        .from("v_eod_report")
        .select("*")
        .eq("report_date", exactDate)
        .maybeSingle();
      return { data, error };
    }
    const { data, error } = await supabase
      .from("v_eod_report")
      .select("*")
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { data, error };
  });
}

export async function GET(request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const today = todayUtc();
  const { data, error } = await fetchReport(requestedDate || null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  // No report exists at all yet (nothing has ever been built).
  if (!data) {
    return NextResponse.json({
      report_date: requestedDate || today,
      not_generated: true,
      message: "The first report generates after market close — check back then.",
    });
  }

  // Explicit date requested but that exact day has no report.
  if (requestedDate && data.report_date !== requestedDate) {
    return NextResponse.json({
      report_date: requestedDate,
      not_generated: true,
      message: `No report for ${requestedDate}.`,
    });
  }

  // Report exists but is not today's — tell the UI to label it as the most
  // recent available (built at EOD; today's appears after 21:00 UTC).
  const stale = data.report_date !== today;

  return NextResponse.json(
    {
      report_date: data.report_date,
      generated_at: data.generated_at,
      llm_provider: data.llm_provider,
      error: data.error,
      stale,
      ...data.payload,
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
