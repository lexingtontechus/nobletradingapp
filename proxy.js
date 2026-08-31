import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// /dashboard is the subscriber's primary view — accessible to all signed-in users.
// /admin is restricted to users with the 'admin' role (resolved server-side via /api/me).
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

// This Middleware protects /admin for non-admin users.
// Fast path: sessionClaims.privateMetadata.role (set by a custom JWT template).
// Fallback: fetch /api/me which reads Clerk privateMetadata server-side.
// See https://clerk.com/docs/reference/nextjs/clerk-middleware for more information.
export default clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    const { sessionClaims } = await auth();
    if (sessionClaims?.privateMetadata?.role === "admin") return;
    // Fallback — role lives in Clerk privateMetadata (not in the JWT).
    try {
      const res = await fetch(new URL("/api/me", req.url).toString(), {
        headers: { Authorization: req.headers.get("cookie") ?? "" },
      });
      if (res.ok) {
        const d = await res.json();
        if (d?.role === "admin") return;
      }
    } catch {
      // fall through to redirect
    }
    const url = new URL("/", req.url);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    //"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    //"/(api|trpc)(.*)",
    "/((?!.+\\.[\\w]+$|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
