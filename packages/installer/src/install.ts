/**
 * One-command macOS installer. Idempotent end to end:
 *   - installs a `miniboss` launcher into ~/.bun/bin (+ PATH in ~/.zshrc)
 *   - stores server URL + agent credentials in ~/.config/miniboss (600)
 *   - MERGES hooks into ~/.claude/settings.json (backup, never clobbers)
 *   - installs the skill into ~/.claude/skills/miniboss
 *   - runs `miniboss doctor`
 */
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { mergeHooks } from "./hooks-merge.ts";

export interface InstallOptions {
  repoRoot: string;
  claudeDir: string;
  bunBinDir: string;
  zshrcPath: string;
  configHome?: string; // XDG_CONFIG_HOME override (used by tests)
  server?: string;
  agentEmail?: string;
  agentPassword?: string;
  interactive: boolean;
}

export interface InstallReport {
  ok: boolean;
  steps: string[];
  warnings: string[];
  doctorOk: boolean;
}

export function defaultOptions(repoRoot: string): InstallOptions {
  const home = homedir();
  const bunInstall = process.env.BUN_INSTALL && process.env.BUN_INSTALL.length > 0
    ? process.env.BUN_INSTALL
    : join(home, ".bun");
  return {
    repoRoot,
    claudeDir: join(home, ".claude"),
    bunBinDir: join(bunInstall, "bin"),
    zshrcPath: join(home, ".zshrc"),
    interactive: true,
  };
}

function launcherPath(opts: InstallOptions): string {
  return join(opts.bunBinDir, "miniboss");
}

async function installLauncher(opts: InstallOptions, steps: string[], warnings: string[]): Promise<void> {
  const cliEntry = join(opts.repoRoot, "packages", "cli", "bin", "miniboss.ts");
  if (!existsSync(cliEntry)) throw new Error(`CLI entry not found at ${cliEntry}`);

  await mkdir(opts.bunBinDir, { recursive: true });
  const launcher = `#!/bin/sh\n# miniboss launcher (generated)\nexec bun "${cliEntry}" "$@"\n`;
  await writeFile(launcherPath(opts), launcher);
  await chmod(launcherPath(opts), 0o755);
  steps.push(`installed launcher → ${launcherPath(opts)}`);

  // Ensure the bin dir is on PATH (zsh is the user's shell).
  const onPath = (process.env.PATH ?? "").split(":").includes(opts.bunBinDir);
  if (!onPath) {
    const line = `\n# miniboss / bun\nexport PATH="${opts.bunBinDir}:$PATH"\n`;
    const current = existsSync(opts.zshrcPath) ? await readFile(opts.zshrcPath, "utf8") : "";
    if (!current.includes(opts.bunBinDir)) {
      await writeFile(opts.zshrcPath, current + line);
      warnings.push(`added ${opts.bunBinDir} to PATH in ${opts.zshrcPath} — open a new terminal or 'source ~/.zshrc'`);
    }
  }
}

async function runLauncher(
  opts: InstallOptions,
  args: string[],
  stdin = ""
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env };
  if (opts.configHome) env.XDG_CONFIG_HOME = opts.configHome;
  const proc = Bun.spawn(["sh", launcherPath(opts), ...args], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout, stderr };
}

async function configure(opts: InstallOptions, steps: string[], warnings: string[]): Promise<void> {
  const server = opts.server ?? (opts.interactive ? prompt("Board server URL (e.g. https://board.example.com):") : null);
  const email = opts.agentEmail ?? (opts.interactive ? prompt("Agent email:") : null);
  const password =
    opts.agentPassword ?? (opts.interactive ? prompt("Agent password:") : null);

  if (!server || !email || !password) {
    warnings.push("server/agent credentials not provided — run `miniboss config set-server` and `set-agent` later");
    return;
  }
  await runLauncher(opts, ["config", "set-server", server]);
  await runLauncher(opts, ["config", "set-agent", email], password);
  steps.push(`stored config for ${email} → ${server}`);
}

async function mergeSettings(opts: InstallOptions, steps: string[]): Promise<void> {
  const settingsPath = join(opts.claudeDir, "settings.json");
  await mkdir(opts.claudeDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    const raw = await readFile(settingsPath, "utf8");
    try {
      existing = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`${settingsPath} is not valid JSON — fix it before installing`);
    }
    await copyFile(settingsPath, `${settingsPath}.miniboss.bak`);
  }

  const { settings, added } = mergeHooks(existing);
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2));
  await rename(tmp, settingsPath);
  steps.push(added > 0 ? `merged ${added} hook(s) into settings.json (backup written)` : "hooks already present (no change)");
}

async function installSkill(opts: InstallOptions, steps: string[], warnings: string[]): Promise<void> {
  const skillsDir = join(opts.claudeDir, "skills");
  const skillsExisted = existsSync(skillsDir);
  const target = join(skillsDir, "miniboss");
  await mkdir(target, { recursive: true });
  await copyFile(join(opts.repoRoot, "skills", "miniboss", "SKILL.md"), join(target, "SKILL.md"));
  steps.push(`installed skill → ${join(target, "SKILL.md")}`);
  if (!skillsExisted) {
    warnings.push("created ~/.claude/skills for the first time — restart Claude Code to pick up the skill");
  }
}

export async function install(opts: InstallOptions): Promise<InstallReport> {
  const steps: string[] = [];
  const warnings: string[] = [];

  await installLauncher(opts, steps, warnings);
  await configure(opts, steps, warnings);
  await mergeSettings(opts, steps);
  await installSkill(opts, steps, warnings);

  const doctor = await runLauncher(opts, ["doctor"]);
  const doctorOk = doctor.code === 0;
  if (!doctorOk) warnings.push("doctor reported issues:\n" + doctor.stdout.trim());

  return { ok: true, steps, warnings, doctorOk };
}
