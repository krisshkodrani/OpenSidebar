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
import { killTree, clearPort, spawnWithExited } from "./process-utils.ts";

const LOG_SERVER_PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
const VITE_PORT = 5173;
const LOG_SERVER_HEALTH_URL = `http://127.0.0.1:${LOG_SERVER_PORT}/health`;

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

async function isLogServerAlreadyRunning(): Promise<boolean> {
  try {
    const response = await fetch(LOG_SERVER_HEALTH_URL, {
      signal: AbortSignal.timeout(600),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForLogServer(maxMs = 5000, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(LOG_SERVER_HEALTH_URL, {
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
  // 1. Clear stale processes on both ports
  console.log("[dev:stack] Clearing stale processes on ports...");
  await Promise.all([clearPort(VITE_PORT), clearPort(LOG_SERVER_PORT)]);

  // 2. Clean Vite artifacts (inline, no subprocess)
  const cleaned = await cleanViteArtifacts(process.cwd());
  if (cleaned > 0) {
    console.log(`[dev:stack] Removed ${cleaned} stale Vite artifact(s)`);
  }

  // 3. Start log server (if not already running)
  let logs: ReturnType<typeof spawnWithExited> | null = null;
  if (await isLogServerAlreadyRunning()) {
    console.log(
      `[dev:stack] Reusing existing log drain server on port ${LOG_SERVER_PORT}.`,
    );
  } else {
    console.log("[dev:stack] Starting log drain server...");
    logs = spawnWithExited("npx", ["tsx", "scripts/log-server.ts"], {
      stdio: "inherit",
      shell: true,
    });
    if (await waitForLogServer()) {
      console.log("[dev:stack] Log server healthy.");
    } else {
      console.warn(
        "[dev:stack] Log server did not respond within 5s — continuing anyway.",
      );
    }
  }

  // 4. Start Vite DIRECTLY — no vite-clean wrapper
  console.log("[dev:stack] Starting Vite dev server...");
  const dev = spawnWithExited("npx", ["vite"], {
    stdio: "inherit",
    shell: true,
  });

  console.log(`[dev:stack] Trace viewer: http://127.0.0.1:${LOG_SERVER_PORT}/viewer`);

  // 5. Shutdown: killTree both
  let intentionalShutdown = false;
  const shutdown = (signal: string) => {
    if (intentionalShutdown) return;
    intentionalShutdown = true;
    console.log(`\n[dev:stack] Received ${signal}. Stopping child processes...`);
    killTree(dev);
    if (logs) killTree(logs);
    // Force exit after 2s — on Windows, force-killed cmd.exe shells
    // don't always emit 'close', so the exited promises can hang forever.
    setTimeout(() => {
      console.log("[dev:stack] Force exit (child processes did not close in time).");
      process.exit(0);
    }, 2000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const [logsCode, devCode] = await Promise.all([
    logs ? logs.exited : Promise.resolve(0),
    dev.exited,
  ]);

  // Non-zero exit codes are expected when we force-killed the processes
  if (!intentionalShutdown && logsCode !== 0) {
    console.warn(
      `[dev:stack] Log drain server exited with code ${logsCode}. Continuing without log drain.`,
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
