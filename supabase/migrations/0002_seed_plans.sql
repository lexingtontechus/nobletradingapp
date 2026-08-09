-- =============================================================================
-- Noble Trading App — Seed plans
-- Migration: 0002_seed_plans
-- =============================================================================
-- Replace the paylink_id values with your real Helio Subscription Pay Link IDs
-- (from moonpay.hel.io dashboard → Create Payment → Subscription template).
-- The two NEXT_PUBLIC_NTA_* env vars in the Next.js app must match these.
-- =============================================================================

insert into public.plans
  (helio_paylink_id, title, description, price_cents, currency, interval,
   renewal_reminder_days, grace_period_days, is_active, sort_order)
values
  (
    '6887fd0323a031902fad1edf',   -- Signal Scout Helio paylink (real ID, not a template placeholder)
    'Signal Scout',
    'Entry-level trade signals & community access.',
    7900,                               -- $79.00/mo
    'USD',
    'MONTH',
    3,                                  -- remind 3 days before expiry
    3,                                  -- 3-day grace period
    true,
    1
  ),
  (
    '6888416852cb57fabb54485d',  -- Precision Pro Helio paylink (real ID, not a template placeholder)
    'Precision Pro',
    'Premium signals, live alerts & advanced analytics. Most popular.',
    19900,                              -- $199.00/mo
    'USD',
    'MONTH',
    3,
    3,
    true,
    2
  )
on conflict (helio_paylink_id) do update
  set title = excluded.title,
      description = excluded.description,
      price_cents = excluded.price_cents,
      renewal_reminder_days = excluded.renewal_reminder_days,
      grace_period_days = excluded.grace_period_days,
      is_active = excluded.is_active,
      sort_order = excluded.sort_order,
      updated_at = now();

-- =============================================================================
-- Schedule the daily renewal-reminder job (run once, after pg_cron enabled).
-- =============================================================================
-- Run this in the Supabase SQL editor (requires pg_cron + pg_net extensions
-- enabled at the project level):
--
--   select cron.schedule(
--     'send-renewal-reminders',
--     '0 9 * * *',                       -- daily at 09:00 UTC
--     $$
--     select net.http_post(
--       url    := 'https://<PROJECT_REF>.functions.supabase.co/send-renewal-reminders',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--         'Content-Type',  'application/json'
--       ),
--       body   := '{}'::jsonb
--     );
--     $$
--   );
-- =============================================================================
