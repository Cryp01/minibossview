/**
 * Downloads the pinned PocketBase binary into ./pb for the current platform.
 * Idempotent: skips download if the binary already matches the pinned version.
 *
 *   bun run scripts/fetch-pocketbase.ts
 */
import { existsSync } from "node:fs";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const PB_VERSION = "0.39.5";
const PB_DIR = join(import.meta.dir, "..", "pb");
const BIN_PATH = join(PB_DIR, "pocketbase");

function platformSlug(): string {
  const os = process.platform; // 'darwin' | 'linux' | 'win32'
  const arch = process.arch; // 'arm64' | 'x64'
  const goarch = arch === "arm64" ? "arm64" : "amd64";
  const goos = os === "darwin" ? "darwin" : os === "win32" ? "windows" : "linux";
  return `${goos}_${goarch}`;
}

async function currentVersion(): Promise<string | null> {
  if (!existsSync(BIN_PATH)) return null;
  try {
    const proc = Bun.spawn([BIN_PATH, "--version"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const match = out.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if ((await currentVersion()) === PB_VERSION) {
    console.log(`✓ PocketBase ${PB_VERSION} already present at ${BIN_PATH}`);
    return;
  }
  const slug = platformSlug();
  const zipName = `pocketbase_${PB_VERSION}_${slug}.zip`;
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${zipName}`;
  console.log(`Downloading ${url} ...`);

  await mkdir(PB_DIR, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const zipPath = join(PB_DIR, zipName);
  await Bun.write(zipPath, await res.arrayBuffer());

  // Use system unzip (available on macOS/Linux) to extract just the binary.
  const unzip = Bun.spawn(["unzip", "-o", zipPath, "pocketbase", "-d", PB_DIR], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await unzip.exited;
  await rm(zipPath, { force: true });
  if (code !== 0) throw new Error("unzip failed");

  await chmod(BIN_PATH, 0o755);
  console.log(`✓ PocketBase ${PB_VERSION} installed at ${BIN_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
