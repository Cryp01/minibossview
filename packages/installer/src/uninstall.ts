/**
 * Cross-platform uninstaller: reverses what install.ts did.
 *   - removes the `miniboss` launcher from the Bun bin dir
 *   - removes the skill from ~/.claude/skills/miniboss
 *   - un-merges ONLY the miniboss hooks from ~/.claude/settings.json (backup;
 *     other hooks are preserved)
 *   - with --purge: also removes the per-user config (~/.config/miniboss)
 * Idempotent and safe to run when things are already gone.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { unmergeHooks } from "./hooks-merge.ts";

export interface UninstallOptions {
  claudeDir: string;
  bunBinDir: string;
  configHome: string;
  purge: boolean;
}

export interface UninstallReport {
  steps: string[];
  warnings: string[];
}

export function defaultUninstallOptions(): UninstallOptions {
  const home = homedir();
  const bunInstall =
    process.env.BUN_INSTALL && process.env.BUN_INSTALL.length > 0
      ? process.env.BUN_INSTALL
      : join(home, ".bun");
  const xdg = process.env.XDG_CONFIG_HOME;
  return {
    claudeDir: join(home, ".claude"),
    bunBinDir: join(bunInstall, "bin"),
    configHome: xdg && xdg.length > 0 ? xdg : join(home, ".config"),
    purge: false,
  };
}

async function removeIfPresent(path: string, steps: string[], label: string): Promise<void> {
  if (existsSync(path)) {
    await rm(path, { recursive: true, force: true });
    steps.push(`removed ${label} → ${path}`);
  }
}

export async function uninstall(opts: UninstallOptions): Promise<UninstallReport> {
  const steps: string[] = [];
  const warnings: string[] = [];

  // Launcher (both possible names).
  await removeIfPresent(join(opts.bunBinDir, "miniboss"), steps, "launcher");
  await removeIfPresent(join(opts.bunBinDir, "miniboss.cmd"), steps, "launcher");

  // Skill.
  await removeIfPresent(join(opts.claudeDir, "skills", "miniboss"), steps, "skill");

  // Hooks — remove only ours, keep the rest.
  const settingsPath = join(opts.claudeDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const raw = await readFile(settingsPath, "utf8");
      const existing = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
      await copyFile(settingsPath, `${settingsPath}.miniboss.bak`);
      const cleaned = unmergeHooks(existing);
      const tmp = `${settingsPath}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(cleaned, null, 2));
      await rename(tmp, settingsPath);
      steps.push("removed miniboss hooks from settings.json (backup written)");
    } catch {
      warnings.push(`could not edit ${settingsPath} — remove the miniboss hooks manually`);
    }
  }

  // Config (only with --purge).
  const configDir = join(opts.configHome, "miniboss");
  if (opts.purge) {
    await removeIfPresent(configDir, steps, "config");
  } else if (existsSync(configDir)) {
    warnings.push(`kept your config at ${configDir} (re-run with --purge to delete it)`);
  }

  await mkdir(opts.claudeDir, { recursive: true }).catch(() => {});
  return { steps, warnings };
}
