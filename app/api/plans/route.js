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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

export async function GET() {
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
