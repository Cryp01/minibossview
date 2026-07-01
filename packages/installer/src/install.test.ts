import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { install, type InstallOptions } from "./install.ts";

const SERVER = process.env.MINIBOSS_TEST_SERVER ?? "http://127.0.0.1:8090";
const repoRoot = resolve(import.meta.dir, "..", "..", "..");

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(new URL("/api/health", SERVER), { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}
const LIVE = await serverUp();

let root = "";
let opts: InstallOptions;
let tempRepo = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "miniboss-install-"));
  const claudeDir = join(root, "claude");
  await mkdir(claudeDir, { recursive: true });
  // Pre-existing GSD settings that must survive.
  await writeFile(
    join(claudeDir, "settings.json"),
    JSON.stringify({
      model: "claude-opus-4-8",
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "gsd session-start" }] }] },
    })
  );

  opts = {
    repoRoot,
    claudeDir,
    bunBinDir: join(root, "bin"),
    zshrcPath: join(root, ".zshrc"),
    configHome: join(root, "config"),
    server: SERVER,
    agentEmail: "agent@miniboss.local",
    agentPassword: "changeme-agent-123",
    interactive: false,
  };

  // A temp git repo to validate doctor end-to-end.
  tempRepo = await mkdtemp(join(tmpdir(), "miniboss-install-repo-"));
  const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: tempRepo });
  git(["init"]);
  git(["config", "user.name", "Installer Tester"]);
  git(["config", "user.email", "install.tester@example.com"]);
  await mkdir(join(tempRepo, ".miniboss"), { recursive: true });
  await writeFile(
    join(tempRepo, ".miniboss", "config.json"),
    JSON.stringify({ schemaVersion: 1, team: "platform", project: "installer-test" })
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(tempRepo, { recursive: true, force: true });
});

describe.skipIf(!LIVE)("installer (live)", () => {
  test("installs launcher, merges hooks, stores config and skill", async () => {
    const report = await install(opts);
    expect(report.ok).toBe(true);

    // Launcher installed and executable.
    const launcher = join(opts.bunBinDir, "miniboss");
    expect(existsSync(launcher)).toBe(true);
    expect((await stat(launcher)).mode & 0o111).toBeGreaterThan(0);

    // Settings merged: GSD preserved + miniboss handlers + backup.
    const settings = JSON.parse(await readFile(join(opts.claudeDir, "settings.json"), "utf8"));
    const ssCommands = settings.hooks.SessionStart.flatMap((g: any) =>
      g.hooks.map((h: any) => h.command)
    );
    expect(ssCommands).toContain("gsd session-start");
    expect(ssCommands).toContain("miniboss hook session-start");
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("miniboss hook stop");
    expect(existsSync(join(opts.claudeDir, "settings.json.miniboss.bak"))).toBe(true);

    // Skill installed.
    expect(existsSync(join(opts.claudeDir, "skills", "miniboss", "SKILL.md"))).toBe(true);

    // Config stored with 600 perms and correct values.
    const configFile = join(opts.configHome!, "miniboss", "config.json");
    expect(existsSync(configFile)).toBe(true);
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);
    const config = JSON.parse(await readFile(configFile, "utf8"));
    expect(config.server).toBe(SERVER);
    expect(config.agentEmail).toBe("agent@miniboss.local");
  });

  test("is idempotent — re-running adds no duplicate hooks", async () => {
    await install(opts);
    const settings = JSON.parse(await readFile(join(opts.claudeDir, "settings.json"), "utf8"));
    const stopGroups = settings.hooks.Stop;
    expect(stopGroups.length).toBe(1); // not duplicated
    const ssCommands = settings.hooks.SessionStart.flatMap((g: any) =>
      g.hooks.map((h: any) => h.command)
    );
    expect(ssCommands.filter((c: string) => c === "miniboss hook session-start").length).toBe(1);
  });

  test("installed launcher passes doctor in a configured repo", async () => {
    const proc = Bun.spawn(["sh", join(opts.bunBinDir, "miniboss"), "doctor"], {
      cwd: tempRepo,
      env: { ...process.env, XDG_CONFIG_HOME: opts.configHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  });
});
