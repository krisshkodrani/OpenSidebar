import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { killTree, clearPort, spawnWithExited, IS_WINDOWS } from "./process-utils.ts";

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

  // Clear port 5173 before spawning Vite
  await clearPort(5173);

  // Spawn Node directly (no cmd.exe shell) to avoid Windows "Terminate batch job?" prompt
  const child = IS_WINDOWS
    ? spawnWithExited(process.execPath, [
        path.resolve("node_modules/vite/bin/vite.js"),
        ...args,
      ], { stdio: "inherit" })
    : spawnWithExited("npx", ["vite", ...args], {
        stdio: "inherit",
        shell: true,
      });

  // Use killTree for proper Windows process tree killing
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    killTree(child);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const exitCode = await child.exited;

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
