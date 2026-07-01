import { useEffect, useMemo, useState } from "react";
import { TICKET_PRIORITIES } from "@miniboss/shared";
import { useMembers, useProjects, useTeams } from "../queries/meta.ts";
import { useCreateTicket } from "../queries/tickets.ts";

interface CreateTicketDialogProps {
  onClose: () => void;
  defaultProject?: string;
}

export function CreateTicketDialog({ onClose, defaultProject }: CreateTicketDialogProps) {
  const teams = useTeams();
  const projects = useProjects();
  const members = useMembers();
  const create = useCreateTicket();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [team, setTeam] = useState("");
  const [project, setProject] = useState(defaultProject ?? "");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("med");

  // When opened from a project board, preselect that project's team.
  useEffect(() => {
    if (!defaultProject || team) return;
    const p = projects.data?.find((x) => x.id === defaultProject);
    if (p) setTeam(p.team);
  }, [defaultProject, projects.data, team]);

  const visibleProjects = useMemo(
    () => (projects.data ?? []).filter((p) => !team || p.team === team),
    [projects.data, team]
  );

  const canSubmit = title.trim() && team && project && !create.isPending;

  async function submit() {
    if (!canSubmit) return;
    await create.mutateAsync({ title: title.trim(), description, team, project, assignee, priority });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>New ticket</h2>

        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>Team</label>
          <select value={team} onChange={(e) => { setTeam(e.target.value); setProject(""); }}>
            <option value="">Select a team…</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Project</label>
          <select value={project} onChange={(e) => setProject(e.target.value)} disabled={!team}>
            <option value="">Select a project…</option>
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Assignee (optional)</label>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {create.isError ? <div className="error">Could not create the ticket.</div> : null}
        <div className="row">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button disabled={!canSubmit} onClick={submit}>
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
