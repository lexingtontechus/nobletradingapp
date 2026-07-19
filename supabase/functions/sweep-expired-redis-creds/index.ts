// =============================================================================
// Noble Trading App — Supabase Edge Function: sweep-expired-redis-creds
// =============================================================================
// Daily cron safety net. Catches Redis credentials that should have been
// revoked by the webhook but weren't (e.g. webhook delivery failed after all
// 12 Helio retries, or the user cancelled via Stripe/etc. bypass).
//
// Logic:
//   1. SELECT all redis_credentials WHERE revoked_at IS NULL AND the
//      subscription status is IN ('expired', 'cancelled').
//   2. For each: ACL DELUSER on Redis + UPDATE revoked_at.
//
// Idempotent: safe to re-run. A revoked row stays revoked.
//
// Triggered by pg_cron daily at 03:00 UTC (off-peak). See migration 0005.
// =============================================================================
// Env vars:
//   REDIS_ADMIN_URL             — rediss://<admin>:<pwd>@<host>:<port>
//   INTERNAL_FUNCTION_SECRET    — shared secret for X-Internal-Secret header
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Redis } from "npm:ioredis@5.4.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDIS_ADMIN_URL = Deno.env.get("REDIS_ADMIN_URL")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

Deno.serve(async (req: Request) => {
  // Allow triggering manually (with internal secret) OR via pg_cron (no secret
  // — pg_net doesn't easily set custom headers, so we accept the
  // X-Supabase-Cron marker header that migration 0005 sets).
  const secret = req.headers.get("x-internal-secret");
  const fromCron = req.headers.get("x-supabase-cron") === "true";
  if (!fromCron && (!INTERNAL_SECRET || secret !== INTERNAL_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 1. Find all non-revoked creds whose subscription is expired or cancelled.
  const { data: stale, error } = await supabase
    .from("redis_credentials")
    .select(`
      id, redis_username, subscription_id,
      subscriptions!inner(id, status)
    `)
    .is("revoked_at", null)
    .in("subscriptions.status", ["expired", "cancelled"]);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return Response.json({ ok: true, swept: 0 });
  }

  const redis = new Redis(REDIS_ADMIN_URL, { maxRetriesPerRequest: 3 });
  const results: Array<{ id: string; username: string; ok: boolean; error?: string }> = [];

  try {
    for (const row of stale) {
      const username = row.redis_username;
      try {
        await redis.call("ACL", "DELUSER", username);
        await supabase
          .from("redis_credentials")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", row.id);
        results.push({ id: row.id, username, ok: true });
      } catch (e: any) {
        // Mark revoked in DB anyway so we don't retry forever. The Redis user
        // may already be gone (e.g. manual deletion) — that's fine.
        await supabase
          .from("redis_credentials")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", row.id);
        results.push({ id: row.id, username, ok: false, error: e.message });
      }
    }
  } finally {
    redis.quit();
  }

  const swept = results.filter((r) => r.ok).length;
  const failed = results.length - swept;

  return Response.json({
    ok: true,
    swept,
    failed,
    details: results,
  });
});
