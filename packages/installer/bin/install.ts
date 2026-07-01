#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { defaultOptions, install } from "../src/install.ts";

// repoRoot = three levels up from packages/installer/bin
const repoRoot = resolve(import.meta.dir, "..", "..", "..");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    server: { type: "string" },
    "agent-email": { type: "string" },
    "agent-password": { type: "string" },
    "claude-dir": { type: "string" },
    "bun-bin-dir": { type: "string" },
    "config-home": { type: "string" },
    "non-interactive": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  process.stdout.write(
    `miniboss installer\n\n` +
      `  --server <url>           board server URL\n` +
      `  --agent-email <email>    agent account email\n` +
      `  --agent-password <pass>  agent account password\n` +
      `  --non-interactive        do not prompt; use flags only\n`
  );
  process.exit(0);
}

const opts = defaultOptions(repoRoot);
if (values["claude-dir"]) opts.claudeDir = values["claude-dir"];
if (values["bun-bin-dir"]) opts.bunBinDir = values["bun-bin-dir"];
if (values["config-home"]) opts.configHome = values["config-home"];
if (values.server) opts.server = values.server;
if (values["agent-email"]) opts.agentEmail = values["agent-email"];
if (values["agent-password"]) opts.agentPassword = values["agent-password"];
opts.interactive = !values["non-interactive"];

process.stdout.write("Installing miniboss...\n");
const report = await install(opts);

for (const step of report.steps) process.stdout.write(`  ✓ ${step}\n`);
for (const warning of report.warnings) process.stdout.write(`  ! ${warning}\n`);
process.stdout.write(
  report.doctorOk
    ? "\nDone. miniboss is installed and healthy.\n"
    : "\nInstalled, but doctor found issues — see warnings above.\n"
);
process.exit(report.ok ? 0 : 1);
