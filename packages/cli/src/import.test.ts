import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommitRecord } from "./git.ts";
import { dominantAuthor, groupByScope, groupByTime, runImport } from "./import.ts";
import { authWithPassword, PbClient } from "./pocketbase.ts";

function commit(partial: Partial<CommitRecord> & { sha: string; date: string }): CommitRecord {
  return {
    shortSha: partial.sha.slice(0, 7),
    authorName: partial.authorName ?? "A",
    authorEmail: partial.authorEmail ?? "a@example.com",
    subject: partial.subject ?? "subject",
    ...partial,
  };
}

describe("grouping (pure)", () => {
  test("groupByScope buckets by conventional-commit scope", () => {
    const commits = [
      commit({ sha: "1", date: "2026-01-01T00:00:00Z", subject: "feat(auth): add login" }),
      commit({ sha: "2", date: "2026-01-02T00:00:00Z", subject: "feat(auth): add logout" }),
      commit({ sha: "3", date: "2026-01-03T00:00:00Z", subject: "fix(api): null guard" }),
      commit({ sha: "4", date: "2026-01-04T00:00:00Z", subject: "chore: bump deps" }),
    ];
    const groups = groupByScope(commits);
    const auth = groups.find((g) => g.title.toLowerCase().includes("auth"));
    expect(auth?.commits.length).toBe(2);
  });

  test("groupByTime splits on author change and large gaps", () => {
    const commits = [
      commit({ sha: "1", date: "2026-01-01T10:00:00Z", authorEmail: "a@x.com" }),
      commit({ sha: "2", date: "2026-01-01T10:30:00Z", authorEmail: "a@x.com" }),
      commit({ sha: "3", date: "2026-01-01T10:45:00Z", authorEmail: "b@x.com" }),
    ];
    const groups = groupByTime(commits);
    expect(groups.length).toBe(2);
  });

  test("dominantAuthor picks the most frequent committer", () => {
    const commits = [
      commit({ sha: "1", date: "2026-01-01T00:00:00Z", authorEmail: "a@x.com", authorName: "A" }),
      commit({ sha: "2", date: "2026-01-02T00:00:00Z", authorEmail: "a@x.com", authorName: "A" }),
      commit({ sha: "3", date: "2026-01-03T00:00:00Z", authorEmail: "b@x.com", authorName: "B" }),
    ];
    expect(dominantAuthor(commits)?.email).toBe("a@x.com");
  });
});

// ---- live integration ------------------------------------------------------

