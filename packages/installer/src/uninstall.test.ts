import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeHooks } from "./hooks-merge.ts";
import { uninstall, type UninstallOptions } from "./uninstall.ts";

let root = "";
let opts: UninstallOptions;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "miniboss-uninstall-"));
  const claudeDir = join(root, "claude");
  const bunBinDir = join(root, "bin");
  const configHome = join(root, "config");

  // Simulate an install: GSD + miniboss hooks, a launcher, skill, config.
  await mkdir(claudeDir, { recursive: true });
  const settings = mergeHooks({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "gsd session-start" }] }] },
  }).settings;
  await writeFile(join(claudeDir, "settings.json"), JSON.stringify(settings));
  await mkdir(join(claudeDir, "skills", "miniboss"), { recursive: true });
  await writeFile(join(claudeDir, "skills", "miniboss", "SKILL.md"), "# skill");
  await mkdir(bunBinDir, { recursive: true });
  await writeFile(join(bunBinDir, "miniboss"), "#!/bin/sh\n");
  await mkdir(join(configHome, "miniboss"), { recursive: true });
  await writeFile(join(configHome, "miniboss", "config.json"), "{}");

  opts = { claudeDir, bunBinDir, configHome, purge: false };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("uninstall", () => {
  test("removes launcher, skill, and miniboss hooks — keeps GSD and config", async () => {
    await uninstall(opts);

    expect(existsSync(join(opts.bunBinDir, "miniboss"))).toBe(false);
    expect(existsSync(join(opts.claudeDir, "skills", "miniboss"))).toBe(false);

    const settings = JSON.parse(await readFile(join(opts.claudeDir, "settings.json"), "utf8"));
    const ss = settings.hooks.SessionStart.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(ss).toContain("gsd session-start");
    expect(ss).not.toContain("miniboss hook session-start");
    expect(settings.hooks.Stop).toBeUndefined();

    // Config kept without --purge.
    expect(existsSync(join(opts.configHome, "miniboss", "config.json"))).toBe(true);
  });

  test("--purge also removes the config", async () => {
    await uninstall({ ...opts, purge: true });
    expect(existsSync(join(opts.configHome, "miniboss"))).toBe(false);
  });

  test("is idempotent when nothing is installed", async () => {
    const empty = await mkdtemp(join(tmpdir(), "miniboss-empty-"));
    const report = await uninstall({
      claudeDir: join(empty, "claude"),
      bunBinDir: join(empty, "bin"),
      configHome: join(empty, "config"),
      purge: true,
    });
    expect(report.steps.length).toBe(0);
    await rm(empty, { recursive: true, force: true });
  });
});
