// =============================================================================
// Noble Trading App — Next.js API Route: eod-report/generate
// =============================================================================
// ADMIN-ONLY manual rerun trigger — NOT the scheduled path. The scheduled
// daily generation runs entirely inside Supabase (pg_cron -> the
// eod-report-generate Edge Function, see migration 0017) so the actual work
// (Supabase queries + up to ~20 sequential-fallback LLM calls) never risks
// Vercel's serverless execution-time caps.
//
// This route does NOT reimplement the report logic — there is deliberately
// only ONE implementation (the Edge Function). It only decides WHO is
// allowed to trigger a rerun (an admin, via their Clerk session — same
// role check as proxy.js's /admin route protection) and forwards the
// request with the shared X-Internal-Secret.
//
// POST /api/eod-report/generate                     — regenerate today (UTC)
// POST /api/eod-report/generate  {"date":"YYYY-MM-DD"} — regenerate a specific day
// =============================================================================

import { NextResponse } from "next/server";
import { checkRole } from "@/utils/roles";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const INTERNAL_FUNCTION_SECRET = process.env.INTERNAL_FUNCTION_SECRET;

export async function POST(request) {
  if (!(await checkRole("admin"))) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  if (!INTERNAL_FUNCTION_SECRET) {
    return NextResponse.json({ error: "INTERNAL_FUNCTION_SECRET is not configured on the server." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/eod-report-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_FUNCTION_SECRET },
      body: JSON.stringify(body?.date ? { date: body.date } : {}),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 502 });
  }
}
