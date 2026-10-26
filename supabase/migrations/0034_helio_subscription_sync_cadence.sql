-- =============================================================================
-- Noble Trading App — Migration 0034: widen helio-subscription-sync to hourly
-- =============================================================================
-- WHY
-- ───
-- Supabase began metering Logs Ingest (free plan: 1 GB/month; billing starts
-- 2027, grace period now). A 24 h measurement of the project's log stream
-- (ClickHouse `logs`, via the Management API) showed this poller was the single
-- largest contributor:
--
--   /rest/v1/subscriptions        GET  1,781 req / 3.93 MB   30.1% of the window
--   /rest/v1/users                GET  1,895 req / 3.74 MB   28.6%
--   /rest/v1/subscription_events  GET    471 req / 1.08 MB    8.3%
--   /rest/v1/payment_transactions POST   473 req / 0.96 MB    7.3%
--   /rest/v1/plans                GET    103 req / 0.22 MB    1.7%
--                                             ─────────────────────────────
--   commerce subtotal                   4,723 req / 9.92 MB   76.0%
--
-- Every 15-minute tick issued a fixed ~6-call REST sequence per subscription
-- REGARDLESS of whether anything had changed: a user lookup, an existing-row
-- lookup, an unconditional payment_transactions upsert, an unconditional
-- subscription_events dedupe read, and an unconditional users identity PATCH.
-- At ~94 ticks/day that is ~5,000 requests/day of which the large majority were
-- no-ops.
--
-- The two companion changes that make an hourly cadence safe:
--   1. The Edge Function now short-circuits on an "unchanged" verdict (same
--      status + current_period_end + Helio transaction id) — no upsert, no
--      dedupe read, no identity PATCH. Redis provisioning and the Clerk badge
--      sync stay unconditional (external side effects, not Supabase REST).
--   2. The two repeating console lines are throttled to once per key per 24 h.
--
-- Either change alone is insufficient: the function change without the cadence
-- change leaves ~7 calls/tick x 94 ticks; the cadence change without the
-- function change would let a renewal sit unreconciled for up to an hour while
-- still paying the full per-tick cost.
--
-- SAFE TO APPLY
-- ─────────────
-- - Cron schedules are not durable application state; this is a trigger cadence,
--   and the previous schedule is recoverable by re-running migration 0007.
-- - The poller is idempotent (all writes are upserts / deduped inserts), so a
--   missed or delayed tick is simply picked up by the next one.
-- - Checkout UX is unaffected: app/portal/page.jsx fires /api/helio-sync every
--   15 s while status === 'pending', which invokes this same function
--   out-of-band, so a pending payment still flips within seconds.
-- - Minute :33 is collision-free against every other active cron job
--   (924 @ 2,7,...,57 · 886 @ */10 · 920 @ 11,25,39,53 · 927 @ 25 */6 ·
--   930 @ 27 */6 · 919 @ 09:00 · 929 @ 04:17 · 922 @ 21:00 · 921 @ 12:00 ·
--   928 @ Sun 03:00) — the stagger introduced by migration 178 in the Kairos
--   repo is preserved.
--
-- POST-RUN VERIFICATION
--   select jobid, jobname, schedule, active from cron.job
--     where jobname = 'helio-subscription-sync';
--   -- expect schedule = '33 * * * *'
--   select status, count(*) from cron.job_run_details
--     where jobid = 917 and start_time > now() - interval '2 hours'
--     group by status;
--   -- then, after ~24h, re-run the ingest breakdown in
--   -- docs/scopes/20261024_SUPABASE_LOG_INGEST_REVIEW.md §2a
-- =============================================================================

-- Idempotent: drop any existing schedule of this name first (the 3-arg
-- cron.schedule below also replaces a same-named job, but the explicit guard
-- matches migration 0007's pattern and makes re-runs unambiguous).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'helio-subscription-sync') then
    perform cron.unschedule('helio-subscription-sync');
  end if;
end $$;

select cron.schedule(
  'helio-subscription-sync',
  '33 * * * *',  -- hourly at :33 UTC (was */15 — see header)
  $$
    select net.http_post(
      url     := 'https://pcvscowltlrxzgxjurcr.functions.supabase.co/helio-subscription-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Supabase-Cron', 'true'
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);
