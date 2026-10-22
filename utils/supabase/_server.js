// Service-role Supabase client for admin/server-only operations.
//
// IMPORTANT: This bypasses Row Level Security. Use ONLY in server components
// or API routes that have already verified the user is an admin (e.g. via
// checkRole("admin")). NEVER import this in a client component — the
// SUPABASE_SECRET_KEY must never reach the browser.
//
// The admin dashboard widgets use this so they can read across ALL users
// (RLS on the user-JWT client would limit them to the admin's own rows).

import { createClient } from "@supabase/supabase-js";

// Lazy singleton: createClient throws at module load when env is absent, which
// takes down the build at import time. Absent config becomes a null client the
// caller turns into an error render instead.
let _client = null;
let _warned = false;

export function getClient() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      if (!_warned) {
        _warned = true;
        console.error(
          "[supabase/_server] Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY"
        );
      }
      return null;
    }
    _client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _client;
}
