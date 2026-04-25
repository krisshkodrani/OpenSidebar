#!/usr/bin/env tsx

import { spawnSync } from "child_process";
import { resolve } from "path";
import {
  type ReadinessStatus,
  type WorkArenaHeldSessionBridgeDescription,
  type WorkArenaHeldSessionReport,
  PROJECT_ROOT,
  readinessLabel,
  resolvePythonExecutable,
  runWorkArenaDoctor,
  safeFilePart,
  today,
  withReadiness,
  writeJsonReport,
} from "./workarena-adapter-lib.js";
import { validateWorkArenaReport } from "./workarena-report-schema.js";

const SESSION_BRIDGE_PATH = resolve(PROJECT_ROOT, "scripts", "workarena-session-bridge.py");

type BridgeOutput = {
  lines: Array<Record<string, unknown>>;
};

function parseArgs(): {
  taskId: string | null;
  seed: number;
  json: boolean;
  noReport: boolean;
  allowServiceNowReset: boolean;
  showBrowser: boolean;
} {
  const args = process.argv.slice(2);
  const taskArg = args[args.indexOf("--task") + 1];
  const seedArg = Number.parseInt(args[args.indexOf("--seed") + 1] ?? "", 10);
  return {
    taskId: taskArg && !taskArg.startsWith("--") ? taskArg : null,
    seed: Number.isFinite(seedArg) ? seedArg : 42,
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
    allowServiceNowReset:
      args.includes("--allow-servicenow-reset") || args.includes("--reset"),
    showBrowser: args.includes("--show-browser"),
  };
}

function runSessionBridge(inputLines: Record<string, unknown>[]): BridgeOutput {
  const input =
    inputLines.length > 0
      ? `${inputLines.map((line) => JSON.stringify(line)).join("\n")}\n`
      : "";
  const result = spawnSync(resolvePythonExecutable(), [SESSION_BRIDGE_PATH], {
    cwd: PROJECT_ROOT,
    env: process.env,
    input,
    encoding: "utf-8",
    timeout: 300_000,
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `python exited with ${result.status}`).trim(),
    );
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { lines };
}

function bridgeDescription(output: BridgeOutput): WorkArenaHeldSessionBridgeDescription {
  const first = output.lines[0];
  if (!first || first.mode !== "held-session-bridge") {
    throw new Error("held-session bridge did not return a description");
  }
  return first as WorkArenaHeldSessionBridgeDescription;
}

function buildReport(args: ReturnType<typeof parseArgs>): WorkArenaHeldSessionReport {
  if (!args.taskId) throw new Error("--task is required");

  const doctor = withReadiness(runWorkArenaDoctor(false));
  const canAttemptReset = args.allowServiceNowReset && doctor.ready;
  const plannedSequence = canAttemptReset
    ? [
        { command: "reset", taskId: args.taskId, seed: args.seed, allowServiceNowReset: true, showBrowser: args.showBrowser },
        { command: "export_session" },
        { command: "validate" },
        { command: "teardown" },
      ]
    : [];
  const bridgeOutput = runSessionBridge(plannedSequence);
  const bridge = bridgeDescription(bridgeOutput);
  const resetResult =
    bridgeOutput.lines.find((line) => line.status === "reset_succeeded") ?? null;
  const resetFailed =
    bridgeOutput.lines.find(
      (line) =>
        typeof line.status === "string" &&
        line.status !== "reset_succeeded" &&
        line.status !== "session_exported" &&
        line.status !== "validated" &&
        line.status !== "teardown_succeeded" &&
        line.status !== "teardown_noop",
    ) ?? null;

  const status = !args.allowServiceNowReset
    ? "protocol_ready"
    : !doctor.ready
      ? "blocked_setup"
      : resetResult
        ? "reset_succeeded"
        : resetFailed
          ? "reset_failed"
          : "blocked_requires_reset_flag";
  const canImport = status === "reset_succeeded";

  return {
    benchmark: "workarena",
    mode: "held-session",
    ready: bridge.ready && (status === "protocol_ready" || status === "reset_succeeded"),
    status,
    task: {
      taskId: args.taskId,
      seed: args.seed,
    },
    bridge,
    protocol: {
      transport: "jsonl-stdio",
      script: SESSION_BRIDGE_PATH,
      plannedSequence: ["describe", "reset", "export_session", "validate", "teardown"],
    },
    reset: {
      attempted: canAttemptReset,
      allowServiceNowReset: args.allowServiceNowReset,
      result: resetResult ?? resetFailed,
    },
    next: {
      canImportSessionIntoExtensionBrowser: canImport,
      reason: canImport
        ? "The bridge exported a held BrowserGym session for import into the extension browser."
        : nextReason(args.allowServiceNowReset, doctor.ready, doctor.readiness ?? "blocked"),
    },
    safety: [
      "Default held-session runs only start the bridge and read its protocol description.",
      "A real BrowserGym reset requires --allow-servicenow-reset and strict doctor readiness.",
      "When reset succeeds, the bridge sequence exports session state, validates, and tears down before process exit in this CLI.",
      "The future agent runner will keep the same bridge process alive while OpenSidebar acts.",
    ],
  };
}

function nextReason(
  allowServiceNowReset: boolean,
  doctorReady: boolean,
  readiness: ReadinessStatus,
): string {
  if (!allowServiceNowReset) {
    return "Protocol is ready. Pass --allow-servicenow-reset after gated access is approved to exercise the reset/export path.";
  }
  if (!doctorReady) {
    return `Setup is not fully ready: ${readinessLabel(readiness)}.`;
  }
  return "Reset/export did not succeed; inspect reset.result.";
}

function writeReport(result: WorkArenaHeldSessionReport): string {
  return writeJsonReport(
    result,
    `workarena-held-session-${today()}-${safeFilePart(result.task.taskId)}.json`,
  );
}

function printHuman(result: WorkArenaHeldSessionReport): void {
  console.log("\n[workarena:held] WorkArena held-session bridge");
  console.log(`[workarena:held] Ready: ${result.ready ? "yes" : "no"}`);
  console.log(`[workarena:held] Status: ${result.status}`);
  console.log(`[workarena:held] Task: ${result.task.taskId}`);
  console.log(`[workarena:held] Seed: ${result.task.seed}`);
  console.log(`[workarena:held] Bridge: ${result.protocol.script}`);
  if (result.reportPath) {
    console.log(`[workarena:held] Report: ${result.reportPath}`);
  }
  console.log("");
  console.log(`[workarena:held] Commands: ${result.bridge.commands.map((item) => item.command).join(", ")}`);
  console.log(`[workarena:held] Reset attempted: ${result.reset.attempted ? "yes" : "no"}`);
  console.log(`[workarena:held] Next: ${result.next.reason}`);
}

function main(): void {
  const args = parseArgs();
  const result = buildReport(args);
  const errors = validateWorkArenaReport(result);
  if (errors.length > 0) {
    throw new Error(
      `generated held-session report failed schema validation: ${errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; ")}`,
    );
  }

  if (!args.noReport) {
    result.reportPath = writeReport(result);
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  if (result.status === "blocked_setup" || result.status === "reset_failed") {
    process.exitCode = 1;
  }
}

main();
