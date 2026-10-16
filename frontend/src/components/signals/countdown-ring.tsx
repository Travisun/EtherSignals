"use client";

/**
 * SVG countdown ring for the 20s refresh cycle. Driven by a deadline
 * timestamp (not a decremented counter) so it never drifts with timer skew.
 */
export function CountdownRing({
  remainingMs,
  totalMs,
  size = 34,
  label,
}: {
  remainingMs: number;
  totalMs: number;
  size?: number;
  label?: string;
}) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <span
      className="relative inline-flex items-center justify-center"
      role="timer"
      aria-label={`Next update in ${seconds} seconds`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          className="transition-[stroke-dashoffset] duration-200 ease-linear"
        />
      </svg>
      <span className="tnum absolute text-[10px] font-bold text-foreground">
        {seconds}
        {label ? <span className="sr-only">{label}</span> : null}
      </span>
    </span>
  );
}
