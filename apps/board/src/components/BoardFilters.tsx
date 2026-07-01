import { useMemo } from "react";
import { useMembers, useProjects, useTeams } from "../queries/meta.ts";
import type { BoardFilters as Filters } from "../queries/tickets.ts";

interface BoardFiltersProps {
  value: Filters;
  onChange: (next: Filters) => void;
}

export function BoardFilters({ value, onChange }: BoardFiltersProps) {
  const teams = useTeams();
  const projects = useProjects();
  const members = useMembers();

  const visibleProjects = useMemo(
    () => (projects.data ?? []).filter((p) => !value.team || p.team === value.team),
    [projects.data, value.team]
  );

  return (
    <div className="filters">
      <select
        value={value.team ?? ""}
        onChange={(e) => onChange({ ...value, team: e.target.value || undefined, project: undefined })}
      >
        <option value="">All teams</option>
        {(teams.data ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      <select
        value={value.project ?? ""}
        onChange={(e) => onChange({ ...value, project: e.target.value || undefined })}
      >
        <option value="">All projects</option>
        {visibleProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        value={value.assignee ?? ""}
        onChange={(e) => onChange({ ...value, assignee: e.target.value || undefined })}
      >
        <option value="">All assignees</option>
        {(members.data ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name}
          </option>
        ))}
      </select>

      {(value.team || value.project || value.assignee) && (
        <button className="btn-secondary" onClick={() => onChange({})}>
          Clear
        </button>
      )}
    </div>
  );
}
