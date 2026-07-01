import { useDraggable } from "@dnd-kit/core";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";
import { initials } from "../lib/format.ts";
import type { TicketRec } from "../queries/tickets.ts";

interface TicketCardProps {
  ticket: TicketRec;
  refNumber?: number;
}

const TAG_COLORS = ["--primary", "--accent", "--warning", "--todo", "--review"];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return `var(${TAG_COLORS[hash % TAG_COLORS.length]})`;
}

function priorityColor(priority: string): string | null {
  if (priority === "urgent") return "var(--danger)";
  if (priority === "high") return "var(--warning)";
  if (priority === "low") return "var(--backlog)";
  return null;
}

export function TicketCard({ ticket, refNumber }: TicketCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id });
  const assignee = ticket.expand?.assignee;
  const prioClr = priorityColor(ticket.priority);
  const tags = ticket.tags ?? [];

  return (
    <div
      ref={setNodeRef}
      className={`ticket-card${isDragging ? " dragging" : ""}`}
      {...listeners}
      {...attributes}
      onClick={() =>
        navigate({
          to: "/project/$projectId/ticket/$ticketId",
          params: { projectId: ticket.project, ticketId: ticket.id },
        })
      }
    >
      <div className="card-head">
        {refNumber ? <span className="ticket-ref mono">#{refNumber}</span> : null}
        {ticket.origin === "import" ? <span className="badge">import</span> : null}
        <span style={{ flex: 1 }} />
        {assignee ? (
          <span className="avatar sm" title={assignee.display_name}>
            {initials(assignee.display_name)}
          </span>
        ) : null}
      </div>

      <div className="title">{ticket.title}</div>

      <div className="card-foot">
        <span className="label-dots">
          {prioClr ? (
            <span className="label-dot" style={{ background: prioClr }} title={ticket.priority} />
          ) : null}
          {tags.slice(0, 4).map((tag) => (
            <span key={tag} className="label-dot" style={{ background: tagColor(tag) }} title={tag} />
          ))}
        </span>
        <span className="card-icons">
          {ticket.branch ? (
            <span className="ci mono" title={ticket.branch}>
              <GitBranch size={12} />
              {ticket.branch.length > 14 ? `${ticket.branch.slice(0, 14)}…` : ticket.branch}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
