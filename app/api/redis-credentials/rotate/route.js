// =============================================================================
// Noble Trading App — Next.js API Route: POST /api/redis-credentials/rotate
// =============================================================================
// User-initiated credential rotation. Calls the redis-credentials-manager
// Edge Function with action=rotate. Zero-downtime: the new password is added
// to Redis ACL before the old one is removed, so any bot using the old
// password stays connected until the user updates their config.
//
//   POST /api/redis-credentials/rotate
//   → 200 { ok: true, passwordVersion: <new>, rotatedAt: <ISO> }
//   → 404 if no active credentials
//   → 401 if not signed in
//
// Ownership is verified server-side (we look up the user's own subscription
// before calling the Edge Function — never trust a subscriptionId from the
// client without checking it belongs to them).
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Resolve local user
  const { data: localUser } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (!localUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 2. Find the user's active subscription with non-revoked creds
  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select(`
      id, status,
      redis_credentials(id, revoked_at)
    `)
    .eq("user_id", localUser.id)
    .in("status", ["active", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !sub) {
    return NextResponse.json(
      { error: "No active subscription to rotate" },
      { status: 404 },
    );
  }

  const hasActiveCreds = (sub.redis_credentials ?? []).some((c: any) => !c.revoked_at);
  if (!hasActiveCreds) {
    return NextResponse.json(
      { error: "No active Redis credentials to rotate" },
      { status: 404 },
    );
  }

  // 3. Call the Edge Function (server-to-server, with the internal secret).
  //    The function URL is constructed from SUPABASE_URL env (Next.js side
  //    has NEXT_PUBLIC_SUPABASE_URL; the functions subdomain is the same host
  //    with /functions/v1/<name>).
  const functionsUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/redis-credentials-manager`;
  const internalSecret = process.env.INTERNAL_FUNCTION_SECRET;

  if (!internalSecret) {
    console.error("INTERNAL_FUNCTION_SECRET not set — cannot call Edge Function");
    return NextResponse.json(
      { error: "Server misconfigured: missing internal secret" },
      { status: 500 },
    );
  }

  try {
    const resp = await fetch(functionsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "X-Internal-Secret": internalSecret,
      },
      body: JSON.stringify({
        action: "rotate",
        subscriptionId: sub.id,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Edge Function rotate failed:", resp.status, text);
      return NextResponse.json(
        { error: `Rotation failed: ${text}` },
        { status: 502 },
      );
    }

    const result = await resp.json();
    return NextResponse.json({
      ok: true,
      passwordVersion: result.passwordVersion,
      rotatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("Rotate error:", e);
    return NextResponse.json(
      { error: e.message || "Rotation request failed" },
      { status: 500 },
    );
  }
}