const SERVER = process.env.MINIBOSS_TEST_SERVER ?? "http://127.0.0.1:8090";
const SU_EMAIL = "admin@miniboss.local";
const SU_PASSWORD = "changeme-admin-123";

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(new URL("/api/health", SERVER), { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}
const LIVE = await serverUp();

async function run(args: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(args, { cwd, env: { ...process.env, ...env }, stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

let repoDir = "";
let configHome = "";
let shas: string[] = [];

beforeAll(async () => {
  if (!LIVE) return;
  repoDir = await mkdtemp(join(tmpdir(), "miniboss-import-repo-"));
  configHome = await mkdtemp(join(tmpdir(), "miniboss-import-cfg-"));

  await run(["git", "init"], repoDir);
  await run(["git", "config", "user.name", "Importer"], repoDir);
  await run(["git", "config", "user.email", "importer@example.com"], repoDir);

  // Three commits, two authors, fixed historical dates.
  const commits = [
    { msg: "feat: scaffold", name: "Dana Ortiz", email: "dana.import@example.com", date: "2026-01-10T09:00:00" },
    { msg: "feat: add endpoint", name: "Dana Ortiz", email: "dana.import@example.com", date: "2026-01-11T09:00:00" },
    { msg: "fix: edge case", name: "Marco Li", email: "marco.import@example.com", date: "2026-02-01T09:00:00" },
  ];
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i]!;
    await writeFile(join(repoDir, `file${i}.txt`), `content ${i}\n`);
    await run(["git", "add", "."], repoDir);
    await run(["git", "commit", "-m", c.msg, "--author", `${c.name} <${c.email}>`], repoDir, {
      GIT_AUTHOR_DATE: c.date,
      GIT_COMMITTER_DATE: c.date,
    });
  }
  const log = Bun.spawnSync(["git", "log", "--pretty=format:%H"], { cwd: repoDir });
  shas = log.stdout.toString().trim().split("\n").reverse(); // oldest first

  await mkdir(join(repoDir, ".miniboss"), { recursive: true });
  await writeFile(
    join(repoDir, ".miniboss", "config.json"),
    JSON.stringify({ schemaVersion: 1, team: "platform", project: "import-test-project" })
  );

  process.env.XDG_CONFIG_HOME = configHome;
  process.env.MINIBOSS_SERVER = SERVER;
  process.env.MINIBOSS_AGENT_EMAIL = "agent@miniboss.local";
  process.env.MINIBOSS_AGENT_PASSWORD = "changeme-agent-123";
});

afterAll(async () => {
  if (!LIVE) return;
  try {
    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    const client = new PbClient(SERVER, su.token);
    const page = await client.list("tickets", {
      filter: 'project.slug = "import-test-project"',
      perPage: 200,
    });
    for (const t of page.items) await client.delete("tickets", t.id).catch(() => {});
  } catch {
    // best effort
  }
  await rm(repoDir, { recursive: true, force: true });
  await rm(configHome, { recursive: true, force: true });
});

describe.skipIf(!LIVE)("import (live)", () => {
  test("dry-run plans clusters without writing", async () => {
    const res = await runImport({
      cwd: repoDir,
      manifest: null,
      group: "time",
      allBranches: true,
      status: null,
      dryRun: true,
      replace: false,
    });
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.planned).toBeGreaterThanOrEqual(1);
    expect(res.ticketsCreated).toBe(0);
  });

  test("manifest import creates backdated tickets attributed to commit authors", async () => {
    const manifest = {
      schemaVersion: 1 as const,
      clusters: [
        { title: "Scaffold and endpoint", summary: "Initial feature work.", status: "done" as const, commits: [shas[0]!, shas[1]!] },
        { title: "Edge-case fix", summary: "Hardened an edge case.", status: "done" as const, commits: [shas[2]!] },
      ],
    };
    const res = await runImport({
      cwd: repoDir,
      manifest,
      group: "manifest",
      allBranches: true,
      status: null,
      dryRun: false,
      replace: false,
    });
    expect(res.ok).toBe(true);
    expect(res.ticketsCreated).toBe(2);
    expect(res.worklogsAdded).toBe(3);

    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    const client = new PbClient(SERVER, su.token);
    const scaffold = await client.getFirst("tickets", 'title = "Scaffold and endpoint"');
    expect(scaffold).not.toBeNull();
    // backdated to the oldest commit (2026-01-10)
    expect(String(scaffold!.work_date)).toContain("2026-01-10");

    // worklog attributed to the commit author (Dana)
    const dana = await client.getFirst("members", `email_normalized = "dana.import@example.com"`);
    const logs = await client.list("worklog", { filter: `ticket = "${scaffold!.id}"` });
    expect(logs.items.every((l) => l.author_member === dana!.id)).toBe(true);
  });

  test("re-import is idempotent (no duplicate worklog)", async () => {
    const manifest = {
      schemaVersion: 1 as const,
      clusters: [
        { title: "Scaffold and endpoint", summary: "Initial feature work.", status: "done" as const, commits: [shas[0]!, shas[1]!] },
      ],
    };
    const res = await runImport({
      cwd: repoDir,
      manifest,
      group: "manifest",
      allBranches: true,
      status: null,
      dryRun: false,
      replace: false,
    });
    expect(res.ticketsCreated).toBe(0);
    expect(res.ticketsUpdated).toBe(1);
    expect(res.worklogsAdded).toBe(0); // deduped by (ticket, commit)
  });

  test("--replace clears prior import tickets for the repo", async () => {
    const manifest = {
      schemaVersion: 1 as const,
      clusters: [
        { title: "Single merged cluster", summary: "All work.", status: "done" as const, commits: shas },
      ],
    };
    const res = await runImport({
      cwd: repoDir,
      manifest,
      group: "manifest",
      allBranches: true,
      status: null,
      dryRun: false,
      replace: true,
    });
    expect(res.ok).toBe(true);

    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    const client = new PbClient(SERVER, su.token);
    const page = await client.list("tickets", {
      filter: 'project.slug = "import-test-project" && origin = "import"',
      perPage: 50,
    });
    // Only the single replacement cluster remains.
    expect(page.items.length).toBe(1);
    expect(page.items[0]!.title).toBe("Single merged cluster");
  });
});
