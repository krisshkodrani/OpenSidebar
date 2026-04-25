import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

export type CheckStatus = "ok" | "missing" | "blocked" | "pending";
export type ReadinessStatus = "ready" | "local_ready_hf_pending" | "blocked";
export type WorkArenaSuite = "all" | "atomic" | "l1" | "l2" | "l3";

export type DoctorCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
};

export type DoctorResult = {
  benchmark: "workarena";
  ready: boolean;
  readiness?: ReadinessStatus;
  dataset: string;
  pythonExecutable: string;
  platform: string;
  checks: DoctorCheck[];
  reportPath?: string;
};

export type TaskInfo = {
  id: string;
  category: string | null;
  kind: "atomic" | "compositional";
  level: string | null;
  seed: number | null;
  className: string;
};

export type ListResult = {
  benchmark: "workarena";
  suite: WorkArenaSuite;
  count: number;
  categories: Array<{ category: string; count: number }>;
  tasks: TaskInfo[];
};

export type DryResult = {
  benchmark: "workarena";
  mode: "dry";
  taskId: string;
  envId: string;
  seed: number;
  category: string | null;
  kind: "atomic" | "compositional";
  level: string | null;
  className: string;
  resetAttempted: boolean;
  resetSucceeded: boolean;
  teardownSucceeded: boolean | null;
  durationMs: number;
  goal: string | null;
  goalObject: Array<Record<string, unknown>>;
  startUrl: string | null;
  activeUrl: string | null;
  openPages: string[];
  openPageTitles: string[];
  taskInfo: Record<string, unknown>;
  error: string | null;
  notes: string[];
  reportPath?: string;
};

export type WorkArenaAdapterPhaseStatus = "ready" | "pending" | "blocked";

export type WorkArenaAdapterPhase = {
  name: string;
  status: WorkArenaAdapterPhaseStatus;
  detail: string;
};

export type WorkArenaBrowserAttachStrategy =
  | "extension-loaded-browser-context"
  | "separate-extension-browser-with-transferred-session";

export type WorkArenaAdapterPlan = {
  benchmark: "workarena";
  mode: "adapter-plan";
  ready: boolean;
  readiness: ReadinessStatus;
  task: {
    taskId: string;
    envId: string;
    seed: number;
    category: string | null;
    kind: "atomic" | "compositional";
    level: string | null;
    className: string;
  };
  prompt: {
    available: boolean;
    source: "workarena_goal_after_reset";
    value: string | null;
    note: string;
  };
  browser: {
    source: "browsergym";
    resetRequired: boolean;
    attachStrategy: WorkArenaBrowserAttachStrategy;
    startUrl: string | null;
    activeUrl: string | null;
  };
  runner: {
    phases: WorkArenaAdapterPhase[];
  };
  safety: string[];
  reports: {
    adapterPlanPath?: string;
  };
};

export type WorkArenaResetRunStatus =
  | "blocked_requires_reset_flag"
  | "blocked_setup"
  | "reset_succeeded"
  | "reset_failed";

export type WorkArenaResetRun = {
  benchmark: "workarena";
  mode: "guarded-reset";
  ready: boolean;
  status: WorkArenaResetRunStatus;
  readiness: ReadinessStatus;
  task: {
    taskId: string;
    seed: number;
  };
  doctor: {
    ready: boolean;
    readiness: ReadinessStatus;
    pythonExecutable: string;
    dataset: string;
    checks: DoctorCheck[];
  };
  reset: DryResult | null;
  next: {
    canExecuteAgent: boolean;
    reason: string;
  };
  safety: string[];
  reportPath?: string;
};

export type WorkArenaExecutionFailureStage =
  | "setup"
  | "reset"
  | "extension_launch"
  | "agent_run"
  | "validation"
  | "teardown";

export type WorkArenaExecutionStatus =
  | "pending"
  | "passed"
  | "failed"
  | "error";

