# Talaria

**Brand Guide v1.0** — Execution-speed plugin for Hermes Agent

---

## 01 · Mark & Concept

![](http://asset.localhost/C%3A%5CUsers%5Caloys%5COneDrive%5CDocuments%5CNoble%20Trader%20Agent%5Cassets%5Ctalaria-mark.svg)

In Greek myth, the **talaria** were the winged sandals that carried Hermes between the realms of gods and mortals — the fastest thing that moved. As a plugin name for a trading agent already built around Hermes, it maps directly: **Talaria is the layer that makes execution fast** — order routing, latency-sensitive fills, the last mile between a signal and a filled position.

The mark is not a literal sandal. It's the strap-node (the ankle buckle, reduced to a single ring) with feathers drawn as accelerating diagonal strokes — each one shorter and steeper than the last, so the glyph reads as motion rather than as an object at rest. It doubles as a loading / in-flight indicator in the UI.

**Primary lockup:** mark + `TALARIA` wordmark, with tagline `Swift Execution · Hermes Agent Plugin` set below in mono caps.

---

## 02 · Color System

Extends Hermes Agent's Greco-Roman palette rather than replacing it. Talaria adds one new signal color — *wingsilver* — reserved exclusively for speed/latency metrics, so it stays legible as "this number is about execution speed" wherever it appears in the dashboard.


| Swatch | Name          | Hex       | Role                               |
| ------ | ------------- | --------- | ---------------------------------- |
| ⬛      | Ink           | `#12141B` | Dark surface base                  |
| ⬜      | Marble        | `#F1ECE0` | Light surface base                 |
| 🟫     | Bronze        | `#B8823D` | Primary / brand accent             |
| 🟧     | Bronze Bright | `#D9A857` | Accent on dark, hover states       |
| 🟦     | Wingsilver    | `#9FB4C7` | Talaria-only: latency & speed data |
| 🟥     | Oxide         | `#B04A32` | Errors, failed fills, alerts       |


---

## 03 · Typography

A carved, inscriptional display face for identity moments; a plain humanist sans for everything a user actually reads; a mono for anything that's a number.


| Role    | Typeface                  | Usage                                                                  |
| ------- | ------------------------- | ---------------------------------------------------------------------- |
| Display | Cormorant SC (600)        | Wordmark, section titles, empty-state headlines only. Never body copy. |
| Body    | Public Sans (400/500/600) | UI copy, descriptions, settings labels.                                |
| Data    | IBM Plex Mono             | Metrics, tickers, timestamps, code, eyebrows/labels.                   |


---

## 04 · Logo Usage

**Clear space:** minimum clear space on all sides = the height of the strap-ring circle. Nothing else enters this margin.

**Minimum size:**

- 16px — favicon floor (use mark alone, drop wordmark)
- 24px — UI icon
- 40px — nav/header

Below 16px, drop the wordmark and use the mark alone. It's drawn to stay legible at favicon scale.

---

## 05 · Don't

- ✕ Mirror or flip the mark — the feathers must accelerate left-to-right, matching reading direction.
- ✕ Recolor outside Bronze / Bronze Bright / Marble / Ink. Never in P&L green or red.
- ✕ Add a circular badge, drop shadow, or gradient fill behind the mark.
- ✕ Pair the mark with any other icon or logo in the same lockup — it stands alone or beside the Hermes mark only.

---

## 06 · Applied — Dashboard Card

Example plugin card copy, as it appears inside the Hermes Agent mission-control UI:

> **Talaria** — `EXECUTION LAYER`
> Routes signals from the regime engine to broker fills. Tracks slippage and round-trip latency per order.
>
>
> | Metric       | Value               |
> | ------------ | ------------------- |
> | Avg. latency | `42ms` (wingsilver) |
> | Fill rate    | `99.8%`             |
> | Status       | ● Active            |
>

Primary button: `⚡ Enable Talaria` (bronze fill, ink text, mono caps label).

---

## 07 · Voice

Talaria talks about speed the way a pit crew talks about a pit stop — plainly, in numbers, no hype. "Filled in 42ms" beats "Lightning-fast execution." Errors state what happened and what to do, never apologize, never dramatize a missed fill.

---

## 08 · Alternative Directions — Lightning Feathers

Same strap-node concept, pushed bolder: broader strokes and sharper, more angular zigzags so the mark reads as a lightning strike as much as a feather. All four keep the ring at the same position and the same left-to-right acceleration, so they drop into the lockup without changing proportions.


| Variant            | File                             | Notes                                                                                                                                       |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Broad Bolt** ★   | `talaria-mark-broadbolt.svg`     | Original path, thickened and mitred. Closest to the primary mark — reads as a bolder weight of the same wing. **Recommended working mark.** |
| **Filled Bolt**    | `talaria-mark-filledbolt.svg`    | Solid silhouette, no stroke. Most literal lightning read — strongest at very small sizes like favicons.                                     |
| **Twin Bolt**      | `talaria-mark-twinbolt.svg`      | Two overlapping strikes at different weights. More dynamic, better as a hero/marketing mark than a small UI icon.                           |
| **Blade Feathers** | `talaria-mark-bladefeathers.svg` | Three solid chevron blades instead of bolts — broad and fast without going fully electric.                                                  |


**Recommendation:** Broad Bolt as the working mark — it keeps the fan-of-feathers logic the rest of this guide is built around, just at a heavier weight. Reserve Filled Bolt for favicon/app-icon sizes where thin strokes disappear.

---

## 09 · Code — Inline SVG / CSS

The Broad Bolt mark as raw markup and as a pure-CSS background image, for dropping straight into a stylesheet or component without an asset request.

**Raw SVG**

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="24" height="24">
  <circle cx="24" cy="76" r="8" fill="none" stroke="#B8823D" stroke-width="6"/>
  <path d="M28 70 L44 50 L38 64 L56 40 L48 58 L68 32 L58 52 L82 18 L70 46 L88 8"
        fill="none" stroke="#B8823D" stroke-width="11"
        stroke-linejoin="miter" stroke-linecap="butt"/>
</svg>
```

**Inline as CSS (data URI, no separate asset)**

```css
.talaria-mark {
  --talaria-bronze: #B8823D;
  display: inline-block;
  width: 24px;
  height: 24px;
  background-repeat: no-repeat;
  background-size: contain;
  background-image: url("data:image/svg+xml;utf8, \
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'> \
      <circle cx='24' cy='76' r='8' fill='none' stroke='%23B8823D' stroke-width='6'/> \
      <path d='M28 70 L44 50 L38 64 L56 40 L48 58 L68 32 L58 52 L82 18 L70 46 L88 8' \
            fill='none' stroke='%23B8823D' stroke-width='11' stroke-linejoin='miter'/> \
    </svg>");
}

/* usage: <span class="talaria-mark" aria-hidden="true"></span> */
```

---

*Talaria — Hermes Agent · Design Guide v1.0*