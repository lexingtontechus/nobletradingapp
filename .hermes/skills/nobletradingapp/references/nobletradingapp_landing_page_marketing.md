# nobletradingapp Landing Page + Marketing Copy (2026-08-09, built + verified)

**File:** `app/page.js` — the marketing landing page. This repo uses `app/`
(NOT `src/app/` — that does not exist here). The page MUST remain a SERVER
component: no `'use client'`, no hooks; keep `import Link from "next/link"`.
A page-level `metadata` export is server-safe and overrides layout metadata
(good for marketing title/description).

## Approved copy = source of truth

`docs/marketing/*.md` is the approved marketing copy. Every claim, price, and
feature on the landing page must trace to these files — compress/restructure
wording but never invent product claims:

- `docs/marketing/talaria-plugin.md` — Talaria product description: live signal
  dashboard inside the Hermes desktop app (same window as chat); status-bar
  chip + docked side pane + single persistent in-app alert; Renko brick charts;
  full entry/stop-loss/take-profit on every signal; market-regime labels
  (bull/bear/volatility); hot-signals banner (stale after 10 min); 30-day
  signal health scoreboard (win rate, calibration bias, profit factor); signal
  science per symbol (Markov P(up in 3), brick-pattern, sizing what-if);
  paper portfolio + benchmark honesty on Pro; daily digest.
- `docs/marketing/signal-scout.md` — **$199.00 USD/month**, 10 curated symbols,
  quality-gated signals, full Talaria dashboard, community (Discord) access.
- `docs/marketing/precision-pro.md` — **$599/month**, Talaria Signals,
  20 curated symbols, live alerts & advanced analytics, paper portfolio +
  portfolio analytics (Sharpe/Sortino/Calmar/max DD/vol/profit factor),
  **"Most popular"**.
- Payments: crypto USDC via MoonPay Commerce (Hel.io) checkout.

## Web-app design system (NOT the dui- bundle)

- The web app uses **plain daisyUI classes** (`btn`, `btn-primary`,
  `btn-secondary`, `btn-outline`, `card`, `card-body`, `card-title`, `badge`,
  `badge-secondary`, `opacity-70`, `mx-auto max-w-4xl/5xl`, `text-center`,
  `grid`, `gap-6`, `hero`/`hero-content`). The `dui-`-prefixed bundle is the
  **Hermes desktop plugin** convention only — do not use it in this web app.
- Custom daisyUI `noble` theme in `app/globals.css`: dark by default
  (`color-scheme: dark`; base-100 ≈ oklch(28.8%…); primary = red-orange;
  secondary = gold/green; `radius-box: 2rem`).
- `<body>` carries a global `capitalize` class → rendered text is
  word-capitalized. Avoid relying on `text-transform`; use `uppercase` via
  className where needed.
- Header + Footer auto-render from `app/layout.js` (ClerkProvider, dark theme,
  modal sign-in, waitlistUrl=/waitlist) — do NOT add header/footer to the page.
- Known routes: `/pricing`, `/waitlist` (Clerk-wired), `/payment/success`
  (must be `page.jsx` inside a folder), `/portal`. Suggested landing structure
  (verified working): hero (headline + subhead + CTAs to /pricing and
  /waitlist) → Talaria teaser → 3 feature cards → plans teaser strip with
  Most-Popular badge → final waitlist CTA band.

## Verification

- `write_file`'s auto-lint shows a FALSE `MODULE_NOT_FOUND` with a mangled
  `C:\c\Users\...` path on this OneDrive/MSYS setup — not a real syntax error.
  Verify with `node --check app/page.js` and the real build.
- `npm run build 2>&1 | tail -30; echo "EXIT_CODE=${PIPESTATUS[0]}"`
  (bash/git-bash on this host).
- **"Another next build process is already running"** → a previous build is
  still active (common here — prior work often leaves one). Check
  `tasklist //FI "IMAGENAME eq node.exe"` (empty = done); `.next` artifact
  mtimes show when the other build finished. Wait ~20s and retry — do not
  treat the first failure as a real build failure.
- Confirm the route compiled:
  `node -e "console.log(require('./.next/app-path-routes-manifest.json')['/page'])"` → `/`.