export type WorkArenaExecutionResult = {
  benchmark: "workarena";
  mode: "agent-execution";
  ready: boolean;
  status: WorkArenaExecutionStatus;
  failureStage: WorkArenaExecutionFailureStage | null;
  task: {
    taskId: string;
    envId: string;
    seed: number;
    category: string | null;
    kind: "atomic" | "compositional";
    level: string | null;
    className: string;
  };
  prompt: {
    source: "workarena_goal_after_reset" | "local_fixture_prompt";
    value: string;
    goalObject: Array<Record<string, unknown>>;
  };
  browser: {
    startUrl: string | null;
    activeUrl: string | null;
    openPages: string[];
    openPageTitles: string[];
  };
  agent: {
    provider: string;
    executorModel: string | null;
    plannerModel: string | null;
    traceIds: string[];
    traceFiles: string[];
    finalAnswer: string | null;
    turns: number | null;
    perceptions: number | null;
    toolCalls: number | null;
    toolExecutions: number | null;
    tokens: {
      input: number | null;
      output: number | null;
      total: number | null;
    };
    costUsd: number | null;
  };
  validation: {
    passed: boolean | null;
    score: number | null;
    message: string | null;
    details: Record<string, unknown>;
  };
  timings: {
    resetMs: number | null;
    agentMs: number | null;
    validationMs: number | null;
    totalMs: number | null;
  };
  errors: Array<{
    stage: WorkArenaExecutionFailureStage;
    message: string;
  }>;
  reports: {
    executionReportPath?: string;
  };
};

export type WorkArenaBrowserStrategyProbe = {
  benchmark: "workarena";
  mode: "browser-strategy-probe";
  browsergym: {
    envFile: string;
    browserEnvInitSignature: string;
    usesChromiumLaunch: boolean;
    usesNewContext: boolean;
    usesLaunchPersistentContext: boolean;
    supportsPwChromiumKwargs: boolean;
    supportsPwContextKwargs: boolean;
  };
  notes: string[];
};

export type WorkArenaBrowserStrategyReport = {
  benchmark: "workarena";
  mode: "browser-strategy";
  ready: boolean;
  recommendedStrategy: WorkArenaBrowserAttachStrategy;
  facts: {
    browsergym: WorkArenaBrowserStrategyProbe["browsergym"];
    opensidebar: {
      harnessFile: string;
      usesPuppeteer: boolean;
      usesLoadExtensionFlag: boolean;
      usesDisableExtensionsExceptFlag: boolean;
      usesPipeTransport: boolean;
      distPath: string;
      distExists: boolean;
    };
  };
  candidates: Array<{
    id: WorkArenaBrowserAttachStrategy;
    verdict: "recommended" | "not_recommended";
    rationale: string;
    evidence: string[];
    risks: string[];
    nextSteps: string[];
  }>;
  decision: {
    summary: string;
    implementationPlan: string[];
  };
  safety: string[];
  reportPath?: string;
};

export type WorkArenaHeldSessionCommand =
  | "describe"
  | "reset"
  | "export_session"
  | "validate"
  | "teardown";

export type WorkArenaHeldSessionBridgeDescription = {
  benchmark: "workarena";
  mode: "held-session-bridge";
  ready: boolean;
  protocolVersion: string;
  dataset: string;
  commands: Array<{
    command: WorkArenaHeldSessionCommand;
    mutatesServiceNow: boolean;
    requiresReset: boolean;
    requiresAllowServiceNowReset?: boolean;
  }>;
  state: {
    active: boolean;
    taskId: string | null;
    envId: string | null;
    seed: number | null;
    createdAtMs: number | null;
  };
  safety: string[];
};

