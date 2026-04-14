/**
 * Dev stack runner:
 * 1) Clear stale processes on dev ports
 * 2) Clean Vite artifacts
 * 3) Start log drain server (captures logs/traces)
 * 4) Start Vite dev server DIRECTLY (no vite-clean intermediary)
 *
 * Stops both long-running processes on Ctrl+C.
 */

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { killTree, clearPort, spawnWithExited, IS_WINDOWS } from "./process-utils.ts";

const LOG_SERVER_PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 7590;
const VITE_PORT = 5173;
const LOG_SERVER_HEALTH_URL = `http://127.0.0.1:${LOG_SERVER_PORT}/health`;
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;

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

async function waitForServer(url: string, maxMs = 5000, intervalMs = 200): Promise<boolean> {
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
  // 1. Clear stale processes on all ports
  console.log("[dev:stack] Clearing stale processes on ports...");
  await Promise.all([clearPort(VITE_PORT), clearPort(LOG_SERVER_PORT), clearPort(BACKEND_PORT)]);

  // 2. Clean Vite artifacts (inline, no subprocess)
  const cleaned = await cleanViteArtifacts(process.cwd());
  if (cleaned > 0) {
    console.log(`[dev:stack] Removed ${cleaned} stale Vite artifact(s)`);
  }

  // 3. Start log server (if not already running)
  let logs: ReturnType<typeof spawnWithExited> | null = null;
  if (await isServerAlreadyRunning(LOG_SERVER_HEALTH_URL)) {
    console.log(
      `[dev:stack] Reusing existing log drain server on port ${LOG_SERVER_PORT}.`,
    );
  } else {
    console.log("[dev:stack] Starting log drain server...");
    // Spawn Node directly (no cmd.exe shell) to avoid Windows "Terminate batch job?" prompt
    logs = IS_WINDOWS
      ? spawnWithExited(process.execPath, [
          path.resolve("node_modules/tsx/dist/cli.mjs"),
          "scripts/log-server.ts",
        ], { stdio: "inherit" })
      : spawnWithExited("npx", ["tsx", "scripts/log-server.ts"], {
          stdio: "inherit",
          shell: true,
        });
    if (await waitForServer(LOG_SERVER_HEALTH_URL)) {
      console.log("[dev:stack] Log server healthy.");
    } else {
      console.warn(
        "[dev:stack] Log server did not respond within 5s — continuing anyway.",
      );
    }
  }

  // 3b. Start backend agent service (if not already running)
  let backend: ReturnType<typeof spawnWithExited> | null = null;
  if (await isServerAlreadyRunning(BACKEND_HEALTH_URL)) {
    console.log(
      `[dev:stack] Reusing existing backend service on port ${BACKEND_PORT}.`,
    );
  } else {
    console.log("[dev:stack] Starting backend agent service...");
    backend = IS_WINDOWS
      ? spawnWithExited(process.execPath, [
          path.resolve("node_modules/tsx/dist/cli.mjs"),
          "backend/server.ts",
        ], { stdio: "inherit" })
      : spawnWithExited("npx", ["tsx", "backend/server.ts"], {
          stdio: "inherit",
          shell: true,
        });
    if (await waitForServer(BACKEND_HEALTH_URL, 8000)) {
      console.log("[dev:stack] Backend service healthy.");
    } else {
      console.warn(
        "[dev:stack] Backend service did not respond within 8s — continuing anyway.",
      );
    }
  }

  // 4. Start Vite DIRECTLY — no vite-clean wrapper
  console.log("[dev:stack] Starting Vite dev server...");
  // Spawn Node directly (no cmd.exe shell) to avoid Windows "Terminate batch job?" prompt
  const dev = IS_WINDOWS
    ? spawnWithExited(process.execPath, [
        path.resolve("node_modules/vite/bin/vite.js"),
      ], { stdio: "inherit" })
    : spawnWithExited("npx", ["vite"], {
        stdio: "inherit",
        shell: true,
      });

  console.log(`[dev:stack] Trace viewer: http://127.0.0.1:${LOG_SERVER_PORT}/viewer`);
  console.log(`[dev:stack] Backend service: http://127.0.0.1:${BACKEND_PORT}/health`);

  // 5. Shutdown: killTree all
  let intentionalShutdown = false;
  const shutdown = (signal: string) => {
    if (intentionalShutdown) return;
    intentionalShutdown = true;
    console.log(`\n[dev:stack] Received ${signal}. Stopping child processes...`);
    killTree(dev);
    if (logs) killTree(logs);
    if (backend) killTree(backend);
    // Force exit after 2s — on Windows, force-killed cmd.exe shells
    // don't always emit 'close', so the exited promises can hang forever.
    setTimeout(() => {
      console.log("[dev:stack] Force exit (child processes did not close in time).");
      process.exit(0);
    }, 2000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const [logsCode, backendCode, devCode] = await Promise.all([
    logs ? logs.exited : Promise.resolve(0),
    backend ? backend.exited : Promise.resolve(0),
    dev.exited,
  ]);

  // Non-zero exit codes are expected when we force-killed the processes
  if (!intentionalShutdown && logsCode !== 0) {
    console.warn(
      `[dev:stack] Log drain server exited with code ${logsCode}. Continuing without log drain.`,
    );
  }
  if (!intentionalShutdown && backendCode !== 0) {
    console.warn(
      `[dev:stack] Backend service exited with code ${backendCode}. Continuing without backend.`,
    );
  }

  // Clean up Vite artifacts on exit
  await cleanViteArtifacts(process.cwd());

  process.exit(intentionalShutdown ? 0 : devCode);
}

main().catch((error) => {
  console.error("[dev:stack] Unexpected failure", error);
  process.exit(1);
});
