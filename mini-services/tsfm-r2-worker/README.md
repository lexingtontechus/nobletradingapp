# nt-tsfm-data — R2 read bridge for the TSFM Lab

A ~30-line Cloudflare Worker that holds the R2 binding for `nt-tsfm-prices` and serves the
bucket's keys over plain HTTPS, so the app (which runs on Vercel and therefore has **no**
Workers binding) can read its pricing data with a plain `fetch` and no credentials.

## Why not just make the bucket public?

R2's Public Development URL (`https://pub-<hash>.r2.dev`) is the zero-infra option, but
enabling it is **dashboard-only** — there is no REST API and no wrangler command. Until it is
enabled, `pub-*.r2.dev` returns a generic Cloudflare HTML 404 for every path. This Worker is
the autonomous alternative and keeps the bucket private.

## URL

```
https://nt-tsfm-data.lexington.workers.dev/tsfm/BTCUSD.csv
```

Point the app at it:

```
TSFM_R2_URL=https://nt-tsfm-data.lexington.workers.dev
TSFM_R2_PREFIX=tsfm
```

The app appends `/${prefix}/${symbol}.csv` and falls back to `data/tsfm/*.csv` when a read
fails, so a missing key degrades to files instead of 500s.

## Deploy

```bash
export CF_API_TOKEN=...      # needs workers/scripts:read+edit AND account R2:read
export CF_ACCOUNTID=e787a0b54e75a41d1c25d8a9bc9f8809
npx --yes wrangler@latest deploy
```

`CF_API_TOKEN` in `nobletradingapp/.env.local` is the token that can do this — `R2_TSFM_TOKEN`
is scoped to Workers only (it 403s on `/r2/buckets`).

## Verify

```bash
curl -s https://nt-tsfm-data.lexington.workers.dev/health
curl -s -o /tmp/x.csv -w '%{http_code}\n' \
  https://nt-tsfm-data.lexington.workers.dev/tsfm/BTCUSD.csv
md5sum /tmp/x.csv data/tsfm/BTCUSD.csv   # must match
```

## Teardown

```bash
npx --yes wrangler@latest delete nt-tsfm-data --force
```

Deleting the Worker does not touch the bucket or its objects.
