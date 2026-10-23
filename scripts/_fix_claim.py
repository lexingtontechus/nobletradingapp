from pathlib import Path

# Fix talaria-claim 500: null user after upsert; safer upsert
p = Path(
    r"C:\Users\aloys\OneDrive\Documents\GitHub\noble-trader-workspace\nobletradingapp\app\api\talaria-claim\route.js"
)
c = p.read_text(encoding="utf-8")

old = """  let user = localUser
  if (!user) {
    const clerk = await clerkClient()
    const u = await clerk.users.getUser(userId)
    const email = u.emailAddresses[0]?.emailAddress
    if (!email) {
      return NextResponse.json({ error: "No email on Clerk user" }, { status: 400 })
    }
    const { data: nu } = await supabase
      .from("users")
      .upsert(
        {
          clerk_user_id: userId,
          email,
          role:
            u.publicMetadata?.role === "admin" ||
            u.privateMetadata?.role === "admin"
              ? "admin"
              : "member"
        },
        { onConflict: "clerk_user_id" }
      )
      .select("id")
      .single()
    user = nu
  }
"""

new = """  let user = localUser
  if (!user) {
    const clerk = await clerkClient()
    const u = await clerk.users.getUser(userId)
    const email = u.emailAddresses[0]?.emailAddress
    if (!email) {
      return NextResponse.json({ error: "No email on Clerk user" }, { status: 400 })
    }
    const role =
      u.publicMetadata?.role === "admin" || u.privateMetadata?.role === "admin"
        ? "admin"
        : "member"
    const { data: nu, error: upErr } = await supabase
      .from("users")
      .upsert(
        { clerk_user_id: userId, email, role },
        { onConflict: "clerk_user_id" }
      )
      .select("id")
      .maybeSingle()
    if (!nu) {
      // Fallback re-select (upsert returning can fail on some PostgREST versions)
      const { data: again } = await supabase
        .from("users")
        .select("id")
        .eq("clerk_user_id", userId)
        .maybeSingle()
      user = again
    } else {
      user = nu
    }
    if (!user?.id) {
      return NextResponse.json(
        { error: upErr?.message || "user_row_missing" },
        { status: 500 }
      )
    }
  }
"""

if old not in c:
    print("claim block not found")
else:
    c = c.replace(old, new, 1)
    print("claim fixed")

p.write_text(c, encoding="utf-8")
