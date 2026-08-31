# Dashboard Brick Pattern — Direction-Change Pattern Labeling

## Context

The noble-tradingapp dashboard (`app/dashboard/page.jsx`) renders a
Renko brick chart and a "Markov + pattern" card. The brick pattern is
derived from the last 10 bricks of `v_talaria_renko` (or from the
sweep row's signal as a fallback). The pattern is labeled for display
to the user (e.g. "Reversal ↑↓", "Choppy ↕", "Pullback ↑↓↑").

## The Bug (fixed 2026-08-30)

`brickPattern()` collapses consecutive same-direction bricks via
`.replace(/(.)\1+/g, "$1")`. A run of 3 up-bricks becomes `"U"`,
not `"UUU"`. The old `patternLabel()` had entries for `"UUU"` and
`"DDD"` that could **never be produced** by `brickPattern()` — dead
code. More importantly, treating a run-length of 3 as a meaningful
market signal ("3-push up"/"3-push down") was a fixed assumption
with no statistical basis: a run of any length in one direction is
just one continued move, not a directional indicator.

## The Fix

`brickPattern()` — unchanged logic, comment added to clarify that the
output is a sequence of direction *changes*, not run-length.

`patternLabel()` — removed the `"UUU"` / `"DDD"` labels. Added:
- `"U"` → `"Up trend ↑"` / `"D"` → `"Down trend ↓"` (single direction, any length)
- `/^(UDU|DUD)+$/` → `"Choppy ↕"` (3+ alternating bricks)

Everything else falls through to `"Mixed (arrows)"`.

## Pattern Reference (collapsed output, 10-brick window)

| Collapsed pattern | Label |
|---|---|
| `U` | Up trend ↑ |
| `D` | Down trend ↓ |
| `UD` | Reversal ↑↓ |
| `DU` | Reversal ↓↑ |
| `UDU` | Pullback ↑↓↑ |
| `DUD` | Pullback ↓↑↓ |
| `UDUD` / `DUDU` / … | Choppy ↕ |
| anything else | Mixed (↑↓ trace) |

## Related

- `noble-trader-plugin-build` skill (references/dashboard-brick-pattern.md)
- Talaria plugin `plugin.js` `brickPattern()` / `patternLabel()` — same
  bug exists there; fix is a separate concern in the plugin repo.
- `markovUpProbability()` — separate metric (3-state Markov chain on
  ≤200 brick closes), unaffected by this change.
