import { Link } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";
import { initials } from "../lib/format.ts";
import type { MemberRec } from "../queries/meta.ts";

interface BoardToolbarProps {
  projectName: string;
  teamName?: string;
  members: MemberRec[];
  assignee?: string;
  onAssigneeChange: (id: string | undefined) => void;
  canCreate: boolean;
  onNew: () => void;
}

export function BoardToolbar({
  projectName,
  teamName,
  members,
  assignee,
  onAssigneeChange,
  canCreate,
  onNew,
}: BoardToolbarProps) {
  return (
    <header className="page-header">
      <Link to="/" className="icon-btn" aria-label="Back to boards" title="Back to boards">
        <ArrowLeft size={18} />
      </Link>
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">{projectName}</h1>
        {teamName ? <p className="page-subtitle">{teamName}</p> : null}
      </div>

      <div className="page-actions">
        {members.length > 0 ? (
          <div className="members-strip" aria-label="Assignees on this board">
            {members.slice(0, 6).map((m) => (
              <span key={m.id} className="avatar sm" title={m.display_name}>
                {initials(m.display_name)}
              </span>
            ))}
          </div>
        ) : null}

        <select
          value={assignee ?? ""}
          onChange={(e) => onAssigneeChange(e.target.value || undefined)}
          aria-label="Filter by assignee"
        >
          <option value="">All assignees</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>

        {canCreate ? (
          <button onClick={onNew}>
            <Plus size={16} />
            New ticket
          </button>
        ) : null}
      </div>
    </header>
  );
}
