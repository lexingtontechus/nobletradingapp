/**
 * Talaria mark — the Noble Trading logo image.
 *
 * Geometry is faithful to docs/talaria/talaria-mark.svg (design guide §01):
 * the strap-node ring at (24,76) with accelerating feather strokes running
 * left-to-right. Stroke widths scale with `size`, with a floor so the mark
 * stays legible at icon/favicon sizes (16px floor per design guide §04).
 */
export default function Logo({ size = 32, padding = 0 }) {
  const ringW = Math.max(1.5, size * 0.03);
  const pathW = Math.max(2.25, size * 0.045);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{ padding }}
      role="img"
      aria-label="Talaria"
    >
      <circle
        cx="24"
        cy="76"
        r="7"
        fill="none"
        stroke="#B8823D"
        strokeWidth={ringW}
      />
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