export type WorkArenaHeldSessionReport = {
  benchmark: "workarena";
  mode: "held-session";
  ready: boolean;
  status:
    | "protocol_ready"
    | "blocked_requires_reset_flag"
    | "blocked_setup"
    | "reset_succeeded"
    | "reset_failed";
  task: {
    taskId: string;
    seed: number;
  };
  bridge: WorkArenaHeldSessionBridgeDescription;
  protocol: {
    transport: "jsonl-stdio";
    script: string;
    plannedSequence: WorkArenaHeldSessionCommand[];
  };
  reset: {
    attempted: boolean;
    allowServiceNowReset: boolean;
    result: Record<string, unknown> | null;
  };
  next: {
    canImportSessionIntoExtensionBrowser: boolean;
    reason: string;
  };
  safety: string[];
  reportPath?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROJECT_ROOT = resolve(__dirname, "..");
export const BRIDGE_PATH = resolve(__dirname, "workarena-bridge.py");
export const REPORTS_DIR = resolve(PROJECT_ROOT, ".artifacts", "e2e");

const DEFAULT_VENV_PYTHON = resolve(
  PROJECT_ROOT,
  ".artifacts",
  "workarena",
  ".venv",
  "Scripts",
  "python.exe",
);

export function loadDotEnv(): Record<string, string> {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) return {};

  const env: Record<string, string> = {};
  const content = readFileSync(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function resolvePythonExecutable(): string {
  if (process.env.WORKARENA_PYTHON) return process.env.WORKARENA_PYTHON;
  if (existsSync(DEFAULT_VENV_PYTHON)) return DEFAULT_VENV_PYTHON;
  return "python";
}

export function today(): string {
  return new Date().toISOString().split("T")[0];
}

export function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export function writeJsonReport(result: unknown, filename: string): string {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = resolve(REPORTS_DIR, filename);
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf-8");
  return reportPath;
}

export function runWorkArenaBridge<T>(
  bridgeArgs: string[],
  options: { timeoutMs?: number } = {},
): T {
  const result = spawnSync(resolvePythonExecutable(), [BRIDGE_PATH, ...bridgeArgs], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...loadDotEnv(),
    },
    encoding: "utf-8",
    timeout: options.timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `python exited with ${result.status}`).trim(),
    );
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(
      `bridge returned invalid JSON: ${(result.stdout || result.stderr).slice(0, 500)}`,
    );
  }
}

export function missingPythonResult(
  pythonExecutable: string,
  message: string,
): DoctorResult {
  return {
    benchmark: "workarena",
    ready: false,
    dataset: "ServiceNow/WorkArena-Instances",
    pythonExecutable,
    platform: process.platform,
    checks: [
      {
        name: "python",
        status: "missing",
        detail: message,
      },
    ],
  };
}

export function runWorkArenaDoctor(allowPendingHf: boolean): DoctorResult {
  try {
    const bridgeArgs = allowPendingHf ? ["--allow-pending-hf"] : [];
    return runWorkArenaBridge<DoctorResult>(bridgeArgs, { timeoutMs: 120_000 });
  } catch (error) {
    return missingPythonResult(
      resolvePythonExecutable(),
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function runWorkArenaDry(args: {
  taskId: string;
  seed: number;
  noReset?: boolean;
  showBrowser?: boolean;
}): DryResult {
  const bridgeArgs = [
    "dry",
    "--task",
    args.taskId,
    "--seed",
    String(args.seed),
  ];
  if (args.noReset) bridgeArgs.push("--no-reset");
  if (args.showBrowser) bridgeArgs.push("--show-browser");
  return runWorkArenaBridge<DryResult>(bridgeArgs, { timeoutMs: 300_000 });
}

export function classifyReadiness(result: DoctorResult): ReadinessStatus {
  const hf = result.checks.find((check) => check.name === "huggingface_access");
  const hardBlock = result.checks.some(
    (check) =>
      check.status === "missing" ||
      check.status === "blocked" ||
      (check.status === "pending" && check.name !== "huggingface_access"),
  );

  if (!hardBlock && hf?.status === "pending") return "local_ready_hf_pending";
  if (result.ready) return "ready";
  return "blocked";
}

export function withReadiness(result: DoctorResult): DoctorResult {
  return {
    ...result,
    readiness: classifyReadiness(result),
  };
}

export function readinessLabel(status: ReadinessStatus): string {
  if (status === "ready") return "ready";
  if (status === "local_ready_hf_pending") return "local setup ready; gated access pending";
  return "blocked";
}

export function formatStatus(status: CheckStatus): string {
  return status.toUpperCase().padEnd(7, " ");
}

export function compactGoal(goal: string | null, maxLength = 240): string {
  if (!goal) return "(none)";
  const compact = goal.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}
