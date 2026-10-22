-- =============================================================================
-- Noble Trading App — Migration 0033: expire lapsed subscriptions
-- =============================================================================
-- `subscriptions.status` is driven ONLY by Helio webhooks: the documented
-- state machine is "grace period expires unpaid → Helio fires ENDED →
-- status='expired'" (README.md:270, AGENTS.md:28). A missed webhook therefore
-- leaves a LAPSED row reading as `active` forever, and every gate that trusts
-- the column (portal plan picker, /api/edge-lab, /api/dashboard-data,
-- talaria-check) keeps granting access to someone whose period ended weeks
-- ago.
--
-- Observed 2026-10-22: 3 of 3 rows with status='active' were already past
-- their period end (earliest 2026-09-07, latest 2026-09-23; the check ran on
-- 2026-10-22). None had a renewal payment or a subscription event.
--
-- This migration adds the backstop:
--   1. expire_lapsed_subscriptions() — flips active/grace rows whose period
--      (grace_period_end, else current_period_end) is in the past to expired.
--   2. a daily pg_cron job calling it.
--
-- The read-side guard is separate and non-mutating: utils/subscription-access.js
-- computes effective status from the dates, so a missed cron run cannot
-- silently re-grant access. Belt and braces — the cron repairs the data, the
-- guard stops the damage.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + the 3-arg cron.schedule (which
-- unschedules any existing job of the same name first).
-- =============================================================================

create or replace function public.expire_lapsed_subscriptions()
returns integer as $$
declare
  n integer;
begin
  update public.subscriptions
     set status = 'expired'
   where status in ('active', 'grace')
     and coalesce(grace_period_end, current_period_end) < now();

  get diagnostics n = row_count;
  return n;
end;
$$ language plpgsql;

comment on function public.expire_lapsed_subscriptions() is
  'Flips lapsed active/grace subscription rows to expired. status is driven only by Helio ENDED webhooks; this is the date-based backstop for a missed webhook. Returns the number of rows changed.';

-- Daily at 04:17 UTC. Off-peak, and staggered from the 03:00 redis sweep.
select cron.schedule(
  'expire-lapsed-subscriptions',
  '17 4 * * *',
  $$ select public.expire_lapsed_subscriptions() $$
);

comment on schedule cron.job_schedule is
  'Daily 04:17 UTC: expire subscriptions whose period (grace_period_end, else current_period_end) has lapsed, so a missed Helio ENDED webhook cannot leave a lapsed row reading as active.';
