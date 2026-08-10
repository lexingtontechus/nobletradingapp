import { auth, clerkClient } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"

// Canonical client-side role source.
// The browser SDK (`useUser()`) only exposes publicMetadata, which the app
// keeps NULL for everyone by design — the admin role lives in Clerk
// PRIVATE metadata (server-readable only). This endpoint returns the role
// computed server-side so client components (header, portal) can gate admin
// UI without reading private metadata themselves.
//
//   GET /api/me → { userId, role: "admin" | "member" | null }
export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ userId: null, role: null }, { status: 200 })
  }
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
