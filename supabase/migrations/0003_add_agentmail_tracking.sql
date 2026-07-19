-- =============================================================================
-- Noble Trading App — Migration 0003: AgentMail delivery tracking columns
-- =============================================================================
-- Adds AgentMail message_id / thread_id columns to reminder_emails so we can
-- correlate delivery webhooks (message.sent / delivered / bounced / rejected)
-- back to the reminder row that triggered them.
--
-- Background: AgentMail posts delivery events via Svix (verified via
-- /webhooks-overview). Each event carries `message_id` + `thread_id` (the same
-- values returned synchronously from POST /v0/inboxes/{inbox_id}/messages/send).
-- Storing them on the reminder_emails row lets a future Edge Function (e.g.
-- `agentmail-webhook`) do:
--   UPDATE reminder_emails
--   SET status = 'bounced', delivered_at = $event_timestamp
--   WHERE agentmail_message_id = $event.message_id;
-- =============================================================================
-- Also adds columns to subscriptions for the optional `agentmail_thread_id`
-- (so reminders for the same subscription can be threaded together — AgentMail
-- supports passing `thread_id` on subsequent sends to thread replies).
-- =============================================================================

-- 1. reminder_emails: capture AgentMail identifiers for delivery-webhook correlation
alter table public.reminder_emails
  add column if not exists agentmail_message_id text,
  add column if not exists agentmail_thread_id text,
  add column if not exists delivered_at            timestamptz,
  add column if not exists bounced_at              timestamptz;

-- Index for the agentmail-webhook lookup-by-message-id path.
create index if not exists reminders_agentmail_message_id_idx
  on public.reminder_emails (agentmail_message_id)
  where agentmail_message_id is not null;

comment on column public.reminder_emails.agentmail_message_id is
  'AgentMail message_id from POST /messages/send response. Used to correlate delivery webhooks (sent/delivered/bounced/rejected).';
comment on column public.reminder_emails.agentmail_thread_id is
  'AgentMail thread_id from POST /messages/send response. Replies can be threaded by passing this on subsequent sends.';
comment on column public.reminder_emails.delivered_at is
  'Timestamp of the message.delivered webhook (recipient server confirmed). Null until then.';
comment on column public.reminder_emails.bounced_at is
  'Timestamp of the message.bounced webhook (delivery failed). Sets status=bounced.';

-- 2. subscriptions: optional AgentMail thread_id for threading all reminders
--    for the same subscription together (so the user sees a single thread in
--    their mail client instead of N separate emails).
alter table public.subscriptions
  add column if not exists agentmail_thread_id text;

comment on column public.subscriptions.agentmail_thread_id is
  'AgentMail thread_id from the first reminder send. Subsequent reminders pass this back to AgentMail so the user sees one threaded conversation.';
