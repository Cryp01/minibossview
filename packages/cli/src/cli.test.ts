import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "bin", "miniboss.ts");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], stdin = ""): Promise<RunResult> {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, XDG_CONFIG_HOME: "/tmp/miniboss-cli-test-cfg" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("cli dispatch", () => {
  test("no command prints usage and exits non-zero", async () => {
    const r = await runCli([]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("report start");
  });

  test("--help exits 0", async () => {
    const r = await runCli(["--help"]);
    expect(r.code).toBe(0);
  });

  test("report start without --title fails", async () => {
    const r = await runCli(["report", "start"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--title");
  });

  test("hook subcommands ALWAYS exit 0, even with garbage stdin", async () => {
    for (const sub of ["session-start", "stop", "session-end"]) {
      const r = await runCli(["hook", sub], "}{ not json");
      expect(r.code).toBe(0);
    }
  });

  test("unknown command exits non-zero with usage", async () => {
    const r = await runCli(["frobnicate"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("report start");
  });

  test("config show runs and reports unset fields", async () => {
    const r = await runCli(["config", "show"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("server:");
  });
});
