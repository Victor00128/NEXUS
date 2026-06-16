/**
 * NexusMark — the app's own brand glyph.
 *
 * A hexagonal "orchestration node": a central core linked to six outer points,
 * representing many models converging into one. Uses `currentColor` so it picks
 * up the active theme. Replaces the previous alchemical-emoji / diamond marks.
 */
export function NexusMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer hexagon shell */}
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Z" />
      {/* Spokes from the core to the vertices */}
      <path
        d="M12 12 12 4.5M12 12 19.5 7.75M12 12 19.5 16.25M12 12 12 19.5M12 12 4.5 16.25M12 12 4.5 7.75"
        opacity="0.45"
      />
      {/* Core node */}
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
