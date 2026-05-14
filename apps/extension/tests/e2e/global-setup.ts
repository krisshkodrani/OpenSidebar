/**
 * Vitest globalSetup for E2E tests.
 *
 * Starts the log server before all test files run and stops it after.
 * This avoids each suite starting/stopping its own log server instance.
 */

import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../../..");
const LOG_SERVER_SCRIPT = resolve(PROJECT_ROOT, "scripts", "log-server.ts");
const TSX_CLI = resolve(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const LOG_SERVER_PORT = 7589;

let logServerProcess: ChildProcess | null = null;

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${LOG_SERVER_PORT}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export async function setup(): Promise<void> {
  if (await isServerRunning()) {
    console.log(
      "[global-setup] Log server already running on port",
      LOG_SERVER_PORT,
    );
    return;
  }

  logServerProcess = spawn(process.execPath, [TSX_CLI, LOG_SERVER_SCRIPT], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  const started = await waitForServer(LOG_SERVER_PORT, 10_000);
  if (!started) {
    logServerProcess.kill();
    logServerProcess = null;
    throw new Error("[global-setup] Log server failed to start within 10s");
  }
  console.log("[global-setup] Log server started on port", LOG_SERVER_PORT);
}

export async function teardown(): Promise<void> {
  if (!logServerProcess) return;
  const proc = logServerProcess;
  logServerProcess = null;

  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.once("close", () => resolve());
  });

  proc.kill("SIGTERM");

  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 3_000);
    }),
  ]);
  console.log("[global-setup] Log server stopped");
}
