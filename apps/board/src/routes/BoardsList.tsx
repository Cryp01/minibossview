import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from "@miniboss/shared";
import { PageHeader } from "../components/PageHeader.tsx";
import { SegmentedBar } from "../components/StatBar.tsx";
import { formatDate } from "../lib/format.ts";
import { useBoardRealtime } from "../lib/realtime.ts";
import { useProjectStats, type ProjectStat } from "../queries/stats.ts";

export function BoardsList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useBoardRealtime(queryClient);
  const { stats, isLoading, isError } = useProjectStats();

  return (
    <>
      <PageHeader title="Boards" subtitle="Pick a project board to see what's in flight" />
      <div className="page-body">
        {isError ? (
          <div className="error">Could not load boards.</div>
        ) : isLoading ? (
          <div className="muted">Loading…</div>
        ) : stats.length === 0 ? (
          <div className="empty">No boards yet — they appear as developers report work.</div>
        ) : (
          <div className="projects-grid">
            {stats.map((s) => (
              <BoardCard
                key={s.project.id}
                stat={s}
                onOpen={() =>
                  navigate({ to: "/project/$projectId", params: { projectId: s.project.id } })
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function BoardCard({ stat, onOpen }: { stat: ProjectStat; onOpen: () => void }) {
  return (
    <div
      className="surface-card project-card clickable"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
    >
      <div className="head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">{stat.project.name}</div>
          {stat.project.repo_remote ? (
            <div className="repo mono">
              <GitBranch size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
              {stat.project.repo_remote}
            </div>
          ) : null}
        </div>
        <span className="badge">{stat.teamName}</span>
      </div>

      <div className="count-row">
        <span className="big tabular">{stat.total}</span>
        <span className="muted">{stat.total === 1 ? "ticket" : "tickets"}</span>
      </div>

      <SegmentedBar
        ariaLabel={`Ticket status distribution for ${stat.project.name}`}
        segments={TICKET_STATUSES.map((status) => ({ status, value: stat.counts[status] }))}
      />

      <div className="legend">
        {TICKET_STATUSES.filter((s) => stat.counts[s] > 0).map((status) => (
          <span key={status} className="k">
            <span className="legend-dot" style={{ background: `var(--${status})` }} />
            {TICKET_STATUS_LABELS[status]} <span className="tabular">{stat.counts[status]}</span>
          </span>
        ))}
      </div>

      {stat.lastActivity ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Last activity {formatDate(stat.lastActivity)}
        </div>
      ) : null}
    </div>
  );
}
