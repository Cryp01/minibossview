#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { defaultUninstallOptions, uninstall } from "../src/uninstall.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "claude-dir": { type: "string" },
    "bun-bin-dir": { type: "string" },
    "config-home": { type: "string" },
    purge: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  process.stdout.write(
    "miniboss uninstaller\n\n" +
      "  --purge                 also delete the per-user config (server + credentials)\n" +
      "  --claude-dir <path>     override ~/.claude\n" +
      "  --bun-bin-dir <path>    override the Bun bin dir\n" +
      "  --config-home <path>    override XDG config home\n"
  );
  process.exit(0);
}

const opts = defaultUninstallOptions();
if (values["claude-dir"]) opts.claudeDir = values["claude-dir"];
if (values["bun-bin-dir"]) opts.bunBinDir = values["bun-bin-dir"];
if (values["config-home"]) opts.configHome = values["config-home"];
opts.purge = Boolean(values.purge);

process.stdout.write("Uninstalling miniboss...\n");
const report = await uninstall(opts);
for (const step of report.steps) process.stdout.write(`  ✓ ${step}\n`);
for (const warning of report.warnings) process.stdout.write(`  ! ${warning}\n`);
process.stdout.write(
  "\nDone. Restart Claude Code so it drops the /miniboss skill and hooks.\n"
);
