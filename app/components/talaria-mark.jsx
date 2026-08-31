// =============================================================================
// TalariaMark — broad-bolt SVG logo
// =============================================================================
// Ported from the Talaria desktop plugin (noble-trader-hermes-plugins/talaria/
// desktop/plugin.js, line ~1583). Rendered inline in the dashboard header,
// matching the plugin's broad-bolt glyph: the strap-node ring with accelerating
// diagonal feather strokes, Bronze Bright (#B8823D) per the design guide's
// "accent on dark" role.
// =============================================================================

import React from "react";

export function TalariaMark({ className = "", size = 24, color = "#B8823D" }) {
  const ringW = Math.max(1.5, size * 0.03);
  const pathW = Math.max(2.25, size * 0.045);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Talaria mark"
      style={{
        display: "inline-block",
        flexShrink: 0,
        width: size + "px",
        height: size + "px",
      }}
    >
      {/* Strap-node ring */}
      <circle
        cx="24"
        cy="76"
        r="7"
        fill="none"
        stroke="#B8823D"
        strokeWidth={ringW}
      />
      {/* Feather strokes — accelerating diagonals */}
      <path
        d="M27 71 L40 55 L38 68 L52 46 L48 62 L64 38 L58 56 L78 24 L66 50 L84 12"
        fill="none"
        stroke="#B8823D"
        strokeWidth={pathW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default TalariaMark;
