/**
 * Shared process management utilities for dev scripts.
 * Handles cross-platform process tree killing and port cleanup.
 */

import { spawnSync, spawn, type ChildProcess, type StdioOptions } from "child_process";

export const IS_WINDOWS = process.platform === "win32";

/** Kill a process and its entire tree. On Windows, taskkill /T /F kills children. */
export function killTree(proc: { pid?: number | undefined; kill: () => void }): void {
  if (IS_WINDOWS && proc.pid) {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], {
      stdio: "ignore",
    });
  } else {
    proc.kill();
  }
}

/** Find and kill all processes listening on a port. No-op if port is free. */
export async function clearPort(port: number): Promise<void> {
  try {
    if (IS_WINDOWS) {
      // Use PowerShell to find PIDs on the port
      const result = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique`,
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      const output = result.stdout?.toString().trim() ?? "";
      if (!output) return;

      const pids = output
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== "0")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);

      for (const pid of pids) {
        spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
          stdio: "ignore",
        });
      }
    } else {
      // Unix: lsof to find PIDs
      const result = spawnSync("lsof", [`-ti:${port}`], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const output = result.stdout?.toString().trim() ?? "";
      if (!output) return;

      const pids = output
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);

      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already dead
        }
      }
    }
  } catch {
    // Port already free or insufficient permissions — both are fine
  }
}

export interface SpawnedProcess {
  pid: number | undefined;
  kill: () => void;
  exited: Promise<number>;
}

/**
 * Spawn a child process with a `.exited` promise (like Bun.spawn).
 * Returns an object with `pid`, `kill()`, and `exited: Promise<number>`.
 */
export function spawnWithExited(
  cmd: string,
  args: string[],
  opts?: { stdio?: StdioOptions; shell?: boolean; cwd?: string },
): SpawnedProcess {
  const child: ChildProcess = spawn(cmd, args, {
    stdio: opts?.stdio ?? "inherit",
    shell: opts?.shell ?? false,
    cwd: opts?.cwd,
  });

  const exited = new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

  return {
    pid: child.pid,
    kill: () => {
      try { child.kill(); } catch { /* already dead */ }
    },
    exited,
  };
}
