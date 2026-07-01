/**
 * Append-only logger. Never throws — logging must not interfere with the
 * developer's session or a hook's exit-0 guarantee.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { configDir, logPath } from "./config.ts";

export async function logLine(level: "info" | "warn" | "error", message: string): Promise<void> {
  try {
    await mkdir(configDir(), { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString();
    await appendFile(logPath(), `${stamp} ${level.toUpperCase()} ${message}\n`);
  } catch {
    // Swallow — logging failures are never fatal.
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
