/**
 * Dev stack runner:
 * 1) Clear stale processes on dev ports
 * 2) Clean Vite artifacts
 * 3) Start local server (captures logs/traces)
 * 4) Start Vite dev server directly
 *
 * Stops long-running processes on Ctrl+C.
 */

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  killTree,
  clearPort,
  spawnWithExited,
  IS_WINDOWS,
} from "./process-utils.ts";

const LOCAL_SERVER_PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
const VITE_PORT = 5173;
const LOCAL_SERVER_HEALTH_URL = `http://127.0.0.1:${LOCAL_SERVER_PORT}/health`;

// Default: a `vite build --mode e2e --watch` that keeps a COMPLETE dist-dev on
// disk (extension + overlay-harness + trace-viewer), so the log-server's
// /viewer route works from the first run and tracks edits. Opt into `--hmr` for
// the legacy CRXJS dev server (fast sidepanel HMR, but the trace viewer is not
// written to disk and stays stale until the next `build:e2e`).
const USE_HMR = process.argv.includes("--hmr");

const VITE_CONFIG_ARTIFACT = /^vite\.config\.ts\.timestamp-.*\.mjs$/;

/** Remove stale vite.config.ts.timestamp-*.mjs files */
async function cleanViteArtifacts(cwd: string): Promise<number> {
  try {
    const entries = await readdir(cwd, { withFileTypes: true });
    const artifacts = entries
      .filter((e) => e.isFile() && VITE_CONFIG_ARTIFACT.test(e.name))
      .map((e) => e.name);
    await Promise.all(
      artifacts.map((name) => rm(path.join(cwd, name), { force: true })),
    );
    return artifacts.length;
  } catch {
    return 0;
  }
}

async function isServerAlreadyRunning(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(600),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(
  url: string,
  maxMs = 5000,
  intervalMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(600),
      });
      if (response.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function main(): Promise<void> {
  console.log("[dev:stack] Clearing stale processes on ports...");
  await Promise.all([
    clearPort(VITE_PORT),
    clearPort(LOCAL_SERVER_PORT),
  ]);

  const cleaned = await cleanViteArtifacts(process.cwd());
  if (cleaned > 0) {
    console.log(`[dev:stack] Removed ${cleaned} stale Vite artifact(s)`);
  }

  let localServer: ReturnType<typeof spawnWithExited> | null = null;
  if (await isServerAlreadyRunning(LOCAL_SERVER_HEALTH_URL)) {
    console.log(
      `[dev:stack] Reusing existing local server on port ${LOCAL_SERVER_PORT}.`,
    );
  } else {
    console.log("[dev:stack] Starting local server...");
    localServer = IS_WINDOWS
      ? spawnWithExited(
          process.execPath,
          [
            path.resolve("node_modules/tsx/dist/cli.mjs"),
            "scripts/log-server.ts",
          ],
          { stdio: "inherit" },
        )
      : spawnWithExited(
          process.execPath,
          [
            path.resolve("node_modules/tsx/dist/cli.mjs"),
            "scripts/log-server.ts",
          ],
          { stdio: "inherit" },
        );
    if (await waitForServer(LOCAL_SERVER_HEALTH_URL)) {
      console.log("[dev:stack] Local server healthy.");
    } else {
      console.warn(
        "[dev:stack] Local server did not respond within 5s - continuing anyway.",
      );
    }
  }

  // Spawn Node directly (not through cmd.exe) so Windows doesn't prompt
  // "Terminate batch job?" on Ctrl+C; killTree handles the process tree.
  const viteArgs = USE_HMR
    ? [path.resolve("node_modules/vite/bin/vite.js")]
    : [
        path.resolve("node_modules/vite/bin/vite.js"),
        "build",
        "--mode",
        "e2e",
        "--watch",
      ];
  console.log(
    USE_HMR
      ? "[dev:stack] Starting Vite dev server (HMR; trace viewer not rebuilt — run `pnpm run build:e2e` for it)..."
      : "[dev:stack] Starting Vite watch build (e2e)... initial build takes a few seconds before /viewer is live.",
  );
  const dev = spawnWithExited(process.execPath, viteArgs, { stdio: "inherit" });

  console.log(
    `[dev:stack] Trace viewer: http://127.0.0.1:${LOCAL_SERVER_PORT}/viewer`,
  );
  console.log(
    "[dev:stack] Extension: load dist-dev/ as unpacked in chrome://extensions" +
      " (dist/ is the production build — run `pnpm run dist` for that)",
  );

  let intentionalShutdown = false;
  const shutdown = (signal: string) => {
    if (intentionalShutdown) return;
    intentionalShutdown = true;
    console.log(`\n[dev:stack] Received ${signal}. Stopping child processes...`);
    killTree(dev);
    if (localServer) killTree(localServer);
    setTimeout(() => {
      console.log("[dev:stack] Force exit (child processes did not close in time).");
      process.exit(0);
    }, 2000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const [localServerCode, devCode] = await Promise.all([
    localServer ? localServer.exited : Promise.resolve(0),
    dev.exited,
  ]);

  if (!intentionalShutdown && localServerCode !== 0) {
    console.warn(
      `[dev:stack] Local server exited with code ${localServerCode}. Continuing without local server.`,
    );
  }

  await cleanViteArtifacts(process.cwd());

  process.exit(intentionalShutdown ? 0 : devCode);
}

main().catch((error) => {
  console.error("[dev:stack] Unexpected failure", error);
  process.exit(1);
});
