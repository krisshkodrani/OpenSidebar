import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const VITE_CONFIG_ARTIFACT = /^vite\.config\.ts\.timestamp-.*\.mjs$/;

async function cleanupArtifacts(cwd: string): Promise<number> {
  const entries = await readdir(cwd, { withFileTypes: true });
  const artifactNames = entries
    .filter((entry) => entry.isFile() && VITE_CONFIG_ARTIFACT.test(entry.name))
    .map((entry) => entry.name);

  await Promise.all(
    artifactNames.map((name) =>
      rm(path.join(cwd, name), {
        force: true,
      }),
    ),
  );

  return artifactNames.length;
}

async function run(): Promise<void> {
  const cwd = process.cwd();
  const args = process.argv.slice(2);

  const beforeCount = await cleanupArtifacts(cwd);
  if (beforeCount > 0) {
    console.log(`[vite-clean] Removed ${beforeCount} stale Vite artifact(s)`);
  }

  if (args.includes("--clean-only")) {
    return;
  }

  const child = spawn(process.execPath, ["run", "--bun", "vite", ...args], {
    cwd,
    stdio: "inherit",
  });

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 0);
    });
  });

  const afterCount = await cleanupArtifacts(cwd);
  if (afterCount > 0) {
    console.log(`[vite-clean] Removed ${afterCount} Vite artifact(s)`);
  }

  process.exit(exitCode);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[vite-clean] Failed: ${message}`);
  process.exit(1);
});
