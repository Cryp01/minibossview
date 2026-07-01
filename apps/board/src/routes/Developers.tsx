import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader.tsx";
import { ProportionalBar } from "../components/StatBar.tsx";
import { initials } from "../lib/format.ts";
import { useBoardRealtime } from "../lib/realtime.ts";
import { useDeveloperStats, type DevStat } from "../queries/stats.ts";

export function Developers() {
  const queryClient = useQueryClient();
  useBoardRealtime(queryClient);
  const { stats, max, isLoading, isError } = useDeveloperStats();

  return (
    <>
      <PageHeader title="Developers" subtitle="Ticket load per developer, ranked" />
      <div className="page-body">
        {isError ? (
          <div className="error">Could not load developers.</div>
        ) : isLoading ? (
          <div className="muted">Loading…</div>
        ) : stats.length === 0 ? (
          <div className="empty">No developers yet — they appear as work is reported.</div>
        ) : (
          <div className="dev-list">
            {stats.map((s, i) => (
              <DevRow key={s.member?.id ?? "unassigned"} rank={i + 1} stat={s} max={max} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface DevRowProps {
  rank: number;
  stat: DevStat;
  max: number;
}

function DevRow({ rank, stat, max }: DevRowProps) {
  const name = stat.member?.display_name || "Unassigned";
  const email = stat.member?.email_normalized ?? "no assignee";

  return (
    <div className="dev-row" style={{ cursor: "default" }}>
      <span className="rank tabular">{rank}</span>
      <span className="avatar" aria-hidden="true">
        {stat.member ? initials(name) : "—"}
      </span>
      <span className="who">
        <div className="name">{name}</div>
        <div className="email mono">{email}</div>
      </span>
      <span className="bar-cell">
        <ProportionalBar
          value={stat.total}
          max={max}
          ariaLabel={`${name}: ${stat.total} tickets`}
        />
        <span className="breakdown tabular">
          {stat.inProgress} in progress · {stat.done} done
        </span>
      </span>
      <span className="count tabular">{stat.total}</span>
    </div>
  );
}
