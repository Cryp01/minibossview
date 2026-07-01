/**
 * Pure helpers for git-identity normalization and idempotency keys.
 * Shared so the CLI (writer) and the board (admin/merge UI) agree on dedup keys.
 */

/** Canonical dedup key for a git identity: lowercased, trimmed email. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalize a GitHub username (case-insensitive) to a stable key. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Extract a GitHub username from a GitHub noreply commit email, e.g.
 * `12345+octocat@users.noreply.github.com` or `octocat@users.noreply.github.com`.
 * Returns the lowercased username or null if the email isn't a GitHub noreply.
 */
export function githubUsernameFromEmail(email: string): string | null {
  const match = email
    .trim()
    .toLowerCase()
    .match(/^(?:\d+\+)?([a-z0-9](?:[a-z0-9]|-){0,38})@users\.noreply\.github\.com$/);
  return match ? match[1]! : null;
}

/**
 * The members dedup key when no GitHub username is known: an email-scoped id.
 * Keeps behavior identical to email dedup until a real username resolves.
 */
export function emailFallbackUsername(email: string): string {
  return `email:${normalizeEmail(email)}`;
}

/** Best-effort short, stable, opaque hash for idempotency keys (FNV-1a, hex). */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Idempotency key for an imported ticket: stable across re-imports of the
 * same commit set in the same repo, independent of cluster title.
 */
export function importExternalKey(repo: string, commitShas: readonly string[]): string {
  const sorted = [...commitShas].map((s) => s.trim()).sort();
  return `import:${repo}:${stableHash(sorted.join(","))}`;
}

/** Idempotency key for a live (agent-reported) ticket. */
export function reportExternalKey(repo: string, branch: string, title: string): string {
  return `report:${repo}:${stableHash(`${branch}\n${normalizeTitle(title)}`)}`;
}

/** Normalize a title for case/whitespace-insensitive matching. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Slug for teams/projects: lowercase, non-alphanumerics collapsed to a single
 * dash, trimmed. Matches the PocketBase slug pattern `^[a-z0-9-]+$`.
 * Returns "" when the input has no usable characters (caller supplies a fallback).
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
