import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { TICKET_STATUSES, type TicketStatus } from "@miniboss/shared";
import { BoardColumn } from "../components/BoardColumn.tsx";
import { BoardToolbar } from "../components/BoardToolbar.tsx";
import { CreateTicketDialog } from "../components/CreateTicketDialog.tsx";
import { isManager } from "../lib/pb.ts";
import { useBoardRealtime } from "../lib/realtime.ts";
import { useProjects, useTeams, type MemberRec } from "../queries/meta.ts";
import { useTickets, useUpdateTicketStatus } from "../queries/tickets.ts";

export function ProjectBoard() {
  const { projectId } = useParams({ from: "/project/$projectId" });
  const search = useSearch({ from: "/project/$projectId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useBoardRealtime(queryClient);

  const projects = useProjects();
  const teams = useTeams();
  const tickets = useTickets({ project: projectId });
  const updateStatus = useUpdateTicketStatus();
  const [showCreate, setShowCreate] = useState(false);

  const project = projects.data?.find((p) => p.id === projectId);
  const teamName = teams.data?.find((t) => t.id === project?.team)?.name;

  const all = tickets.data ?? [];

  // Stable per-project ordinals (by creation order), independent of filter.
  const refs = useMemo(() => {
    const sorted = [...all].sort((a, b) => a.created.localeCompare(b.created));
    const map = new Map<string, number>();
    sorted.forEach((t, i) => map.set(t.id, i + 1));
    return map;
  }, [all]);

  // Distinct assignees present on the board (for the members strip + filter).
  const members = useMemo(() => {
    const byId = new Map<string, MemberRec>();
    for (const t of all) {
      const m = t.expand?.assignee;
      if (m && !byId.has(m.id)) byId.set(m.id, m);
    }
    return [...byId.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [all]);

  const filtered = search.assignee ? all.filter((t) => t.assignee === search.assignee) : all;
  const sortDisabled = Boolean(search.assignee);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(event: DragEndEvent) {
    if (sortDisabled) return;
    const id = String(event.active.id);
    const target = event.over?.id ? (String(event.over.id) as TicketStatus) : null;
    if (!target) return;
    const ticket = all.find((t) => t.id === id);
    if (ticket && ticket.status !== target) updateStatus.mutate({ id, status: target });
  }

  return (
    <>
      <BoardToolbar
        projectName={project?.name ?? "Board"}
        teamName={teamName}
        members={members}
        assignee={search.assignee}
        onAssigneeChange={(assignee) =>
          navigate({ to: "/project/$projectId", params: { projectId }, search: { assignee } })
        }
        canCreate={isManager()}
        onNew={() => setShowCreate(true)}
      />

      <div className="page-body">
        {tickets.isError ? (
          <div className="error">Could not load this board.</div>
        ) : (
          <>
            {sortDisabled ? (
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Filter active — drag to reorder is disabled. Clear the assignee filter to move cards.
              </div>
            ) : null}
            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <div className="board">
                {TICKET_STATUSES.map((status) => (
                  <BoardColumn
                    key={status}
                    status={status}
                    refs={refs}
                    tickets={filtered.filter((t) => t.status === status)}
                  />
                ))}
              </div>
            </DndContext>
          </>
        )}
      </div>

      {showCreate ? (
        <CreateTicketDialog defaultProject={projectId} onClose={() => setShowCreate(false)} />
      ) : null}

      {/* Ticket detail modal renders here via the nested route. */}
      <Outlet />
    </>
  );
}
