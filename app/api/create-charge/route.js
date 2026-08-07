// =============================================================================
// Noble Trading App — Next.js API Route: create-charge
// =============================================================================
// User-initiated "Renew Now" (from the portal when status=grace) or
// "Resubscribe" (when status=expired). Mints a fresh Helio charge via
// POST /v1/charge/api-key and returns the pageUrl for the client to redirect.
//
//   POST /api/create-charge
//   body: { subscriptionId: string }
//   → { chargeUrl: string, chargeToken: string }
//
// For expired subscriptions, the client should first call
// /api/create-subscription to mint a NEW pending row, then render the
// <HelioCheckout> widget (this endpoint is NOT used for that case).
// =============================================================================

import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const HELIO_API_BASE = process.env.HELIO_API_BASE_URL ?? "https://api.hel.io"
const HELIO_API_KEY = process.env.HELIO_API_KEY
const HELIO_API_TOKEN = process.env.HELIO_API_TOKEN

export async function POST(req) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { subscriptionId } = await req.json()
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "subscriptionId required" },
      { status: 400 }
    )
  }

  // 1. Resolve local user + verify ownership of the subscription
  const { data: localUser } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle()
  if (!localUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select(
      `
      id, status, helio_paylink_id,
      plans(price_cents, currency, title)
    `
    )
    .eq("id", subscriptionId)
    .eq("user_id", localUser.id) // ownership guard
    .maybeSingle()

  if (error || !sub) {
    return NextResponse.json(
      { error: "Subscription not found" },
      { status: 404 }
    )
  }

  // 2. Mint a fresh charge via Helio API
  const amountDecimal = (sub.plans.price_cents / 100).toFixed(2)
  const successUrl = `${process.env.NEXT_PUBLIC_APP_URL ??
    ""}/portal?sub=${subscriptionId}&renewed=1`

  const resp = await fetch(
    `${HELIO_API_BASE}/v1/charge/api-key?apiKey=${encodeURIComponent(
      HELIO_API_KEY
    )}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HELIO_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        paymentRequestId: sub.helio_paylink_id,
        requestAmount: amountDecimal,
        successRedirectUrl: successUrl,
        cancelRedirectUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
        prepareRequestBody: {
          customerDetails: {
            additionalJSON: JSON.stringify({ subscription_id: subscriptionId })
          }
        }
      })
    }
  )

  if (!resp.ok) {
    const text = await resp.text()
    return NextResponse.json(
      { error: `Helio charge failed: ${resp.status} ${text}` },
      { status: 502 }
    )
  }

  const data = await resp.json()
  const chargeUrl = data.pageUrl
  const chargeToken =
    chargeUrl.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
    )?.[1] ?? null

  // 3. Persist the charge URL + token on the subscription
  await supabase
    .from("subscriptions")
    .update({
      next_charge_url: chargeUrl,
      next_charge_token: chargeToken,
      next_charge_expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
    })
    .eq("id", subscriptionId)

  // 4. Audit
  await supabase.from("subscription_events").insert({
    subscription_id: subscriptionId,
    event_type: "CHARGE_CREATED",
    next_charge_url: chargeUrl,
    next_charge_token: chargeToken,
    raw_payload: { charge_id: data.id, source: "user_renew_now" }
  })

  return NextResponse.json({ chargeUrl, chargeToken })
}
