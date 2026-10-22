// =============================================================================
// Noble Trading App — API Route: plans
// =============================================================================
// Public read of active membership plans (for checkout UI). The old flow
// hardcoded paylink ids in env vars (NEXT_PUBLIC_NTA_*) or in components;
// this endpoint makes the plans table the single source of truth so the
// Helio checkout always uses the CURRENT paylink id.
//
//   GET /api/plans
//   → [{ id, title, description, price_cents, currency, interval,
//        helio_paylink_id, sort_order }]
//
// Anon-key RLS already allows public reads of active plans (0001_init.sql),
// but this route uses the service role so the response can include
// helio_paylink_id regardless of RLS policy scope.
// =============================================================================

import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Lazy singleton: createClient throws at module load when env is absent,
// which takes down every route in the app at import time. Absent config
// becomes a null client the handler turns into a clean 503 instead.
let _client = null;
function getClient() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return null;
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

export async function GET() {

  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "This endpoint is not configured on this deployment." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const { data, error } = await supabase
    .from("plans")
    .select(
      "id, title, description, price_cents, currency, interval, helio_paylink_id, sort_order"
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true })

  if (error) {
    console.error("GET /api/plans failed:", error)
    return NextResponse.json({ error: "Failed to load plans" }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
