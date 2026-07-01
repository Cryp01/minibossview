import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitContext } from "@miniboss/shared";
import { deriveRepoConfig, parseRemote, runInit } from "./init.ts";

describe("parseRemote", () => {
  const cases: Array<[string, string, { owner: string; repo: string } | null]> = [
    ["scp", "git@github.com:acme/checkout-api.git", { owner: "acme", repo: "checkout-api" }],
    ["https", "https://github.com/acme/checkout-api.git", { owner: "acme", repo: "checkout-api" }],
    ["ssh", "ssh://git@host.com/acme/repo.git", { owner: "acme", repo: "repo" }],
    ["no .git", "https://gitlab.com/team/sub/proj", { owner: "sub", repo: "proj" }],
    ["single", "git@host:solorepo.git", { owner: "", repo: "solorepo" }],
    ["empty", "", null],
  ];
  for (const [label, remote, expected] of cases) {
    test(label, () => {
      expect(parseRemote(remote)).toEqual(expected);
    });
  }
});

function ctx(partial: Partial<GitContext>): GitContext {
  return {
    repoRoot: "/tmp/My Repo",
    repoRemote: "",
    branch: "main",
    head: "abc123",
    identity: null,
    ...partial,
  };
}

describe("deriveRepoConfig", () => {
  test("team from remote owner, project from repo name", () => {
    const cfg = deriveRepoConfig(ctx({ repoRemote: "git@github.com:Acme-Org/Checkout_API.git" }));
    expect(cfg.team).toBe("acme-org");
    expect(cfg.project).toBe("checkout-api");
  });

  test("no remote → project from folder, team defaults", () => {
    const cfg = deriveRepoConfig(ctx({ repoRoot: "/Users/x/My Cool Project", repoRemote: "" }));
    expect(cfg.project).toBe("my-cool-project");
    expect(cfg.team).toBe("default");
  });
});

describe("runInit (temp repo)", () => {
  let repoDir = "";
  const run = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: repoDir });

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "miniboss-init-"));
    run(["init"]);
    run(["remote", "add", "origin", "git@github.com:demo-team/awesome-repo.git"]);
  });
  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("writes config derived from the remote", async () => {
    const res = await runInit({ cwd: repoDir, force: false });
    expect(res.ok).toBe(true);
    expect(res.created).toBe(true);
    expect(res.team).toBe("demo-team");
    expect(res.project).toBe("awesome-repo");

    const cfg = JSON.parse(await readFile(join(repoDir, ".miniboss", "config.json"), "utf8"));
    expect(cfg).toMatchObject({ schemaVersion: 1, team: "demo-team", project: "awesome-repo" });

    const ignore = await readFile(join(repoDir, ".miniboss", ".gitignore"), "utf8");
    expect(ignore).toContain("state.json");
  });

  test("does not overwrite without --force", async () => {
    const res = await runInit({ cwd: repoDir, force: false });
    expect(res.created).toBe(false);
    expect(res.message).toContain("already exists");
  });

  test("overrides win and --force overwrites", async () => {
    const res = await runInit({ cwd: repoDir, team: "Payments Team", project: "billing", force: true });
    expect(res.created).toBe(true);
    expect(res.team).toBe("payments-team");
    expect(res.project).toBe("billing");
  });
});
