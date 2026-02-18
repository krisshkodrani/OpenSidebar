/**
 * Dev stack runner:
 * 1) Build extension once
 * 2) Start log drain server (captures logs/traces)
 * 3) Start Vite dev server
 *
 * Stops both long-running processes on Ctrl+C.
 */

const BUN = process.execPath;
const LOG_SERVER_PORT = Number(process.env.LOG_SERVER_PORT) || 7589;
const LOG_SERVER_HEALTH_URL = `http://127.0.0.1:${LOG_SERVER_PORT}/health`;

function spawnBun(args: string[]) {
  return Bun.spawn([BUN, "run", ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
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

async function main(): Promise<void> {
  console.log("[dev:stack] Building extension...");
  const build = spawnBun(["build"]);
  const buildCode = await build.exited;
  if (buildCode !== 0) {
    console.error(`[dev:stack] Build failed with exit code ${buildCode}`);
    process.exit(buildCode);
  }

  let logs: ReturnType<typeof spawnBun> | null = null;
  if (await isLogServerAlreadyRunning()) {
    console.log(
      `[dev:stack] Reusing existing log drain server on port ${LOG_SERVER_PORT}.`,
    );
  } else {
    console.log("[dev:stack] Starting log drain server...");
    logs = spawnBun(["logs"]);
  }

  console.log("[dev:stack] Starting Vite dev server...");
  const dev = spawnBun(["dev"]);

  const shutdown = (signal: string) => {
    console.log(`[dev:stack] Received ${signal}. Stopping child processes...`);
    logs?.kill();
    dev.kill();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const [logsCode, devCode] = await Promise.all([
    logs ? logs.exited : Promise.resolve(0),
    dev.exited,
  ]);
  if (logsCode !== 0) {
    console.warn(
      `[dev:stack] Log drain server exited with code ${logsCode}. Continuing without log drain.`,
    );
  }
  process.exit(devCode);
}

main().catch((error) => {
  console.error("[dev:stack] Unexpected failure", error);
  process.exit(1);
});
