/**
 * Shared enumerations and ordering used by both the board UI and the CLI.
 * Keep these as the single source of truth — PocketBase select fields and zod
 * schemas are derived from them.
 */

/** Scrum board columns, in display order. */
export const TICKET_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Human-friendly labels for each column. */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export const TICKET_PRIORITIES = ["low", "med", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** How a ticket came to exist. */
export const TICKET_ORIGINS = ["agent", "manager", "import"] as const;
export type TicketOrigin = (typeof TICKET_ORIGINS)[number];

/** Kinds of worklog entries appended over a ticket's life. */
export const WORKLOG_KINDS = [
  "status_change",
  "progress",
  "commit",
  "note",
  "assignment",
] as const;
export type WorklogKind = (typeof WORKLOG_KINDS)[number];

/** Roles for human accounts (managers + viewers). */
export const USER_ROLES = ["viewer", "manager", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Roles allowed to create/assign tickets from the board. */
export const MANAGER_ROLES: readonly UserRole[] = ["manager", "admin"];

/** Maximum length (characters) of a summary that may leave a developer machine. */
export const MAX_SUMMARY_LENGTH = 600;

/** PocketBase collection names — referenced from both halves. */
export const COLLECTIONS = {
  appUsers: "app_users",
  agents: "agents",
  members: "members",
  teams: "teams",
  projects: "projects",
  tickets: "tickets",
  worklog: "worklog",
} as const;
