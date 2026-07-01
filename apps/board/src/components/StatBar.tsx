import type { TicketStatus } from "@miniboss/shared";

export interface StatSegment {
  status: TicketStatus;
  value: number;
}

interface SegmentedProps {
  segments: StatSegment[];
  ariaLabel: string;
}

/** Segmented bar coloured per status. Value labels live in the legend. */
export function SegmentedBar({ segments, ariaLabel }: SegmentedProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="statbar" role="img" aria-label={ariaLabel}>
      {total === 0
        ? null
        : segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <div
                key={s.status}
                className="statbar-seg"
                style={{ width: `${(s.value / total) * 100}%`, background: `var(--${s.status})` }}
              />
            ))}
    </div>
  );
}

interface ProportionalProps {
  value: number;
  max: number;
  ariaLabel: string;
}

/** Single proportional bar (value relative to max). */
export function ProportionalBar({ value, max, ariaLabel }: ProportionalProps) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div
      className="statbar proportional"
      role="img"
      aria-label={ariaLabel}
    >
      <div className="statbar-seg" style={{ width: `${pct}%` }} />
    </div>
  );
}
