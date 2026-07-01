import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { COLLECTIONS, type TicketStatus } from "@miniboss/shared";
import { currentUser, pb } from "../lib/pb.ts";
import { queryKeys } from "../lib/queryClient.ts";
import type { MemberRec } from "./meta.ts";

export interface TicketRec {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  team: string;
  project: string;
  assignee: string;
  priority: string;
  tags: string[];
  repo_remote: string;
  branch: string;
  last_commit: string;
  origin: string;
  work_date: string;
  created: string;
  updated: string;
  expand?: { assignee?: MemberRec };
}

export interface WorklogRec {
  id: string;
  ticket: string;
  kind: string;
  message: string;
  commit: string;
  work_date: string;
  created: string;
  expand?: { author_member?: MemberRec; author_user?: { id: string; name: string } };
}

export interface BoardFilters {
  team?: string;
  project?: string;
  assignee?: string;
}

function buildFilter(filters: BoardFilters): string {
  const parts: string[] = [];
  if (filters.team) parts.push(`team = "${filters.team}"`);
  if (filters.project) parts.push(`project = "${filters.project}"`);
  if (filters.assignee) parts.push(`assignee = "${filters.assignee}"`);
  return parts.join(" && ");
}

export function useTickets(filters: BoardFilters) {
  const filter = buildFilter(filters);
  return useQuery({
    queryKey: queryKeys.tickets(filter),
    queryFn: () =>
      pb.collection(COLLECTIONS.tickets).getFullList<TicketRec>({
        filter,
        sort: "-work_date,-created",
        expand: "assignee",
      }),
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: queryKeys.ticket(id),
    queryFn: () =>
      pb.collection(COLLECTIONS.tickets).getOne<TicketRec>(id, {
        expand: "assignee,team,project",
      }),
  });
}

export function useWorklog(ticketId: string) {
  return useQuery({
    queryKey: queryKeys.worklog(ticketId),
    queryFn: () =>
      pb.collection(COLLECTIONS.worklog).getFullList<WorklogRec>({
        filter: `ticket = "${ticketId}"`,
        sort: "-work_date,-created",
        expand: "author_member,author_user",
      }),
  });
}

export function useUpdateTicketStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      pb.collection(COLLECTIONS.tickets).update(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["ticket"] });
    },
  });
}

export function useAssignTicket() {
  const qc = useQueryClient();
  const user = currentUser();
  return useMutation({
    mutationFn: async ({ id, assignee }: { id: string; assignee: string }) => {
      const updated = await pb.collection(COLLECTIONS.tickets).update(id, { assignee });
      await pb.collection(COLLECTIONS.worklog).create({
        ticket: id,
        author_user: user?.id ?? "",
        kind: "assignment",
        message: assignee ? "Reassigned by a manager." : "Unassigned by a manager.",
        work_date: new Date().toISOString(),
      });
      return updated;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: queryKeys.ticket(vars.id) });
      qc.invalidateQueries({ queryKey: queryKeys.worklog(vars.id) });
    },
  });
}

export interface CreateTicketInput {
  title: string;
  description: string;
  team: string;
  project: string;
  assignee: string;
  priority: string;
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) =>
      pb.collection(COLLECTIONS.tickets).create({
        ...input,
        status: "todo" as TicketStatus,
        origin: "manager",
        work_date: new Date().toISOString(),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useAddNote() {
  const qc = useQueryClient();
  const user = currentUser();
  return useMutation({
    mutationFn: ({ ticketId, message }: { ticketId: string; message: string }) =>
      pb.collection(COLLECTIONS.worklog).create({
        ticket: ticketId,
        author_user: user?.id ?? "",
        kind: "note",
        message,
        work_date: new Date().toISOString(),
      }),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: queryKeys.worklog(vars.ticketId) }),
  });
}
