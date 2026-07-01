/**
 * Domain operations over the PocketBase REST client. Both `report` and `import`
 * funnel through `applyReport`, so the online path and the offline-drain path
 * share one idempotent implementation.
 */
import {
  COLLECTIONS,
  normalizeEmail,
  type TicketStatus,
  type WorklogKind,
} from "@miniboss/shared";
import { z } from "zod";
import type { MemberIdentity } from "./developer.ts";
import { PbClient, PbError, type PbRecord } from "./pocketbase.ts";

/** A normalized, id-free description of a single report (the replay unit). */
export const boardReportSchema = z.object({
  verb: z.enum(["start", "update", "done"]),
  externalKey: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).nullable().default(null),
  team: z.object({ slug: z.string().min(1), name: z.string().min(1) }),
  project: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    repoRemote: z.string().default(""),
    defaultBranch: z.string().default(""),
  }),
  identity: z
    .object({
      username: z.string(),
      displayName: z.string(),
      email: z.string(),
      verified: z.boolean().default(false),
    })
    .nullable()
    .default(null),
  git: z.object({
    repoRemote: z.string().default(""),
    branch: z.string().default(""),
    head: z.string().default(""),
  }),
  workDate: z.string(),
});
export type BoardReport = z.infer<typeof boardReportSchema>;

function escapeFilter(value: string): string {
  return value.replace(/"/g, '\\"');
}

/** Find-or-create that tolerates a concurrent creator hitting the unique index. */
async function ensure(
  client: PbClient,
  collection: string,
  filter: string,
  data: Record<string, unknown>
): Promise<string> {
  const existing = await client.getFirst(collection, filter);
  if (existing) return existing.id;
  try {
    const created = await client.create(collection, data);
    return created.id;
  } catch (error) {
    if (error instanceof PbError && error.status === 400) {
      const retry = await client.getFirst(collection, filter);
      if (retry) return retry.id;
    }
    throw error;
  }
}

export async function ensureTeam(client: PbClient, slug: string, name: string): Promise<string> {
  return ensure(client, COLLECTIONS.teams, `slug = "${escapeFilter(slug)}"`, { slug, name });
}

export async function ensureProject(
  client: PbClient,
  slug: string,
  name: string,
  teamId: string,
  repoRemote: string,
  defaultBranch: string
): Promise<string> {
  return ensure(
    client,
    COLLECTIONS.projects,
    `team = "${teamId}" && slug = "${escapeFilter(slug)}"`,
    { slug, name, team: teamId, repo_remote: repoRemote, default_branch: defaultBranch }
  );
}

/**
 * Upsert a developer into the members registry, keyed by GitHub username so the
 * same person is one member across all the git emails they commit with. Each new
 * email is accumulated onto the member; the display name is refreshed.
 */
export async function ensureMember(
  client: PbClient,
  identity: MemberIdentity | null
): Promise<string | null> {
  if (!identity) return null;
  const username = identity.username;
  if (!username) return null;
  const email = normalizeEmail(identity.email);
  const filter = `username = "${escapeFilter(username)}"`;

  const existing = await client.getFirst(COLLECTIONS.members, filter);
  if (existing) {
    await mergeMember(client, existing, identity, email);
    return existing.id;
  }
  try {
    const created = await client.create(COLLECTIONS.members, {
      username,
      email_normalized: email,
      emails: email ? [email] : [],
      display_name: identity.displayName,
      aliases: [{ name: identity.displayName, email: identity.email }],
      active: true,
    });
    return created.id;
  } catch (error) {
    if (error instanceof PbError && error.status === 400) {
      const retry = await client.getFirst(COLLECTIONS.members, filter);
      if (retry) {
        await mergeMember(client, retry, identity, email);
        return retry.id;
      }
    }
    throw error;
  }
}

/** Fold a newly-seen email/name into an existing member (immutable patch). */
async function mergeMember(
  client: PbClient,
  existing: PbRecord,
  identity: MemberIdentity,
  email: string
): Promise<void> {
  const emails = Array.isArray(existing.emails) ? (existing.emails as string[]) : [];
  const patch: Record<string, unknown> = {};
  if (email && !emails.includes(email)) patch.emails = [...emails, email];
  if (email && !existing.email_normalized) patch.email_normalized = email;
  if (identity.displayName && existing.display_name !== identity.displayName) {
    patch.display_name = identity.displayName;
  }
  if (Object.keys(patch).length > 0) {
    await client.update(COLLECTIONS.members, existing.id, patch).catch(() => {});
  }
}

function worklogKindFor(verb: BoardReport["verb"]): WorklogKind {
  return verb === "done" ? "status_change" : "progress";
}

export interface ApplyResult {
  ticketId: string;
  created: boolean;
}

/**
 * Idempotent upsert of a ticket (keyed by external_key) plus an appended
 * worklog entry. Used by both live reporting and import.
 */
export async function applyReport(
  client: PbClient,
  report: BoardReport,
  origin: "agent" | "import" = "agent"
): Promise<ApplyResult> {
  const teamId = await ensureTeam(client, report.team.slug, report.team.name);
  const projectId = await ensureProject(
    client,
    report.project.slug,
    report.project.name,
    teamId,
    report.project.repoRemote,
    report.project.defaultBranch
  );
  const memberId = await ensureMember(client, report.identity);

  const existing = await client.getFirst(COLLECTIONS.tickets, `external_key = "${escapeFilter(report.externalKey)}"`);

  let ticketId: string;
  let created = false;
  if (existing) {
    ticketId = existing.id;
    const patch: Record<string, unknown> = {
      repo_remote: report.git.repoRemote,
      branch: report.git.branch,
      last_commit: report.git.head,
    };
    if (report.status) patch["status"] = report.status;
    await client.update(COLLECTIONS.tickets, ticketId, patch);
  } else {
    const status: TicketStatus = report.status ?? (report.verb === "done" ? "done" : "in_progress");
    const ticket = await client.create(COLLECTIONS.tickets, {
      title: report.title,
      status,
      team: teamId,
      project: projectId,
      assignee: memberId ?? "",
      origin,
      repo_remote: report.git.repoRemote,
      branch: report.git.branch,
      last_commit: report.git.head,
      work_date: report.workDate,
      external_key: report.externalKey,
    });
    ticketId = ticket.id;
    created = true;
  }

  if (report.summary.trim().length > 0) {
    await appendWorklog(client, {
      ticket: ticketId,
      authorMember: memberId,
      kind: worklogKindFor(report.verb),
      message: report.summary,
      workDate: report.workDate,
    });
  }

  return { ticketId, created };
}

export interface WorklogInput {
  ticket: string;
  authorMember: string | null;
  kind: WorklogKind;
  message: string;
  workDate: string;
  commit?: string;
  meta?: Record<string, unknown>;
}

export async function appendWorklog(client: PbClient, input: WorklogInput): Promise<PbRecord> {
  return client.create(COLLECTIONS.worklog, {
    ticket: input.ticket,
    author_member: input.authorMember ?? "",
    kind: input.kind,
    message: input.message,
    work_date: input.workDate,
    commit: input.commit ?? "",
    meta: input.meta ?? {},
  });
}
