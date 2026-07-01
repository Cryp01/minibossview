import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { X } from "lucide-react";
import { TICKET_STATUSES, TICKET_STATUS_LABELS, type TicketStatus } from "@miniboss/shared";
import { WorklogTimeline } from "./WorklogTimeline.tsx";
import { formatDate } from "../lib/format.ts";
import { isManager } from "../lib/pb.ts";
import { useMembers } from "../queries/meta.ts";
import {
  useAddNote,
  useAssignTicket,
  useTicket,
  useUpdateTicketStatus,
  useWorklog,
} from "../queries/tickets.ts";

/** Ticket detail as a routed modal overlay on top of the project board. */
export function TicketModal() {
  const { projectId, ticketId } = useParams({ from: "/project/$projectId/ticket/$ticketId" });
  const navigate = useNavigate();

  const ticket = useTicket(ticketId);
  const worklog = useWorklog(ticketId);
  const members = useMembers();
  const assign = useAssignTicket();
  const updateStatus = useUpdateTicketStatus();
  const addNote = useAddNote();
  const [note, setNote] = useState("");
  const manager = isManager();

  function close() {
    navigate({ to: "/project/$projectId", params: { projectId } });
  }

  const t = ticket.data;
  const assignee = t?.expand?.assignee;

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{t?.title ?? "Ticket"}</h2>
          <button className="icon-btn close" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {ticket.isLoading ? (
          <div className="muted">Loading…</div>
        ) : ticket.isError || !t ? (
          <div className="error">Ticket not found.</div>
        ) : (
          <div className="detail">
            <div>
              <div className="filters" style={{ marginBottom: 12 }}>
                <span
                  className="badge"
                  style={{ borderColor: `var(--${t.status})`, color: `var(--${t.status})` }}
                >
                  {TICKET_STATUS_LABELS[t.status]}
                </span>
                {t.priority ? <span className="badge">priority: {t.priority}</span> : null}
                {t.origin ? <span className="badge">{t.origin}</span> : null}
                {t.work_date ? <span className="muted">{formatDate(t.work_date)}</span> : null}
              </div>

              {t.description ? (
                <p style={{ whiteSpace: "pre-wrap" }}>{t.description}</p>
              ) : (
                <p className="muted">No description.</p>
              )}

              {t.repo_remote || t.branch || t.last_commit ? (
                <div className="muted mono" style={{ fontSize: 12, marginBottom: 18 }}>
                  {t.repo_remote ? <div>repo: {t.repo_remote}</div> : null}
                  {t.branch ? <div>branch: {t.branch}</div> : null}
                  {t.last_commit ? <div>commit: {t.last_commit}</div> : null}
                </div>
              ) : null}

              <h3 className="muted" style={{ textTransform: "uppercase", fontSize: 12 }}>
                Activity
              </h3>
              {worklog.isLoading ? (
                <div className="muted">Loading…</div>
              ) : (
                <WorklogTimeline entries={worklog.data ?? []} />
              )}
            </div>

            <aside className="side-panel">
              <h3>Assignee</h3>
              {manager ? (
                <select
                  value={t.assignee ?? ""}
                  onChange={(e) => assign.mutate({ id: t.id, assignee: e.target.value })}
                  style={{ width: "100%" }}
                >
                  <option value="">Unassigned</option>
                  {(members.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              ) : (
                <div>
                  {assignee ? assignee.display_name : <span className="muted">Unassigned</span>}
                </div>
              )}

              {manager ? (
                <>
                  <h3 style={{ marginTop: 18 }}>Status</h3>
                  <select
                    value={t.status}
                    onChange={(e) =>
                      updateStatus.mutate({ id: t.id, status: e.target.value as TicketStatus })
                    }
                    style={{ width: "100%" }}
                  >
                    {TICKET_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {TICKET_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>

                  <h3 style={{ marginTop: 18 }}>Add note</h3>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    style={{ width: "100%" }}
                    placeholder="Leave a note for the team…"
                  />
                  <button
                    style={{ marginTop: 8, width: "100%" }}
                    disabled={!note.trim() || addNote.isPending}
                    onClick={async () => {
                      await addNote.mutateAsync({ ticketId: t.id, message: note.trim() });
                      setNote("");
                    }}
                  >
                    {addNote.isPending ? "Adding…" : "Add note"}
                  </button>
                </>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
