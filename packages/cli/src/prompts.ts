/**
 * Minimal terminal prompts shared by interactive CLI commands. Secret input is
 * masked by delegating to the shell (`stty -echo`) rather than manual raw-mode
 * reading, which can conflict with prompt() and hang.
 */
export function ask(question: string, fallback = ""): string {
  const answer = prompt(question);
  return (answer ?? "").trim() || fallback;
}

export async function readSecret(question: string): Promise<string> {
  if (process.platform !== "win32" && process.stdin.isTTY) {
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
      // fall through to visible input
    }
  }
  return ask(`${question} (visible)`);
}
