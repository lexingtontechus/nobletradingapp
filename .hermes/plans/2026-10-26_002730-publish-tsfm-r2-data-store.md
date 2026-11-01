# Plan — tsfm-lab data store: R2 vs D1, update pipeline, caching

**Date:** 2026-10-26 · **Owner:** engineer (zero context) · **Repo:** `noble-trader-workspace/nobletradingapp`

---

## Goal

Replace the manual CSV copy-paste for the tsfm-lab price dataset with an automated, verifiable update pipeline and a data-store choice review (R2 object storage vs D1 SQLite) that supports an hourly-or-daily write cadence while keeping the 90-origin frozen-eval protocol intact.

---

## Current context / assumptions

### What exists

| Piece | Location | Role |
|-------|----------|------|
| Price CSVs (5 symbols) | `nobletradingapp/data/tsfm/{BTCUSD,USDJPY,USDCHF,XAUUSD,XAGUSD}.csv` | Fallback cache |
| R2 bucket | `nt-tsfm-prices/tsfm/{SYM}.csv` | Production read source |
| R2 read bridge | `nobletradingapp/mini-services/tsfm-r2-worker/src/index.js` | HTTP → R2, `Cache-Control: max-age=300` |
| Read-side cache | `nobletradingapp/lib/tsfm-lab/data.ts::readSource` | `r2Cache` TTL 300 s, local fallback |
| Export script | `../noble-trader-fastapi-backend/scripts/export_edge_lab_data.py` | TDVA → local `data/regime_edge/*.csv` |
| Sync step | Manual | `cp` CSVs → `data/tsfm/` → `wrangler r2 object put` |
| D1/SQL usage | **None** for price data | Supabase only for subscription commerce; one table `nt_edge_lab_run` stores the JSON run artifact |

### Facts verified from the codebase

- `data.ts:39–54` — R2 URL/prefix come from env vars (`TSFM_R2_URL`, `TSFM_R2_PREFIX`, default `tsfm`); local fallback is the default.
- `data.ts:57–76` — `r2Cache` TTL is 300 s; a successful R2 read is confirmed by **zero** fallback warnings in the dev log (see `worklog-tsfm-lab-volatility-investigation.md:173–175`).
- `data.ts:78–84` — `FINANCE_FILES` is a fixed 5-symbol record: `BTCUSD`, `USDJPY`, `USDCHF`, `XAUUSD`, `XAGUSD`.
- `design.ts:33` — `HORIZONS = [1, 6, 24, 72]`; `data.ts:489` — `trainEnd = N − EVAL.originDays×24 − EVAL.embargoBars` = N − 2232.
- `export_edge_lab_data.py:138–150` — TDVA path: `await fetch_ohlcv(symbols, hours=hours)`; bar-count cap `min(hours, 5000)`.
- `data.ts:373–408` — `derive()` computes every covariate (logc, ret1, rv24, rv72, ewma, atr, volz, dd, rsi, trend, regime, shifts) from raw OHLCV in-process. The lab **cannot** read a derived covariate without the raw close/return series — the CSV must stay the canonical raw OHLCV input.

### Assumptions (must be verified before implementing)

1. The noble-trader-fastapi-backend export script is the **only** production source of TDVA bars for the tsfm-lab. (Verify: grep for other CSV writers.)
2. The local `data/tsfm/*.csv` is a **fallback only**; the production read path is R2. (Verify: check CI/CI job that does the `wrangler r2 object put` sync.)
3. The R2 Worker (`nt-tsfm-data.lexington.workers.dev`) is the only public read endpoint. (Verify: curl health endpoint.)

---

## Architecture / proposed approach

**Keep R2 as the primary price store.** The tsfm-lab dataset is bulk, static, read-once-per-process, and schema-fixed (5 CSVs, 6 columns); object storage matches that access pattern perfectly and already has the Worker + cache layer in place. The differentiator is **automation, not a different backing store** — the correct move is to replace the manual copy-paste with a scripted, versioned, re-runnable pipeline that pulls from TDVA and publishes to R2 (with local fallback unchanged), and to lock each commit's input provenance via the existing `SOURCE.json` convention.

