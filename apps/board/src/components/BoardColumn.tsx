import { useDroppable } from "@dnd-kit/core";
import { CheckCheck, Eye, Inbox, ListTodo, Loader, type LucideIcon } from "lucide-react";
import { TICKET_STATUS_LABELS, type TicketStatus } from "@miniboss/shared";
import { TicketCard } from "./TicketCard.tsx";
import type { TicketRec } from "../queries/tickets.ts";

const COLUMN_ICONS: Record<TicketStatus, LucideIcon> = {
  backlog: Inbox,
  todo: ListTodo,
  in_progress: Loader,
  review: Eye,
  done: CheckCheck,
};

interface BoardColumnProps {
  status: TicketStatus;
  tickets: TicketRec[];
  refs: Map<string, number>;
}

export function BoardColumn({ status, tickets, refs }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const Icon = COLUMN_ICONS[status];

  return (
    <section ref={setNodeRef} className={`column${isOver ? " drop-over" : ""}`}>
      <header className="column-head">
        <span className="col-icon" style={{ color: `var(--${status})` }}>
          <Icon size={15} />
        </span>
        {TICKET_STATUS_LABELS[status]}
        <span className="count tabular">{tickets.length}</span>
      </header>
      <div className="column-body">
        {tickets.length === 0 ? (
          <div className="muted" style={{ fontSize: 12, padding: "8px 4px" }}>
            No tickets
          </div>
        ) : (
          tickets.map((t) => <TicketCard key={t.id} ticket={t} refNumber={refs.get(t.id)} />)
        )}
      </div>
    </section>
  );
}
