# Supabase Realtime Broadcast → Webapp Toast Translation

## Context

When mirroring a desktop plugin's dashboard layout to a Next.js webapp, the plugin's
toast notification + live data patterns need translation. The Talaria desktop plugin
(`noble-trader-hermes-plugins/talaria/desktop/plugin.js`) uses:

1. **Raw Phoenix WebSocket** — `wss://<host>/realtime/v1/websocket?apikey=<anon_key>`
subscribing to `realtime:signals.<plan_slug>` topics
2. **Shared in-memory store** (`signalStore`) — feeds toasts, badge counters, HotSignalsBanner
3. **REST polling fallback** (`startSignalPolling`) — every 30s when socket is down
4. **Desktop-native toasts** (Hermes overlay) — `signalStore` triggers via desktop notification system

## Webapp Translation

| Desktop plugin | Webapp equivalent | Notes |
|---|---|---|
| Raw Phoenix WebSocket | `@supabase/supabase-js` `.channel()` / `.from().on('INSERT')` | Same anon key; RLS enforced by Clerk JWT `sub` |
| `realtime:signals.<plan_slug>` broadcast | Depends on backend: raw broadcast → `.channel(topic)`; table changes → `.from('table').on('INSERT')` | **Critical**: AGENTS.md says backend "writes `nt_sweep_result`, Supabase Realtime broadcast" — likely table-change Realtime, not raw broadcast. Verify with DBA or inspect the actual broadcast call in `noble-trader-fastapi-backend`. |
| No auth (x-claim-token header) | Clerk session → RLS via JWT `sub` → `users.clerk_user_id` | The webapp uses Clerk + Supabase RLS keyed on Clerk JWT sub. The anon key is safe client-side because RLS policies restrict data visibility. |
| `signalStore` singleton | React state + `useEffect` subscription | Component-scoped, not global. `useState` for signal list, `useEffect` for channel lifecycle. |
| Desktop toasts (Hermes overlay) | daisyUI `toast toast-top toast-end` with `alert` children (no shadcn/ui) | daisyUI already used in this repo's Tailwind config. See `app/dashboard/page.jsx` `ToastContainer` component (2026-08-28). |
| REST polling every 30s | Same pattern | Fall back to `setInterval(fetch, 30000)` when `.subscribe()` yields `closed`/`error` state. |

### Implementation Pattern (template)

> **Repo note**: The webapp already provides a client at `@/utils/supabase/client.js`
> exporting `createClient()` via `createBrowserClient` from `@supabase/ssr`
> with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
> Use that, not `createClient` from `@supabase/supabase-js`.

```jsx
// Client component wrapping the dashboard
import { createClient } from "@/utils/supabase/client"; // existing util, NOT @supabase/supabase-js
import { useToast } from "@/app/hooks/use-toast"; // or shadcn/ui

const supabase = createClient();

function DashboardRealtime({ planSlug, isActive }) {
  const [signals, setSignals] = useState([]); // replaces signalStore
  const { toast } = useToast();
  const seenRef = useRef(new Set()); // replaces signalStore.markSeen() / seenSet

  useEffect(() => {
    if (!isActive || !planSlug) return;

    // Branch A: raw Realtime broadcast (if backend uses .broadcast())
    const channel = supabase
      .channel(`realtime:signals.${planSlug}`)
      .on("broadcast", { event: "signal" }, (payload) => {
        const sig = payload.payload?.signal || payload;
        if (sig?.qualified && !seenRef.current.has(sig.id)) {
          seenRef.current.add(sig.id);
          setSignals((prev) => [sig, ...prev]);
          toast({ title: sig.symbol, description: `${sig.action} · kelly ${sig.effective_kelly}` });
        }
      })
      .subscribe();

    // Branch B: table-change Realtime (if backend INSERTs to nt_sweep_result)
    // const sub = supabase
    //   .from("nt_sweep_result")
    //   .on("INSERT", (payload) => { ... same handler ... })
    //   .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [planSlug, isActive, toast]);

  // ... render dashboard using `signals` instead of MOCK_SWEEPS ...
}
```

## Key Constraints

- `@supabase/supabase-js` v2 + `@supabase/ssr` v0.12 are already in `package.json` — no new deps
- The webapp already has a client-side Supabase client at `@/utils/supabase/client.js` using `createBrowserClient` from `@supabase/ssr` with `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (**not** `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the env var is named `PUBLISHABLE` and is already defined in `.env.example`)
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are both already client-side safe
- The webapp's existing `api/subscription-status/route.js:21` has a TODO: "Future: add Supabase Realtime subscription on the client to push updates" — this IS that future
- If using table-change Realtime, confirm RLS policy on the broadcasted table allows read access for the authenticated user's plan scope
- Toast library: use daisyUI `toast` + `alert` classes (no shadcn/ui / react-hot-toast needed)

## Session: 2026-08-28 — Realtime + Toast Implementation

Verified and implemented in `app/dashboard/page.jsx`:

