// Service-role Supabase client for admin/server-only operations.
//
// IMPORTANT: This bypasses Row Level Security. Use ONLY in server components
// or API routes that have already verified the user is an admin (e.g. via
// checkRole("admin")). NEVER import this in a client component — the
// SUPABASE_SERVICE_ROLE_KEY must never reach the browser.
//
// The admin dashboard widgets use this so they can read across ALL users
// (RLS on the user-JWT client would limit them to the admin's own rows).

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  // Fail loud at module load if env is missing — better than silent 401s.
  console.error(
    "[supabase/_server] Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
}

export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