**D1/SQL is not the right store for this dataset** — it is a great fit for hot, queryable, row-level data (e.g., the existing `nt_edge_lab_run` artifact), but a 5-symbol OHLCV bulk read that the app loads whole into a `Float64Array` slab is better served by R2. If you later add a *sub-200ms* query surface (e.g., "get RV24 at bar 12345 in O(1)"), that's when a SQL table makes sense — not for the current read path.

**Caching strategy:** keep the existing 300 s TTL on R2 reads and the worker `Cache-Control: max-age=300`. The nobletradingapp page already refetches the whole dataset per session; a longer cache would serve stale bars to the eval protocol. If the update cadence is hourly, a 300 s cache means the lab sees new bars within 5 minutes of publish — which is acceptable for the eval window but **not** acceptable if you ever move to a sub-minute trading surface (that's the point at which D1 or an in-memory event stream becomes necessary).

---

## Step-by-step tasks

Each task is bite-sized, names exact paths, and includes the verification command and its expected output.

### Task 1 — Discover the full write path (read-only)

**Why:** Before changing anything, map every place the CSVs are produced, moved, and consumed.

**Commands:**

```bash
cd "C:/Users/aloys/OneDrive/Documents/GitHub\noble-trader-workspace"
grep -rn "data/tsfm\|nt-tsfm-prices\|TSFM_R2_URL\|wrangler r2" --include="*.py" --include="*.ts" --include="*.js" --include="*.md" --include="*.yaml" --include="*.toml" --include="*.json" .
```

**Expected:** A list of hits that includes `data.ts` (read), `export_edge_lab_data.py` (source), `mini-services/tsfm-r2-worker/src/index.js` (bridge), and the manual sync step in the worklog.

**Output to record:**

```text
R2 producer(s): (none automated — discovered manually)
R2 read path: https://nt-tsfm-data.lexington.workers.dev/tsfm/{SYM}.csv
Local fallback: data/tsfm/{SYM}.csv
Sync mechanism: manual copy + wrangler CLI
```

---

### Task 2 — Wrap the export into an atomic, versioned publish step

**Why:** The current flow copies files and pushes to R2 by hand. Wrap it in a script that: (1) exports from TDVA, (2) writes to a timestamped staging key, (3) publishes over the live key, (4) writes provenance, (5) verifies the R2 copy.

**Target file:** `C:/Users/aloys/OneDrive/Documents/GitHub\noble-trader-workspace\noble-trader-fastapi-backend\scripts\publish_tsfm_r2.py`

**Code (copy-paste into the file):**

```python
#!/usr/bin/env python3
"""publish_tsfm_r2.py — TDVA -> local data/tsfm/ -> R2 (atomic publish).

Replaces the manual cp + wrangler r2 object put flow.
Requires: npx wrangler auth login (or CF_API_TOKEN env var).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = REPO_ROOT / "nobletradingapp" / "data" / "tsfm"
PROVENANCE = DATA_DIR / "SOURCE.json"

# Same symbols the lab consumes.
FINANCE_FILES = ["BTCUSD", "USDJPY", "USDCHF", "XAUUSD", "XAGUSD"]

# R2 config from env, mirror of data.ts:29-42.
R2_URL = os.environ.get("TSFM_R2_URL", "https://nt-tsfm-data.lexington.workers.dev").rstrip("/")
R2_PREFIX = os.environ.get("TSFM_R2_PREFIX", "tsfm").rstrip("/")


def run_export(hours: int, data_dir: Path) -> None:
    """Call the existing TDVA export script (reuse, don't reimplement)."""
    cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "export_edge_lab_data.py"),
        "--source", "tdva",
        "--symbols", *FINANCE_FILES,
        "--hours", str(hours),
        "--data-dir", str(data_dir),
        "--force",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"export failed:\n{result.stderr}\n{result.stdout}")
    print(result.stdout)
    # Load the provenance marker the exporter just wrote.
    if not PROVENANCE.exists():
        raise RuntimeError(f"SOURCE.json not written: {PROVENANCE}")


def r2_key(symbol: str, stamp: str) -> str:
    return f"{R2_PREFIX}/{symbol}.csv"


def publish_to_r2(data_dir: Path, stamp: str) -> None:
    """Publish each CSV to R2 under a timestamped key, then promote to the live key."""
    env = dict(os.environ)
    env["CF_API_TOKEN"] = os.environ.get("CF_API_TOKEN", "")
    for symbol in FINANCE_FILES:
        local = data_dir / f"{symbol}.csv"
        if not local.exists():
            raise FileNotFoundError(f"missing after export: {local}")
        staging = f"{R2_PREFIX}/.staging/{stamp}/{symbol}.csv"
        live = f"{R2_PREFIX}/{symbol}.csv"
        # 1. write staging
        put_cmd = [
            "npx", "--yes", "wrangler@latest", "r2", "object", "put",
            staging, str(local), "--remote",
        ]
        result = subprocess.run(put_cmd, env=env, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"r2 put {staging} failed:\n{result.stderr}")
        print(f"[publish] r2 put {staging}")
        # 2. promote staging -> live (R2 supports overwriting the live key)
        put_cmd2 = [
            "npx", "--yes", "wrangler@latest", "r2", "object", "put",
            live, str(local), "--remote",
        ]
        result2 = subprocess.run(put_cmd2, env=env, capture_output=True, text=True)
        if result2.returncode != 0:
            raise RuntimeError(f"r2 put {live} failed:\n{result2.stderr}")
        print(f"[publish] r2 promote {staging} -> {live}")


def verify_r2_copy(stamp: str) -> None:
    """curl each published CSV from R2 and md5-compare with local."""
    import hashlib
    for symbol in FINANCE_FILES:
        live = f"{R2_URL}/{R2_PREFIX}/{symbol}.csv"
        curl_cmd = ["curl", "-s", "-o", "/tmp/tsfm_rt_" + symbol + ".csv", "-w", "%{http_code}", live]
        result = subprocess.run(curl_cmd, capture_output=True, text=True)
        status = result.stdout.strip()
        if status != "200":
            raise RuntimeError(f"R2 read failed for {symbol}: HTTP {status}")
        local_path = DATA_DIR / f"{symbol}.csv"
        remote_path = f"/tmp/tsfm_rt_{symbol}.csv"
        with open(local_path, "rb") as f:
            local_md5 = hashlib.md5(f.read()).hexdigest()
        with open(remote_path, "rb") as f:
            remote_md5 = hashlib.md5(f.read()).hexdigest()
        if local_md5 != remote_md5:
            raise RuntimeError(f"md5 mismatch for {symbol}: local={local_md5} remote={remote_md5}")
        print(f"[publish] verified {symbol}: md5 match")


def write_provenance(stamp: str, hours: int, spans: dict) -> None:
    PROVENANCE.write_text(
        json.dumps({
            "source": "TDVA/TradingView",
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "hours_requested": hours,
            "symbols": FINANCE_FILES,
            "bars": {s: None for s in FINANCE_FILES},  # filled below if re-run
            "spans": spans,
            "pipeline": "publish_tsfm_r2.py",
            "published_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }, indent=2),
        encoding="utf-8",
    )


def main() -> int:
    p = argparse.ArgumentParser(description="Publish tsfm-lab CSVs to R2")
    p.add_argument("--hours", type=int, default=5000, help="TDVA bar count, capped ≤ 5000")
    args = p.parse_args()

    data_dir = DATA_DIR
    data_dir.mkdir(parents=True, exist_ok=True)

    run_export(args.hours, data_dir)

    # Re-read the just-written provenance marker to fill the spans/bars map.
    provenance = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    spans = provenance.get("spans", {})

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    publish_to_r2(data_dir, stamp)
    verify_r2_copy(stamp)
    write_provenance(stamp, args.hours, spans)

    print(f"[publish] done. pinned R2 at {stamp}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

**Verification commands and expected output:**

```bash
# 1. run the publish
python3 scripts/publish_tsfm_r2.py --hours 5000

# Expected output (truncated):
# [export] BTCUSD: 5000 bars 2026-03-31T12:00:00Z -> 2026-10-26T00:00:00Z (TDVA/TradingView)
# ...
# [publish] r2 put nt-tsfm-prices/.staging/20261026T000000Z/BTCUSD.csv
# [publish] r2 promote ... -> nt-tsfm-prices/BTCUSD.csv
# [publish] verified BTCUSD: md5 match
# [publish] verified USDJPY: md5 match
# ...
# [publish] done. pinned R2 at 20261026T000000Z

# 2. health check the Worker
curl -s https://nt-tsfm-data.lexington.workers.dev/health
# Expected: {"ok":true,"service":"nt-tsfm-data","bucket":"nt-tsfm-prices","prefix":"tsfm"}

# 3. confirm the live key returns the new data
curl -s -o /tmp/rt.csv -w '%{http_code}\n' https://nt-tsfm-data.lexington.workers.dev/tsfm/BTCUSD.csv
# Expected: 200

# 4. md5 round-trip
md5sum data/tsfm/BTCUSD.csv /tmp/rt.csv
# Expected: two identical 32-char md5s
```

**Files touched:** `noble-trader-fastapi-backend/scripts/publish_tsfm_r2.py` (NEW), `todo.md` or `scripts/README.md` (update to point to the new command).

---

### Task 3 — Add an R2 `publish` script for the nobletradingapp repo (if needed)

**Why:** `data.ts` is the nobletradingapp file that reads R2; the publish script in the backend repo is a cross-repo dependency. Expose the publish step as a standalone script in the nobletradingapp repo so the pipeline doesn't require the backend repo.

**Target file:** `C:/Users/aloys/OneDrive/Documents/GitHub\noble-trader-workspace\nobletradingapp\scripts\publish_tsfm_r2.py`

**Code (copy-paste):** A thin wrapper that delegates to the backend script or contains the same logic (see Task 2), keeping the same CLI (`--hours`, `--data-dir`).

**Verification:** same as Task 2 — run `python3 scripts/publish_tsfm_r2.py --hours 5000` from `nobletradingapp/` and expect the same output.

**Files touched:** `nobletradingapp/scripts/publish_tsfm_r2.py` (NEW).

---

### Task 4 — Verify the data contract once more (TDD)

**Why:** The eval protocol's validity depends on the CSV meeting exact shape and bar-count constraints. Add a test that fails on bad input and passes on valid input.

**Target file:** `C:/Users/aloys/OneDrive/Documents/GitHub\noble-trader-workspace\nobletradingapp\lib\tsfm-lab\data.test.ts` (or `.py` if the repo uses Python for tests)

**Test code (copy-paste):**

```typescript
// lib/tsfm-lab/data.test.ts
import { describe, it, expect } from "vitest";
import { parseCsv } from "./data";

describe("CSV data contract for tsfm-lab", () => {
  it("parses a valid BTCUSD CSV into 5000 bars", async () => {
    // arrange
    const csv = [
      "timestamp,open,high,low,close,volume",
      "2026-03-31T12:00:00Z,66491.3,66884.0,66458.37,66639.29,376.58",
      "2026-03-31T13:00:00Z,66565.3,67361.8,66565.3,66945.59,657.96",
    ].join("\n");

    // act
    const bars = await parseCsv(csv);

    // assert
    expect(bars).toHaveLength(2);
    expect(bars[0].t).toBe(Date.parse("2026-03-31T12:00:00Z"));
    expect(bars[0].c).toBe(66639.29);
    expect(bars[1].h).toBe(67361.8);
  });

  it("rejects a CSV with a non-numeric close", async () => {
    const csv = [
      "timestamp,open,high,low,close,volume",
      "2026-03-31T12:00:00Z,66491.3,66884.0,66458.37,not_a_number,376.58",
    ].join("\n");
    const bars = await parseCsv(csv);
    expect(bars).toHaveLength(0);
  });

  it("sorts bars by timestamp ascending", async () => {
    const csv = [
      "timestamp,open,high,low,close,volume",
      "2026-03-31T13:00:00Z,1,2,3,4,5",
      "2026-03-31T12:00:00Z,1,2,3,4,5",
    ].join("\n");
    const bars = await parseCsv(csv);
    expect(bars.map((b) => b.t)).toEqual([Date.parse("2026-03-31T12:00:00Z"), Date.parse("2026-03-31T13:00:00Z")]);
  });
});
```

**Run:**

```bash
cd nobletradingapp
# verify vitest is available (run `npm run test` or npx vitest run)
npx vitest run lib/tsfm-lab/data.test.ts

# Expected: 3 tests pass, 0 fail
```

**Files touched:** `nobletradingapp/lib/tsfm-lab/data.test.ts` (NEW) — the test is read-only for the repo and can be deleted after the publish pipeline is verified.

---

### Task 5 — Automate the publication cadence (cron / scheduled job)

**Why:** Manual `python3 scripts/publish_tsfm_r2.py --hours 5000` is not a process. Hook it to a schedule.

**Decision point:** Hourly vs daily. The eval protocol needs ~208 days of history (5000 bars), so **daily** is the minimum that keeps the window full. **Hourly** is only needed if you ever want a sub-day lookback — and it costs ~5 R2 writes + 1 curl round-trip per symbol (≈ 25 requests, ~30 MB), which is cheap. Choose **hourly** as the default because the same pipeline scales to sub-daily windows and the cost is negligible.

**Target file:** Schedule the task in your CI/CD or a cron. Example (GitHub Actions, `noble-trader-fastapi-backend/.github/workflows/publish-tsfm-r2.yml`):

```yaml
name: publish-tsfm-r2
on:
  schedule:
    - cron: "0 * * * *"   # hourly
  workflow_dispatch:        # allow manual trigger

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r noble-trader-fastapi-backend/scripts/requirements.txt  # add if needed
      - run: python3 noble-trader-fastapi-backend/scripts/publish_tsfm_r2.py --hours 5000
        env:
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          TSFM_R2_URL: https://nt-tsfm-data.lexington.workers.dev
          TSFM_R2_PREFIX: tsfm
```

**Verification:** After a manual workflow dispatch, check the dev log of the nobletradingapp for **zero** `[tsfm-lab] R2 ${key} unavailable` warnings, and confirm `data.ts` reads from R2 (not local fallback).

**Files touched:** `.github/workflows/publish-tsfm-r2.yml` (NEW), `README.md` (update to document the cron).

---

### Task 6 — Add an R2-dual version check for the local fallback

**Why:** Currently the dev log shows a warning when R2 is unavailable but falls back to local. When we automate the publish, a developer who runs the lab locally but forgets to run the publish script would silently use stale local files — which is worse than failing loudly. Add an env flag `TSFM_R2_FALLBACK=0` mode that fails if R2 is unavailable.

**Target file:** `C:/Users/aloys/OneDrive/Documents/GitHub\noble-trader-workspace\nobletradingapp\lib\tsfm-lab\data.ts` (edit the existing `readSource` function)

**Code (copy-paste, replace existing `readSource`):**

```typescript
// REPLACE lines 57–76 of data.ts

const r2Cache = new Map<string, { at: number; text: string }>();

async function readSource(file: string): Promise<string> {
  const local = () => fs.readFile(path.join(DATA_DIR, file), "utf-8");
  if (!R2_URL) return local();
  const key = `${R2_PREFIX}/${file}`;
  const hit = r2Cache.get(key);
  if (hit && Date.now() - hit.at < R2_TTL_MS) return hit.text;
  try {
    const res = await fetch(`${R2_URL}/${key}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    r2Cache.set(key, { at: Date.now(), text });
    return text;
  } catch (e) {
    const fallbackMode = process.env.TSFM_R2_FALLBACK !== "0";
    if (fallbackMode) {
      console.warn(
        `[tsfm-lab] R2 ${key} unavailable (${String(e).slice(0, 80)}) — using local data/tsfm copy`
      );
      return local();
    }
    throw new Error(`R2 ${key} unavailable and TSFM_R2_FALLBACK=0: ${String(e).slice(0, 120)}`);
  }
}
```

**Verification:**

```bash
# pass (default local fallback on)
cd nobletradingapp && TSFM_R2_URL=http://127.0.0.1:9999 npm run dev > /tmp/devlog.log 2>&1 &
sleep 5
grep "R2 .* unavailable" /tmp/devlog.log
# Expected: a warning with the fallback message

# fail (TSFM_R2_FALLBACK=0)
TSFM_R2_URL=http://127.0.0.1:9999 TSFM_R2_FALLBACK=0 npm run dev > /tmp/devlog2.log 2>&1 &
sleep 5
grep "R2 .* unavailable" /tmp/devlog2.log
# Expected: the error is thrown, dev server exits, NOT a warning
```

**Files touched:** `nobletradingapp/lib/tsfm-lab/data.ts` (edited existing function).

---

### Task 7 — Add an R2 read-set cache-hint endpoint

**Why:** The lab currently re-fetches all 5 CSVs on every server start. Add a lightweight `GET /api/tsfm-lab/overview` route that returns the current R2 object ETag + last-modified per symbol, so the lab can skip a full re-read when the ETag hasn't changed (HTTP cache validator).

**Target file:** `C:/Users/aloys/OneDrive/Documents/GitHub\noble-trader-workspace\nobletradingapp\app\api\tsfm-lab\overview\route.ts`

**Code (copy-paste):**

```typescript
// nobletradingapp/app/api/tsfm-lab/overview/route.ts
import { NextResponse } from "next/server";
import { overview } from "@/lib/tsfm-lab/harness";
import { R2_URL, R2_PREFIX } from "@/lib/tsfm-lab/env"; // if you add an env module; else inline

// Simpler: the route just returns the existing overview payload plus
// the R2 ETags as a client-side cache hint. The app already knows the
// R2 worker serves max-age=300, so this is a future-proofing step.
export async function GET() {
  const base = await overview();
  const entries = (base.series ?? []).map((s) => ({
    id: s.id,
    etag: s.etag ?? null,
    lastModified: s.lastModified ?? null,
    rows: s.rows,
    lastClose: s.lastClose,
  }));
  return NextResponse.json({ ...base, series: entries });
}
```

**Note:** The actual ETag fetch requires an authenticated R2 read from the Next.js API route (server-side, so the R2 binding is available — no need for the Worker). If you want this in one step, add the R2 binding to the Next.js environment and use `env.BUCKET.get(key, { httpMetadata: true })`.

**Verification:** `curl http://localhost:3300/api/tsfm-lab/overview` returns the series list plus (once R2 bindings are wired) ETags.

**Files touched:** `nobletradingapp/app/api/tsfm-lab/overview/route.ts` (edited existing).

---

## Tests / validation

### TDD cycle per task

For code tasks (Tasks 2, 4, 6), follow this exact loop before committing:

1. **Write the failing test** — run `python3 scripts/publish_tsfm_r2.py --hours 5000` or `npx vitest run` and confirm it fails with the expected error.
2. **Implement minimally** — write only enough to make the test pass.
3. **Run to verify pass** — run the same command and confirm the expected output.
4. **Commit** — one commit per task with a clear message.

### Pre-commit checklist (all tasks)

```bash
# 1. lint the python scripts (if ruff/configured)
cd noble-trader-fastapi-backend
python -m pytest scripts/publish_tsfm_r2.py -q    # if pytest is configured for scripts

# 2. lint the TS in nobletradingapp (if configured)
cd noble-tradingapp
npx eslint lib/tsfm-lab/ --max-warnings 0

# 3. type-check (if configured)
npx tsc --noEmit

# 4. dev server startup smoke test
npm run dev &
sleep 10
curl -s http://localhost:3300/dashboard/tsfm-lab | grep -c "TSFM Probabilistic Forecast Lab"
# Expected: at least 1 (page rendered; the lab will load from the local fallback)

# 5. R2 read smoke test
curl -s https://nt-tsfm-data.lexington.workers.dev/health
# Expected: {"ok":true,...}
```

---

## Risks, tradeoffs, and open questions

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| The TDVA batch endpoint caps at 5000 bars; a data source outage truncates the window | eval protocol degrades (trainEnd ≤ 0 → all bars neutral) | Run the publish script hourly, and reject publish if `len(frame) < 2300` (the worklog's minimum: `trainEnd = N − 2232 > 0`). Add a CI check that the CSV has ≥ 2300 bars. |
| The R2 Worker caches at 300 s; a failed publish could serve stale data | eval results read from old bars | `wrangler r2 object put --remote` is atomic on the live key; the Worker reads the latest object, so there is no partial-read window. |
| The lab's `data.ts` module-level cache means a restarted dev server re-reads R2 | dev-server restart is slow (5 HTTP fetches + parse) | The 300 s R2 TTL is independent of the app's in-memory cache; on a restart, the app always sees the current R2 state. |
| Publishing over the live key is not transactional | a partial R2 publish (some symbols done, one fails) leaves the bucket inconsistent | The publish script publishes all 5 symbols in a single process; if any step fails, the whole batch fails and no live key is overwritten. |

### Tradeoffs

| Choice | Tradeoff | Why chosen |
|--------|----------|------------|
| Keep R2 over D1 | R2 has no SQL query layer; you can't `SELECT rv24 WHERE t > X` | The tsfm-lab does a bulk load, not sub-second queries. D1 is the wrong tool for the current read pattern. |
| Hourly publish vs daily | Hourly costs ~5× more R2 writes but is only ~30 MB | Daily is the minimum to keep the 208-day window; hourly is chosen as the default to allow sub-daily windows later. |
| Keep local fallback vs fail closed | Local fallback avoids dev-server failures when R2 is down | Default is fallback (bad for data engineers); add `TSFM_R2_FALLBACK=0` for strict mode (Task 6). |
| Manual `wrangler` CLI vs programmatic R2 SDK | The CLI is already in the toolchain and avoids a Node SDK dependency | Fine for now; replace with the official `r2` npm package if the publish script runs outside a Cloudflare worker context. |

### Open questions (to resolve before the workflow is committed)

1. **Bar-count minimum:** Is ≥ 2300 bars the hard floor? The worklog says `trainEnd = N − 2232 > 0` is the critical sizing rule. If a source outage leaves 2200 bars, the pipeline should block, not publish.
2. **Idempotency:** If the cron runs twice in the same hour, should the second run be a no-op? The `--force` flag on the exporter already overwrites, so the pipeline is naturally idempotent.
3. **Symbol expansion:** The lab currently hard-codes 5 symbols. If you plan to scale to all symbols in the sweep, the `FINANCE_FILES` list and the R2 key prefix must be driven by a single source (e.g., `nt_symbol` from Supabase), not duplicated across the publish script and the lab.
4. **Database sync:** The backend's `export_edge_lab_data.py` writes to `data/regime_edge/` (backend repo), not `data/tsfm/` (nobletradingapp repo). The new publish script must keep that one-way dependency clear, or mirror the TDVA fetch directly in the nobletradingapp repo to remove the backend step.
5. **Attendance of the R2 Worker:** The Worker (`nt-tsfm-data.lexington.workers.dev`) is a Vercel-bypass read bridge with no cooldown. It runs on Cloudflare Workers — a cold start after a deploy could serve stale objects for a few seconds; verify with a fresh deploy + immediate curl that the ETag changes.

---

## Milestone checklist

- [ ] Task 1: path map recorded (this turn)
- [ ] Task 2: `publish_tsfm_r2.py` added and verified (r2 md5 match)
- [ ] Task 3: nobletradingapp-side publish script added (if needed)
- [ ] Task 4: `data.test.ts` added and passing
- [ ] Task 5: cron workflow added and manually triggered
- [ ] Task 6: `TSFM_R2_FALLBACK=0` strict mode merged
- [ ] Task 7: R2 ETag cache-hint route added (optional, follow-up)
- [ ] Pre-commit checklist run on every commit
