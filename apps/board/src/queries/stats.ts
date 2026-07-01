import { useMemo } from "react";
import { TICKET_STATUSES, type TicketStatus } from "@miniboss/shared";
import { useMembers, useProjects, useTeams, type MemberRec, type ProjectRec } from "./meta.ts";
import { useTickets } from "./tickets.ts";

export type StatusCounts = Record<TicketStatus, number>;

function emptyCounts(): StatusCounts {
  return TICKET_STATUSES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {} as StatusCounts);
}

export interface ProjectStat {
  project: ProjectRec;
  teamName: string;
  total: number;
  counts: StatusCounts;
  lastActivity: string;
}

/** Aggregate ticket counts per project (single ticket fetch, derived client-side). */
export function useProjectStats() {
  const tickets = useTickets({});
  const projects = useProjects();
  const teams = useTeams();

  const stats = useMemo<ProjectStat[]>(() => {
    const teamName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
    const byProject = new Map<string, ProjectStat>();
    for (const p of projects.data ?? []) {
      byProject.set(p.id, {
        project: p,
        teamName: teamName.get(p.team) ?? "—",
        total: 0,
        counts: emptyCounts(),
        lastActivity: "",
      });
    }
    for (const t of tickets.data ?? []) {
      const stat = byProject.get(t.project);
      if (!stat) continue;
      stat.total += 1;
      stat.counts[t.status] += 1;
      if (t.updated > stat.lastActivity) stat.lastActivity = t.updated;
    }
    return [...byProject.values()].sort((a, b) => b.total - a.total);
  }, [tickets.data, projects.data, teams.data]);

  return {
    stats,
    isLoading: tickets.isLoading || projects.isLoading || teams.isLoading,
    isError: tickets.isError || projects.isError || teams.isError,
  };
}

export interface DevStat {
  member: MemberRec | null; // null = unassigned bucket
  total: number;
  inProgress: number;
  done: number;
}

/** Aggregate ticket counts per developer (member), ranked descending. */
export function useDeveloperStats() {
  const tickets = useTickets({});
  const members = useMembers();

  const { stats, max } = useMemo(() => {
    const byMember = new Map<string, DevStat>();
    for (const m of members.data ?? []) {
      byMember.set(m.id, { member: m, total: 0, inProgress: 0, done: 0 });
    }
    const unassigned: DevStat = { member: null, total: 0, inProgress: 0, done: 0 };

    for (const t of tickets.data ?? []) {
      const stat = (t.assignee && byMember.get(t.assignee)) || unassigned;
      stat.total += 1;
      if (t.status === "in_progress") stat.inProgress += 1;
      if (t.status === "done") stat.done += 1;
    }

    const list: DevStat[] = [...byMember.values()];
    if (unassigned.total > 0) list.push(unassigned);
    list.sort((a, b) => b.total - a.total);
    const maxTotal = list.reduce((m, s) => Math.max(m, s.total), 0);
    return { stats: list, max: maxTotal };
  }, [tickets.data, members.data]);

  return {
    stats,
    max,
    isLoading: tickets.isLoading || members.isLoading,
    isError: tickets.isError || members.isError,
  };
}
