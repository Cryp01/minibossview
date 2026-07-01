/**
 * Zod schemas — the validation contract shared by the board and the CLI.
 * Boundary data (user input, API responses, hook stdin, import manifests) is
 * validated against these before use.
 */
import { z } from "zod";
import {
  MAX_SUMMARY_LENGTH,
  TICKET_ORIGINS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  USER_ROLES,
  WORKLOG_KINDS,
} from "./constants.ts";

export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export const ticketPrioritySchema = z.enum(TICKET_PRIORITIES);
export const ticketOriginSchema = z.enum(TICKET_ORIGINS);
export const worklogKindSchema = z.enum(WORKLOG_KINDS);
export const userRoleSchema = z.enum(USER_ROLES);

/** A git identity as observed locally (never trusted from the network). */
export const gitIdentitySchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
});
export type GitIdentity = z.infer<typeof gitIdentitySchema>;

/** Git context captured automatically for enrichment. */
export const gitContextSchema = z.object({
  repoRoot: z.string().min(1),
  repoRemote: z.string().default(""),
  branch: z.string().default(""),
  head: z.string().default(""),
  identity: gitIdentitySchema.nullable(),
});
export type GitContext = z.infer<typeof gitContextSchema>;

/** Per-repo committed config: .miniboss/config.json */
export const repoConfigSchema = z.object({
  schemaVersion: z.literal(1),
  team: z.string().min(1),
  project: z.string().min(1),
  server: z.string().url().nullish(),
});
export type RepoConfig = z.infer<typeof repoConfigSchema>;

/** Per-developer local state: .miniboss/state.json (gitignored). */
export const repoStateSchema = z.object({
  schemaVersion: z.literal(1),
  currentTicketId: z.string().nullable().default(null),
  currentTitle: z.string().nullable().default(null),
  status: ticketStatusSchema.nullable().default(null),
  openedAt: z.string().nullable().default(null),
  lastWorklogAt: z.string().nullable().default(null),
  pending: z
    .object({
      summary: z.string(),
      queuedAt: z.string(),
    })
    .nullable()
    .default(null),
  lastGit: z
    .object({
      branch: z.string(),
      remote: z.string(),
      head: z.string(),
    })
    .nullable()
    .default(null),
});
export type RepoState = z.infer<typeof repoStateSchema>;

/** A vetted, human-authored summary (≤ MAX_SUMMARY_LENGTH, no code/secrets). */
export const summarySchema = z
  .string()
  .trim()
  .min(1, "summary is empty")
  .max(MAX_SUMMARY_LENGTH, `summary exceeds ${MAX_SUMMARY_LENGTH} characters`);

/** Import manifest authored by Claude and consumed by `miniboss import`. */
export const importClusterSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).default(""),
  status: ticketStatusSchema.default("done"),
  commits: z.array(z.string().trim().min(4)).min(1),
});
export type ImportCluster = z.infer<typeof importClusterSchema>;

export const importManifestSchema = z.object({
  schemaVersion: z.literal(1),
  clusters: z.array(importClusterSchema).min(1),
});
export type ImportManifest = z.infer<typeof importManifestSchema>;

/** Shape of a tickets record as returned by PocketBase (fields we rely on). */
export const ticketRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(""),
  status: ticketStatusSchema,
  team: z.string().default(""),
  project: z.string().default(""),
  assignee: z.string().default(""),
  priority: ticketPrioritySchema.default("med"),
  tags: z.array(z.string()).default([]),
  repo_remote: z.string().default(""),
  branch: z.string().default(""),
  last_commit: z.string().default(""),
  origin: ticketOriginSchema.default("agent"),
  work_date: z.string().default(""),
  external_key: z.string().default(""),
  created: z.string().default(""),
  updated: z.string().default(""),
});
export type TicketRecord = z.infer<typeof ticketRecordSchema>;

export const worklogRecordSchema = z.object({
  id: z.string(),
  ticket: z.string(),
  author_member: z.string().default(""),
  author_user: z.string().default(""),
  kind: worklogKindSchema,
  message: z.string().default(""),
  meta: z.record(z.string(), z.unknown()).default({}),
  commit: z.string().default(""),
  work_date: z.string().default(""),
  created: z.string().default(""),
});
export type WorklogRecord = z.infer<typeof worklogRecordSchema>;
