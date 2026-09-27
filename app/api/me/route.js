import { auth, clerkClient } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Canonical client-side role source.
// Prefer the local users.role mirror (~200ms) — Clerk getUser is ~1s and was
// the entire /api/me application-code time. Clerk is only a fallback when the
// mirror has not been written yet (legacy users / first visit).
//
//   GET /api/me → { userId, role: "admin" | "member" | null }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

export async function GET() {
  const { userId, sessionClaims } = await auth()
  if (!userId) {
    return NextResponse.json({ userId: null, role: null }, { status: 200 })
  }

  // 1. Session claims (custom JWT template) — zero round-trips.
  const claimRole =
    sessionClaims?.metadata?.role ||
    sessionClaims?.publicMetadata?.role ||
    null
  if (claimRole === "admin" || claimRole === "member") {
    return NextResponse.json({ userId, role: claimRole })
  }

  // 2. Local users.role mirror (written by create-subscription /
  //    subscription-status / talaria-claim upserts).
  try {
    const { data: localUser } = await supabase
      .from("users")
      .select("role")
      .eq("clerk_user_id", userId)
      .maybeSingle()
    if (localUser?.role === "admin" || localUser?.role === "member") {
      return NextResponse.json({ userId, role: localUser.role })
    }
  } catch {
    // fall through to Clerk
  }

  // 3. Clerk metadata (authoritative, slow) — only when role is still unknown.
  let role = null
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    const pm = user.publicMetadata?.role
    const priv = user.privateMetadata?.role
    if (pm === "admin" || priv === "admin") role = "admin"
    else if (pm === "member" || priv === "member") role = "member"
  } catch {
    // best-effort — role stays null on transient Clerk errors
  }
  return NextResponse.json({ userId, role })
}
