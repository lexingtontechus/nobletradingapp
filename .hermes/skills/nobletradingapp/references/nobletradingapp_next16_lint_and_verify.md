# nobletradingapp: Next.js 16 lint migration + hermes verify manifest + SQL static validation (2026-08-11)

## Next 16 removed `next lint`
`npm run lint` fails instantly: `Invalid project directory provided, no such
directory: ...\nobletradingapp\lint` (Next treats the bare word as a dir;
the built-in command was removed in Next 16). The repo is plain JS
(`jsconfig.json`, NO tsconfig) and eslint was never installed — the
auto-detected `hermes verify` recipe's test phase (`npm run lint`) therefore
failed, making the whole workspace verify red.

## The fix (done 2026-08-11, verify now `ok: True`)
1. `npm i -D eslint@^9 eslint-config-next@^16`
2. `package.json`: `"lint": "next lint"` → `"lint": "eslint ."`
3. `eslint.config.mjs` (flat config; Next 16 pattern):
   ```js
   import { defineConfig, globalIgnores } from "eslint/config";
   import nextVitals from "eslint-config-next/core-web-vitals";
   export default defineConfig([
     ...nextVitals,
     globalIgnores([".next/**", "node_modules/**", "supabase/**", "**/_*"]),
     { rules: { ... } },
   ]);
   ```
   JS-only repo → `core-web-vitals` only, NO `typescript` preset (a TS
   preset on `.ts` edge functions with no TS parser setup would fail to
   parse).

### Legacy-baseline policy (never-linted codebase)
The codebase had 83 findings on first run. Do NOT "fix all" (that's a
lint-debt project). Configure honestly:
- **Ignore dead/scratch code**: `"**/_*"` (underscore-prefixed files AND
  `_archive/` dirs — Next convention for non-routes). The scary findings
  (12 `react-hooks/rules-of-hooks`, 4 `react/jsx-no-undef`) were ALL in
  `_archive/`/`_`-prefixed scratch files — dead code, not live bugs.
  ALWAYS split findings into live vs dead before treating them as bugs.
- **Off**: `react/no-unescaped-entities` (legal/marketing copy uses raw
  quotes intentionally), `@next/next/no-img-element` (legacy `<img>`, no
  image-optimization dep).
- **Warn**: `react-hooks/set-state-in-effect`, `react-hooks/exhaustive-deps`
  (fetch-in-effect pattern predates the rule; missing deps often
  intentional), `@next/next/no-location-assign-relative-destination`.
- **Keep ERROR**: `react-hooks/rules-of-hooks`, `react/jsx-no-undef` — the
  genuine-bug rules stay strict for future live code.
- Result: `eslint .` exits 0 with the debt visible as warnings (8 warnings,
  0 errors) — honest, not hidden.

## `hermes verify` auto-detected Next recipe HANGS on start/readiness (Windows)
With NO saved manifest, `hermes verify` auto-detects a Next.js recipe with a
`start` phase (`next start` on :3000). On this host the readiness probe
never completes: the server binds :3000 fine but verify hangs (>600s) and
leaves an ORPHANED `next` process listening on 3000 (kill via
`Get-CimInstance Win32_Process | Where CommandLine -match 'next'` +
`Stop-Process`).
FIX — save `.hermes/environment.json` with `"start": null` (same pattern as
the agent repo, see `references/hermes_verify_agent_start_null.md`):
bootstrap `npm install`, build `npm run build`, test `npm run lint`,
`"start": null, "port": 0, "readinessPath": null`. Verify then reports
`ok: True` (readiness null). Also remember the safety rule: never boot a
trading engine / long-lived app as a verify step.

## Pipe masks exit codes
`npm run lint 2>&1 | tail -30` reports exit 0 even when eslint FAILS (the
pipe's last command wins). Get the true status with
`echo "EXIT: ${PIPESTATUS[0]}"` or run without the pipe. (Also: the
`verification_evidence.status: passed` from a piped run is a harness
artifact of the masked exit code — trust the real exit code.)

## sqlglot — static Postgres SQL validation with NO local Postgres
The user applies Supabase migrations manually (SQL editor); there is no
psql/Docker on this host. To catch syntax errors before handing the script
over:
```bash
python -m pip install --quiet --target /tmp/sqlglot_pkg sqlglot
PYTHONPATH=/tmp/sqlglot_pkg python - <<'EOF'
import sqlglot
stmts = sqlglot.parse(open(r"<path>.sql", encoding="utf-8").read(), read="postgres")
print("ok —", len(stmts), "statements, no syntax errors")
EOF
```
- Use `sqlglot.parse` (plural) — it tokenizes correctly. A naive
  `split(';')` produces FALSE positives: comment-only chunks fail, and a
  PL/pgSQL `DO $$ ... $$` block's inner semicolons shatter the statement.
- `CREATE EXTENSION` and `DO $$...$$` fall back to "Command" parsing
  (expected — sqlglot lacks full PL/pgSQL grammar); treat that as OK.
- sqlglot is a parser, not a validator: still cross-check column names,
  NOT NULLs, and enum values against the migrations by hand.

## Links
- Sibling: `references/talaria_claims_admin_testing.md` (the SQL script this
  workflow validated).
- Sibling: `references/hermes_verify_agent_start_null.md` (agent-repo case
  of the start:null manifest).
- `references/talaria_analytics_build.md` §'hermes verify on Windows' — the
  backend-repo cmd.exe manifest fix (different repo, same class).
