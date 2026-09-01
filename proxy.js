import { clerkMiddleware, clerkClient, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// /dashboard is the subscriber's primary view — accessible to all signed-in users.
// /admin is restricted to users with the 'admin' role (resolved server-side).
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

// This Middleware protects /admin for non-admin users.
// Fast path: sessionClaims.metadata.role (only present if a custom JWT
// template adds publicMetadata to the session token — privateMetadata can
// NEVER appear here, Clerk does not allow it in JWT templates).
// Fallback: look up the user directly via the Backend API (clerkClient),
// which can read BOTH public and private metadata. This must be a direct
// SDK call, not a self-fetch to /api/me — an internal `fetch()` from
// middleware does not automatically forward the incoming request's session
// cookie, so /api/me would see no session and always report role: null.
// See https://clerk.com/docs/reference/nextjs/clerk-middleware for more information.
export default clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    const { userId, sessionClaims } = await auth();
    if (sessionClaims?.metadata?.role === "admin") return;
    if (userId) {
      try {
        const client = await clerkClient();
        const user = await client.users.getUser(userId);
        if (user.publicMetadata?.role === "admin" || user.privateMetadata?.role === "admin") {
          return;
        }
      } catch {
        // fall through to redirect
      }
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
