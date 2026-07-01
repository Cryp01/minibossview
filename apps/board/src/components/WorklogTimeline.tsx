import { formatDateTime } from "../lib/format.ts";
import type { WorklogRec } from "../queries/tickets.ts";

interface WorklogTimelineProps {
  entries: WorklogRec[];
}

function authorOf(entry: WorklogRec): string {
  return (
    entry.expand?.author_member?.display_name ??
    entry.expand?.author_user?.name ??
    "system"
  );
}

export function WorklogTimeline({ entries }: WorklogTimelineProps) {
  if (entries.length === 0) {
    return <div className="muted">No activity yet.</div>;
  }
  return (
    <ul className="timeline">
      {entries.map((entry) => (
        <li key={entry.id}>
          <div className="when">
            {formatDateTime(entry.work_date || entry.created)} · {authorOf(entry)} · {entry.kind}
            {entry.commit ? ` · ${entry.commit.slice(0, 7)}` : ""}
          </div>
          <div>{entry.message}</div>
        </li>
      ))}
    </ul>
  );
}
