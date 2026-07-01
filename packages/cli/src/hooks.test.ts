import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookSessionEnd, hookSessionStart, hookStop } from "./hooks.ts";

let repoDir = "";
let configHome = "";

beforeAll(async () => {
  repoDir = await mkdtemp(join(tmpdir(), "miniboss-hook-repo-"));
  configHome = await mkdtemp(join(tmpdir(), "miniboss-hook-cfg-"));
  // Hermetic: no server/creds so the outbox drain is a clean no-op.
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.MINIBOSS_SERVER;
  delete process.env.MINIBOSS_AGENT_EMAIL;
  delete process.env.MINIBOSS_AGENT_PASSWORD;

  const proc = Bun.spawn(["git", "init"], { cwd: repoDir, stdout: "ignore", stderr: "ignore" });
  await proc.exited;
  await mkdir(join(repoDir, ".miniboss"), { recursive: true });
});

afterAll(async () => {
  await rm(repoDir, { recursive: true, force: true });
  await rm(configHome, { recursive: true, force: true });
});

describe("hooks never throw and exit cleanly", () => {
  test("stop tolerates malformed stdin", async () => {
    const out = await hookStop("this is not json");
    expect(out.stdout).toBe("");
  });

  test("session-end tolerates empty stdin", async () => {
    const out = await hookSessionEnd("");
    expect(out.stdout).toBe("");
  });

  test("session-start emits no context when there is no active task", async () => {
    const out = await hookSessionStart(JSON.stringify({ cwd: repoDir, source: "startup" }));
    expect(out.stdout).toBe("");
  });

  test("session-start surfaces the active task as additionalContext", async () => {
    await writeFile(
      join(repoDir, ".miniboss", "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        currentTicketId: "abc123",
        currentTitle: "Add idempotency keys",
        status: "in_progress",
      })
    );
    const out = await hookSessionStart(JSON.stringify({ cwd: repoDir, source: "resume" }));
    expect(out.stdout).toContain("additionalContext");
    expect(out.stdout).toContain("Add idempotency keys");
    const parsed = JSON.parse(out.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });
});
