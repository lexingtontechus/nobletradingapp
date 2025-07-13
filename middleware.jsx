import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

//const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);
//const isProtectedRoute = createRouteMatcher(["/admin(.*)"]);

// This Middleware does not protect any routes by default.
// See https://clerk.com/docs/references/nextjs/clerk-middleware for more information about configuring your Middleware
export default clerkMiddleware({
  publicRoutes: ["/", "/about", "/terms", "/privacy", "/sign-in", "/sign-up"],
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
