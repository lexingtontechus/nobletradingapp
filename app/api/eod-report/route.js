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
// GET /api/eod-report                     — today's report (UTC)
// GET /api/eod-report?date=YYYY-MM-DD      — a specific day's report
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function GET(request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("v_eod_report")
    .select("*")
    .eq("report_date", date)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  if (!data) {
    return NextResponse.json({
      report_date: date,
      not_generated: true,
      message: "Today's report generates after market close — check back then.",
    });
  }

  return NextResponse.json({
    report_date: data.report_date,
    generated_at: data.generated_at,
    llm_provider: data.llm_provider,
    error: data.error,
    ...data.payload,
  });
}
