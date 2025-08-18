import { createBrowserClient } from "@supabase/ssr";

let supabase = null;

export function createClient() {
  if (!supabase) {
    supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY
    );
  }
  return supabase;
}
