/**
 * Guided, cross-platform client installer (macOS / Linux / Windows).
 * Idempotent end to end:
 *   - installs a `miniboss` launcher into the Bun bin dir (+ PATH on Unix)
 *   - stores server URL + agent credentials in the per-user config (600)
 *   - MERGES hooks into ~/.claude/settings.json (backup, never clobbers)
 *   - installs the skill into ~/.claude/skills/miniboss
 *   - verifies the connection with `miniboss doctor`
 */
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { mergeHooks } from "./hooks-merge.ts";

const isWindows = process.platform === "win32";

export interface InstallOptions {
  repoRoot: string;
  claudeDir: string;
  bunBinDir: string;
  zshrcPath: string; // shell rc file to add PATH to (Unix); ignored on Windows
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

/** Detect the user's shell rc file for PATH updates (zsh default, else bash). */
function shellRcPath(home: string): string {
  const shell = process.env.SHELL ?? "";
  if (shell.includes("bash")) {
    return existsSync(join(home, ".bashrc")) ? join(home, ".bashrc") : join(home, ".bash_profile");
  }
  return join(home, ".zshrc");
}

export function defaultOptions(repoRoot: string): InstallOptions {
  const home = homedir();
  const bunInstall =
    process.env.BUN_INSTALL && process.env.BUN_INSTALL.length > 0
      ? process.env.BUN_INSTALL
      : join(home, ".bun");
  return {
    repoRoot,
    claudeDir: join(home, ".claude"),
    bunBinDir: join(bunInstall, "bin"),
    zshrcPath: shellRcPath(home),
    interactive: true,
  };
}

function cliEntry(opts: InstallOptions): string {
  return join(opts.repoRoot, "packages", "cli", "bin", "miniboss.ts");
}

function launcherPath(opts: InstallOptions): string {
  return join(opts.bunBinDir, isWindows ? "miniboss.cmd" : "miniboss");
}

async function installLauncher(opts: InstallOptions, steps: string[], warnings: string[]): Promise<void> {
  const entry = cliEntry(opts);
  if (!existsSync(entry)) throw new Error(`CLI entry not found at ${entry}`);
  await mkdir(opts.bunBinDir, { recursive: true });

  if (isWindows) {
    // Windows shim: a .cmd that forwards to bun.
    await writeFile(launcherPath(opts), `@echo off\r\nbun "${entry}" %*\r\n`);
  } else {
    await writeFile(launcherPath(opts), `#!/bin/sh\n# miniboss launcher (generated)\nexec bun "${entry}" "$@"\n`);
    await chmod(launcherPath(opts), 0o755);
  }
  steps.push(`installed launcher → ${launcherPath(opts)}`);

  // Ensure the bin dir is on PATH.
  const sep = isWindows ? ";" : ":";
  const onPath = (process.env.PATH ?? "").split(sep).includes(opts.bunBinDir);
  if (onPath) return;

  if (isWindows) {
    warnings.push(`ensure ${opts.bunBinDir} is on your PATH (Bun's installer usually adds it) then open a new terminal`);
    return;
  }
  const line = `\n# miniboss / bun\nexport PATH="${opts.bunBinDir}:$PATH"\n`;
  const current = existsSync(opts.zshrcPath) ? await readFile(opts.zshrcPath, "utf8") : "";
  if (!current.includes(opts.bunBinDir)) {
    await writeFile(opts.zshrcPath, current + line);
    warnings.push(`added ${opts.bunBinDir} to PATH in ${opts.zshrcPath} — open a new terminal or run: source ${opts.zshrcPath}`);
  }
}

/** Run the CLI directly through bun (cross-platform; avoids launcher shell diffs). */
async function runCli(
  opts: InstallOptions,
  args: string[],
  stdin = ""
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env };
  if (opts.configHome) env.XDG_CONFIG_HOME = opts.configHome;
  const proc = Bun.spawn(["bun", cliEntry(opts), ...args], {
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

// ---- interactive wizard ---------------------------------------------------

function ask(question: string, fallback = ""): string {
  const answer = prompt(question);
  return (answer ?? "").trim() || fallback;
}

/**
 * Read a secret with the terminal echo off. Masking is delegated to the shell
 * (`stty -echo` reading the inherited TTY) — mixing Bun's prompt() with manual
 * process.stdin raw-mode reading can HANG, so we avoid it entirely. Falls back
 * to a visible prompt on Windows or when there is no TTY.
 */
async function readSecret(question: string): Promise<string> {
  if (!isWindows && process.stdin.isTTY) {
    try {
      process.stdout.write(`${question} `);
      const proc = Bun.spawn(
        ["sh", "-c", 'stty -echo 2>/dev/null; IFS= read -r secret; stty echo 2>/dev/null; printf %s "$secret"'],
        { stdin: "inherit", stdout: "pipe", stderr: "ignore" }
      );
      const value = await new Response(proc.stdout).text();
      const code = await proc.exited;
      process.stdout.write("\n");
      if (code === 0) return value.replace(/[\r\n]+$/, "");
    } catch {
      // fall through to a visible prompt
    }
  }
  return ask(`${question} (visible)`);
}

async function healthy(server: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/api/health", server), { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function wizard(opts: InstallOptions): Promise<{ server: string; email: string; password: string } | null> {
  process.stdout.write(
    "\n  Mini Boss View — connect this machine to your team board\n" +
      "  ─────────────────────────────────────────────────────────\n\n"
  );

  let server = opts.server ?? "";
  while (!server) {
    server = ask("  1/3  Board URL (e.g. https://board.yourcompany.com):");
    if (!/^https?:\/\//.test(server)) {
      process.stdout.write("       ↳ must start with http:// or https://\n");
      server = "";
      continue;
    }
    process.stdout.write(`       checking ${server} …\n`);
    if (await healthy(server)) {
      process.stdout.write("       ✓ reachable\n\n");
    } else {
      const cont = ask("       ✗ could not reach it. Continue anyway? [y/N]:").toLowerCase();
      if (cont !== "y") server = "";
    }
  }

  const email = opts.agentEmail ?? ask("  2/3  Agent email (from your board admin):");
  const password = opts.agentPassword ?? (await readSecret("  3/3  Agent password (hidden):"));
  if (!email || !password) {
    process.stdout.write("\n  Missing email/password — skipping connection setup.\n");
    return null;
  }
  return { server, email, password };
}

async function configure(opts: InstallOptions, steps: string[], warnings: string[]): Promise<void> {
  let creds: { server: string; email: string; password: string } | null;
  if (opts.interactive) {
    creds = await wizard(opts);
  } else if (opts.server && opts.agentEmail && opts.agentPassword) {
    creds = { server: opts.server, email: opts.agentEmail, password: opts.agentPassword };
  } else {
    creds = null;
  }

  if (!creds) {
    warnings.push("no server/credentials set — run `miniboss config set-server` and `set-agent` later");
    return;
  }
  await runCli(opts, ["config", "set-server", creds.server]);
  await runCli(opts, ["config", "set-agent", creds.email], creds.password);
  steps.push(`stored config for ${creds.email} → ${creds.server}`);
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
  steps.push(added > 0 ? `merged ${added} hook(s) into settings.json (backup written)` : "hooks already present");
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

  const doctor = await runCli(opts, ["doctor"]);
  const doctorOk = doctor.code === 0;
  if (!doctorOk) warnings.push("doctor reported issues:\n" + doctor.stdout.trim());

  return { ok: true, steps, warnings, doctorOk };
}
