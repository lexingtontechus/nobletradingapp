# Scope — Dashboard × Kairos enhancements

**Full spec:** `noble-trader-fastapi-backend/worklog/kairos/scopes/20260928_DASHBOARD_KAIROS_ENHANCEMENTS.md`  
**Rank board:** `scope-signal-ranking-board.md`

## Backend already provides (Realtime `realtime:signals`)

`rank`, `state` (FRESH/WARM/STALE/DEEP), `transition`, `p_win`, `ev_r` — plus Discord embed fields.

## Components (priority)

| P | Component | Kairos data |
|---|---|---|
| 1 | **Ranking board** | RANK sort · STATE · p_win · EV |
| 1 | Hero / last signal | RANK chip + STATE badge |
| 2 | Macro panel | `nt_macro_forecast` thesis / structure / pivot |
| 3 | EOD digest | Top 5 by RANK · hit-rate by STATE |
| 4 | Health (L1) | Rank IC / top-vs-bot tercile |
| 5 | Pairs matrix | Rank-weighted agreement |
| 6 | Open book | Entry RANK/STATE |

## Rules

- Fail-open on null (`—`), never invent rank  
- RANK ≠ win% — “opportunity score”  
- Published only for hero/Discord  