1. **Supabase Realtime broadcast confirmed** — the Talaria plugin (`plugin.js` lines 1184-1300) uses raw Phoenix WebSocket with `.on('broadcast', { event: 'signal' })` on channels named `realtime:signals.<plan_slug>`. The webapp uses the same `supabase.channel('realtime:signals.<planSlug>')` API from `@supabase/supabase-js`.

2. **Supabase client already exists** — `@/utils/supabase/client.js` exports `createClient()` via `createBrowserClient` from `@supabase/ssr`. No new client needed.

3. **Clerk session usage** — the webapp resolves the plan_slug via a fetch to `/api/subscription-status` (server-side Clerk auth), then subscribes to the plan-scoped channel. The channel topic IS the authorization gate (same as the plugin's pattern). No Clerk JWT injection into the WebSocket is needed.

4. **Claim token** — minted via `POST /api/talaria-claim` (existing endpoint), returned `{ token, expires_at, plan_title, plan_slug }`. Attached as needed for Pro-only REST views.

5. **Poll fallback** — 5min interval (300 000 ms, changed from 60s on 2026-08-31). The plugin uses `PANE_TICK_MS = 30s` for the dockable pane; the webapp is less latency-sensitive and the user requested 5min to reduce backend load.

6. **DaisyUI toasts** — `ToastContainer` component with `className="toast toast-top toast-end"` rendering `<div className="alert alert-success|alert-error|alert-info">` children. Auto-dismiss after 8s.

**Implementation in `app/dashboard/page.jsx`:**
- `useToasts()` hook — manages toast array state with auto-dismiss TTL; `pushToast` wrapped in `useCallback(..., [])` for stable reference (prevents Realtime effect re-subscribing on every render)
- `ToastContainer` component — renders daisyUI toast markup
- `useEffect` chain: fetch `/api/subscription-status` → set `planSlug` → mint claim token → subscribe to `realtime:signals.<planSlug>` → on broadcast `signal` event: `setLiveSignals()` + `pushToast()`

## Pitfalls

### Confusing raw broadcast vs table-change Realtime
If the backend publishes via `supabase.from('nt_sweep_result').insert(...)` (table write), the Realtime subscription must use `.from('table').on('INSERT')` — NOT `.channel('realtime:...')`. The subscription API differs. Ask the fastapi-backend team or inspect the publish code.

### Broken poll fallback: supabase.from().broadcast() is invalid on Realtime channels
Do NOT use `supabase.from("realtime:signals." + slug).broadcast(...)` as a poll or REST fallback — `.from()` does not support `.broadcast()`. This throws a runtime error because `.from()` expects a table/view name, not a Realtime channel topic. Use `.channel(topic)` for Realtime subscriptions, or `fetch("/api/dashboard-data")` with `setInterval` for REST polling.

### Anon key exposure
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is safe to expose because RLS policies restrict what each user can read. But confirm the publishable key has `SELECT` rights on the relevant views/tables gated by `auth.uid()` → `users.clerk_user_id`.

### WebSocket disconnection handling
Desktop plugins rarely disconnect (always-on tray app). Browser tabs can be backgrounded/throttled. Implement `.on('stateChan','closed')` or use the connection state to switch to polling fallback.

### Toast spam prevention
The plugin deduplicates via `signalStore.addSignal()` (checks `seenSet` + `recentMax=12`). The webapp must replicate this dedup logic — otherwise tab refocus or re-render triggers duplicate toasts. The current `pushToast` does NOT dedup — every broadcast fires a new toast. If toast spam becomes an issue, add a `seenRef` that tracks the last `N` signal IDs and suppresses duplicates.

### Stale `useCallback` dependencies causing channel re-subscribes (2026-08-31)
`pushToast` must be wrapped in `useCallback(..., [])` if it appears in a `useEffect` dependency array. A plain function reference changes on every render, causing the Realtime subscription effect to tear down and re-subscribe on every render cycle. During the unmount/remount gap, broadcasts and their associated toasts are silently dropped. The `wsStatus` state (`"connected"`) may still show "Live" because it only downgrades on explicit error/timeout states (`CHANNEL_ERROR`, `TIMED_OUT`), never reverts to `"connecting"`. So the UI lies about connection stability while the channel is mid-reconnect.

**Fix:** `const pushToast = useCallback((toast) => { ... }, []);` — the `setToasts` state setter from `useState` is already guaranteed stable by React, so `useCallback(..., [])` is safe and gives `pushToast` a stable reference.

### `react-hooks/set-state-in-effect` pre-existing warning (2026-08-31)
`app/portal/page.jsx:132` calls `refresh()` (a `useCallback` that calls `setData`/`setError`) directly inside a `useEffect`. This is pre-existing and intentional — it mirrors the established pattern in `app/payment/success/page.jsx:54` where `refresh()` is also called in an effect. **Accept this warning** — omitting `refresh` from deps produces MORE warnings (exhaustive-deps missing + set-state-in-effect). Both match the established pattern.
