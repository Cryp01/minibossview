/**
 * Resolve the stable identifier for a developer: their GitHub username.
 *
 * A developer commits under several git emails across machines; keying members
 * by GitHub username (not email) keeps them a single person on the board.
 *
 * Resolution order for the CURRENT developer (live reporting):
 *   1. `git config --get github.user`   (explicit, deterministic)
 *   2. GitHub noreply commit email       (…@users.noreply.github.com)
 *   3. `gh api user`                     (authenticated GitHub CLI user)
 *   4. email fallback                    (behaves like the old email dedup)
 *
 * For arbitrary commit authors (import) only steps 2 and 4 apply — we can't ask
 * GitHub who a historical email belongs to.
 */
import {
  emailFallbackUsername,
  githubUsernameFromEmail,
  normalizeUsername,
  type GitContext,
  type GitIdentity,
} from "@miniboss/shared";
import { git } from "./git.ts";

export interface MemberIdentity {
  username: string; // dedup key: github username, or email:<addr> fallback
  displayName: string;
  email: string;
  verified: boolean; // true when a real GitHub username was resolved
}

async function githubUserFromConfig(repoRoot: string): Promise<string | null> {
  const value = await git(["config", "--get", "github.user"], repoRoot);
  return value ? normalizeUsername(value) : null;
}

/** Best-effort: the authenticated GitHub CLI user, if `gh` is installed + authed. */
async function githubUserFromGh(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["gh", "api", "user", "--jq", ".login"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    const login = out.trim();
    return login ? normalizeUsername(login) : null;
  } catch {
    return null;
  }
}

/** Resolve the current developer's identity (used by live reporting). */
export async function resolveCurrentIdentity(ctx: GitContext): Promise<MemberIdentity | null> {
  const identity = ctx.identity;
  if (!identity) return null;

  const fromConfig = await githubUserFromConfig(ctx.repoRoot);
  const fromEmail = githubUsernameFromEmail(identity.email);
  const fromGh = fromConfig || fromEmail ? null : await githubUserFromGh();

  const resolved = fromConfig ?? fromEmail ?? fromGh;
  return {
    username: normalizeUsername(resolved ?? emailFallbackUsername(identity.email)),
    displayName: identity.name,
    email: identity.email,
    verified: Boolean(resolved),
  };
}

/** Resolve a commit author's identity (used by import; email-derived only). */
export function identityForAuthor(author: GitIdentity): MemberIdentity {
  const fromEmail = githubUsernameFromEmail(author.email);
  return {
    username: normalizeUsername(fromEmail ?? emailFallbackUsername(author.email)),
    displayName: author.name,
    email: author.email,
    verified: Boolean(fromEmail),
  };
}
