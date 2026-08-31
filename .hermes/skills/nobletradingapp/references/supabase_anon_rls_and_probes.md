# Supabase anon read-only + probes + studio-down diagnostics (2026-08-09)

## The incident — anon was NOT read-only live
Talaria/admin plugins use the PUBLIC anon key. Live probes showed anon could
PATCH/DELETE on nt_symbol / nt_sweep_result / nt_renko_bricks — HTTP 204 with
REAL mutation (an AAPL nt_symbol row deleted, AAPL sweep rows deleted, AAPL
brick directions flipped). Migrations 107/108 (SELECT-only anon policies)
were evidently never applied to the live project (or Supabase default
privileges override them). RULE: never trust a migration's intent — live-probe
the anon key before believing read-only.

## Anon read-only probe (safe sequence)
1. SELECT each table/view with the PUBLIC anon key (`apikey` +
   `Authorization: Bearer <anon>`) → must be 200.
2. WRITE probes (PATCH/DELETE/INSERT) → must be 401/403, NEVER 204.
   - WARNING: a 204 means the write SUCCEEDED — you just mutated production.
     Use NON-DESTRUCTIVE probes or be ready to restore immediately with the
     service key (SUPABASE_KEY in profiles/ultron/.env).
3. Anon key source: `nobletradingapp/.env.local`
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY` (sb_publishable_…).

## Fix pattern (migration 112)
- `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` (idempotent) on each table.
- DROP + CREATE SELECT-only anon policies (`FOR SELECT USING (true)` — no
  WITH CHECK → writes blocked by policy).
- `REVOKE INSERT, UPDATE, DELETE ON <t> FROM anon` + `GRANT SELECT ON <t> TO
  anon` — the privilege layer is the strongest guarantee (PostgREST checks
  privileges before RLS). service_role unaffected → backend keeps writing.

## Data repair (probe damage)
- Deleted nt_symbol row → re-insert from the class template (stocks:
  asset_class='stocks', data_source='tradingview',
  tradingview_symbol='NASDAQ:AAPL', exchange='NASDAQ', active=true,
  sweep_cron='0 20 * * sun', regime_cron='*/5 * * * *', plan_ids=[scout,pro]).
- Flipped brick directions → recompute deterministically from prices:
  `UPDATE nt_renko_bricks SET direction = CASE WHEN close_price < open_price
  THEN 'down' WHEN close_price > open_price THEN 'up' ELSE direction END
  WHERE symbol='AAPL' AND direction <> (same CASE);`

## Discord webhook probe technique (Cloudflare 1010)
- Plain urllib to discord.com/api/webhooks/* → `403 error code 1010`
  (Cloudflare browser-signature block). Fix: browser-like headers
  (User-Agent Chrome/126, Accept: application/json, Accept-Encoding: gzip)
  AND decompress the gzip body.
- `GET` the webhook URL (id/token are IN the URL) returns `name` +
  `channel_id` + `type` WITHOUT auth — the way to map each
  `DISCORD_WEBHOOK_*` env var → actual Discord channel.
- Verified map (2026-08-09): EQUITIES→#signals-equities (1524630673371959427),
  CRYPTO→#signals-crypto, METALS→#signals-metals, FOREX→#signals-forex;
  SIGNALS = 404 Unknown Webhook (legacy dead).
- Signal routing: `_resolve_signal_webhook` priority = per-plan webhook
  (SIGNAL_SCOUT/PRECISION_PRO unset → skipped) → per-asset-class
  (`stocks`→EQUITIES, `notifications/discord.py:200`) → SIGNALS fallback
  (dead). AAPL (asset_class='stocks') correctly routes to #signals-equities.

## 201-but-no-row diagnostic (ROOT CAUSE FOUND + RESOLVED 2026-08-09)
Symptom: orchestrator httpx log shows `POST .../nt_sweep_result HTTP/1.1 201
Created` for AAPL every tick, but ZERO AAPL rows in the table (all other 11
symbols' rows land). Full-payload probe inserts from outside PERSIST → the
table accepts AAPL. No DELETE code path exists. 201 + absent row = silent
skip → checked live-DB triggers/rules (SQL editor: `pg_trigger` /
`pg_rules` → NO rows — no trigger/rule existed).

**RESOLVED:** the root cause was a STALE orchestrator process (the known
"user restarted LightningAI but old process left running" pattern). Its
inserts 201'd at the HTTP layer but never persisted. FORCED
`lightning studio stop` + `start --name noble-trader-unified` fixed it —
AAPL rows persist immediately after the restart (verified:
`2026-08-09 03:55:04 sweep-light sell q=False`). Diagnostic chain: httpx
201 line → check the orchestrator boot line ("Starting sweep orchestrator
…" must be NEWER than the expected restart) → forced stop/start → confirm
fresh rows. When in doubt about process freshness, FORCE the restart
rather than trusting a "restart" the user ran.

## Studio-down signature ("signals stopped flowing")
- nt_sweep_result latest `sweep_timestamp` frozen for ALL symbols (~5+ min
  stale) = sweep down, not per-symbol.
- orchestrator.log ends at the last tick's "next run at:" line (no new ticks).
- main.log ends with `Shutting down` / `Finished server process [PID]` =
  clean exit; `lightning studio list` shows Stopped.
- Restart (user action): `PYTHONPATH="" lightning studio start --name
  noble-trader-unified`; verify a NEW boot line + fresh rows before trusting.
