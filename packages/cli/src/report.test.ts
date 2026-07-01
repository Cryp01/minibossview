import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authWithPassword, PbClient } from "./pocketbase.ts";
import { reportDone, reportStart, reportStatus, reportUpdate } from "./report.ts";
import { loadState } from "./state.ts";

const SERVER = process.env.MINIBOSS_TEST_SERVER ?? "http://127.0.0.1:8090";
const AGENT_EMAIL = "agent@miniboss.local";
const AGENT_PASSWORD = "changeme-agent-123";
const SU_EMAIL = "admin@miniboss.local";
const SU_PASSWORD = "changeme-admin-123";
const DEV_EMAIL = "repo.tester@example.com";

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(new URL("/api/health", SERVER), { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}
const LIVE = await serverUp();

async function run(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

let repoDir = "";
let configHome = "";
const createdTicketIds: string[] = [];

beforeAll(async () => {
  if (!LIVE) return;
  repoDir = await mkdtemp(join(tmpdir(), "miniboss-repo-"));
  configHome = await mkdtemp(join(tmpdir(), "miniboss-cfg-"));

  await run(["git", "init"], repoDir);
  await run(["git", "config", "user.name", "Repo Tester"], repoDir);
  await run(["git", "config", "user.email", DEV_EMAIL], repoDir);
  await writeFile(join(repoDir, "README.md"), "# test\n");
  await run(["git", "add", "."], repoDir);
  await run(["git", "commit", "-m", "init"], repoDir);

  await mkdir(join(repoDir, ".miniboss"), { recursive: true });
  await writeFile(
    join(repoDir, ".miniboss", "config.json"),
    JSON.stringify({ schemaVersion: 1, team: "platform", project: "report-test-project" })
  );

  process.env.XDG_CONFIG_HOME = configHome;
  process.env.MINIBOSS_SERVER = SERVER;
  process.env.MINIBOSS_AGENT_EMAIL = AGENT_EMAIL;
  process.env.MINIBOSS_AGENT_PASSWORD = AGENT_PASSWORD;
});

afterAll(async () => {
  if (!LIVE) return;
  try {
    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    const client = new PbClient(SERVER, su.token);
    for (const id of createdTicketIds) await client.delete("tickets", id).catch(() => {});
  } catch {
    // best effort
  }
  await rm(repoDir, { recursive: true, force: true });
  await rm(configHome, { recursive: true, force: true });
});

describe.skipIf(!LIVE)("report lifecycle (live)", () => {
  test("start creates a ticket attributed to the git identity", async () => {
    const out = await reportStart(repoDir, "Add idempotency keys", "Started outlining the approach.");
    expect(out.ok).toBe(true);
    expect(out.delivered).toBe(true);
    expect(out.ticketId).toBeTruthy();
    createdTicketIds.push(out.ticketId!);

    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    const client = new PbClient(SERVER, su.token);
    const ticket = await client.list("tickets", { filter: `id = "${out.ticketId}"`, perPage: 1 });
    const rec = ticket.items[0]!;
    expect(rec.title).toBe("Add idempotency keys");
    expect(rec.status).toBe("in_progress");
    expect(rec.origin).toBe("agent");

    // assignee resolves to the member with the dev's git email
    const member = await client.getFirst("members", `email_normalized = "${DEV_EMAIL}"`);
    expect(member).not.toBeNull();
    expect(rec.assignee).toBe(member!.id);

    const logs = await client.list("worklog", { filter: `ticket = "${out.ticketId}"` });
    expect(logs.totalItems).toBeGreaterThanOrEqual(1);
  });

  test("update appends to the SAME ticket", async () => {
    const before = await reportStatus(repoDir);
    expect(before.ticketId).toBeTruthy();

    const out = await reportUpdate(repoDir, "Wired the middleware and added tests.");
    expect(out.delivered).toBe(true);
    expect(out.ticketId).toBe(before.ticketId);

    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    const client = new PbClient(SERVER, su.token);
    const logs = await client.list("worklog", { filter: `ticket = "${out.ticketId}"` });
    expect(logs.totalItems).toBeGreaterThanOrEqual(2);
  });

  test("done moves to done and clears the pointer", async () => {
    const out = await reportDone(repoDir, "Shipped and merged.");
    expect(out.delivered).toBe(true);

    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    const client = new PbClient(SERVER, su.token);
    const id = createdTicketIds[0]!;
    const ticket = await client.list("tickets", { filter: `id = "${id}"`, perPage: 1 });
    expect(ticket.items[0]!.status).toBe("done");

    const state = await loadState(repoDir);
    expect(state.currentTicketId).toBeNull();
    expect(state.currentTitle).toBeNull();
  });

  test("re-start with the same title does not duplicate the ticket", async () => {
    const first = await reportStart(repoDir, "Dedup check task", "");
    createdTicketIds.push(first.ticketId!);
    const second = await reportStart(repoDir, "  dedup   check task ", "");
    expect(second.ticketId).toBe(first.ticketId);
  });
});
