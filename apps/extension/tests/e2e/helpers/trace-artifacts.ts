import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  extractRunIdFromTraceFile,
  filterTraceFilesByWorkspace,
  findAllNewTraceFiles,
} from "./diagnostics";

const moduleDir = import.meta.url.startsWith("file:")
  ? dirname(fileURLToPath(import.meta.url))
  : dirname(import.meta.url);
const PROJECT_ROOT = resolve(moduleDir, "../../../../..");
const RUN_TRACE_DIR = join(PROJECT_ROOT, "traces", "runs");

export type HarnessDiagnosticSeverity = "info" | "warning" | "error";
export type HarnessDiagnosticSource =
  | "e2e-report"
  | "trace-collector"
  | "artifact-capture"
  | "workarena"
  | "trace-replay";

export interface HarnessDiagnostic {
  severity: HarnessDiagnosticSeverity;
  source: HarnessDiagnosticSource;
  code: string;
  timestamp: string;
  message: string;
  context?: Record<string, unknown>;
  artifactRefs?: string[];
}

export interface TraceArtifactBundle {
  traceFiles: string[];
  allTraceFiles: string[];
  runTraceFiles: string[];
  runIds: string[];
  diagnostics: HarnessDiagnostic[];
  collectedAt: string;
  workspaceId?: string | null;
}

interface MatchRunTraceOptions {
  runTraceDir?: string;
  fallbackWindowMs?: number;
  maxFallbackFiles?: number;
}

export interface RunTraceMatchResult {
  runTraceFiles: string[];
  runIds: string[];
  diagnostics: HarnessDiagnostic[];
}

interface CollectTraceArtifactsOptions extends MatchRunTraceOptions {
  tracesBefore: Set<string>;
  workspaceId?: string | null;
  timeoutMs?: number;
}

function diagnostic(
  severity: HarnessDiagnosticSeverity,
  code: string,
  message: string,
  context?: Record<string, unknown>,
  artifactRefs?: string[],
): HarnessDiagnostic {
  return {
    severity,
    source: "trace-collector",
    code,
    timestamp: new Date().toISOString(),
    message,
    ...(context ? { context } : {}),
    ...(artifactRefs && artifactRefs.length > 0 ? { artifactRefs } : {}),
  };
}

function readRunIdFromRunTrace(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const lines = readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (typeof entry?.runId === "string" && entry.runId.length > 0) {
        return entry.runId;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function traceMtimeWindow(traceFiles: string[], fallbackWindowMs: number) {
  const mtimes = traceFiles
    .map((filePath) => {
      try {
        return statSync(filePath).mtimeMs;
      } catch {
        return null;
      }
    })
    .filter((value): value is number => typeof value === "number");

  if (mtimes.length === 0) {
    const now = Date.now();
    return {
      min: now - fallbackWindowMs,
      max: now + fallbackWindowMs,
    };
  }

  return {
    min: Math.min(...mtimes) - fallbackWindowMs,
    max: Math.max(...mtimes) + fallbackWindowMs,
  };
}

function findRunTraceByFallbackScan(
  runId: string,
  traceFiles: string[],
  options: Required<Pick<MatchRunTraceOptions, "runTraceDir" | "fallbackWindowMs" | "maxFallbackFiles">>,
): string | null {
  if (!existsSync(options.runTraceDir)) return null;
  const window = traceMtimeWindow(traceFiles, options.fallbackWindowMs);
  const candidates = readdirSync(options.runTraceDir)
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .map((fileName) => {
      const filePath = join(options.runTraceDir, fileName);
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(filePath).mtimeMs;
      } catch {
        return null;
      }
      return { filePath, mtimeMs };
    })
    .filter(
      (item): item is { filePath: string; mtimeMs: number } =>
        item != null && item.mtimeMs >= window.min && item.mtimeMs <= window.max,
    )
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, options.maxFallbackFiles);

  for (const candidate of candidates) {
    if (readRunIdFromRunTrace(candidate.filePath) === runId) {
      return candidate.filePath;
    }
  }

  return null;
}

export function matchRunTraceFiles(
  traceFiles: string[],
  options: MatchRunTraceOptions = {},
): RunTraceMatchResult {
  const runTraceDir = options.runTraceDir ?? RUN_TRACE_DIR;
  const fallbackWindowMs = options.fallbackWindowMs ?? 5 * 60_000;
  const maxFallbackFiles = options.maxFallbackFiles ?? 200;
  const diagnostics: HarnessDiagnostic[] = [];
  const runIds = sortUnique(
    traceFiles
      .map((filePath) => extractRunIdFromTraceFile(filePath))
      .filter((runId): runId is string => typeof runId === "string"),
  );
  const runTraceFiles: string[] = [];

  for (const runId of runIds) {
    const exactPath = join(runTraceDir, `${runId}.jsonl`);
    if (existsSync(exactPath)) {
      runTraceFiles.push(exactPath);
      continue;
    }

    const fallbackPath = findRunTraceByFallbackScan(runId, traceFiles, {
      runTraceDir,
      fallbackWindowMs,
      maxFallbackFiles,
    });
    if (fallbackPath) {
      runTraceFiles.push(fallbackPath);
      diagnostics.push(
        diagnostic(
          "warning",
          "run_trace_fallback_match",
          "Run trace matched by bounded fallback scan.",
          {
            runId,
            runTraceFile: fallbackPath,
          },
          [fallbackPath],
        ),
      );
      continue;
    }

    diagnostics.push(
      diagnostic(
        "warning",
        "missing_run_trace",
        "Run trace file was not found for agent trace.",
        {
          runId,
          expectedPath: exactPath,
        },
      ),
    );
  }

  return {
    runTraceFiles: sortUnique(runTraceFiles),
    runIds,
    diagnostics,
  };
}

async function waitForTraceFiles(
  tracesBefore: Set<string>,
  workspaceId?: string | null,
  timeoutMs: number = 2_000,
): Promise<{ allTraceFiles: string[]; traceFiles: string[] }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const allTraceFiles = findAllNewTraceFiles(tracesBefore);
    const traceFiles = filterTraceFilesByWorkspace(allTraceFiles, workspaceId);
    if (traceFiles.length > 0) return { allTraceFiles, traceFiles };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const allTraceFiles = findAllNewTraceFiles(tracesBefore);
  return {
    allTraceFiles,
    traceFiles: filterTraceFilesByWorkspace(allTraceFiles, workspaceId),
  };
}

export async function collectTraceArtifacts(
  options: CollectTraceArtifactsOptions,
): Promise<TraceArtifactBundle> {
  const diagnostics: HarnessDiagnostic[] = [];
  const { allTraceFiles, traceFiles } = await waitForTraceFiles(
    options.tracesBefore,
    options.workspaceId,
    options.timeoutMs,
  );

  if (options.workspaceId && allTraceFiles.length > traceFiles.length) {
    diagnostics.push(
      diagnostic(
        "info",
        "workspace_trace_filter_ignored",
        "Ignored traces outside the requested workspace.",
        {
          workspaceId: options.workspaceId,
          ignoredTraceCount: allTraceFiles.length - traceFiles.length,
        },
      ),
    );
  }
  if (allTraceFiles.length > 0 && traceFiles.length === 0) {
    diagnostics.push(
      diagnostic(
        "warning",
        "workspace_trace_filter_empty",
        "New trace files were found but none matched the workspace filter.",
        {
          workspaceId: options.workspaceId ?? null,
          newTraceCount: allTraceFiles.length,
        },
        allTraceFiles,
      ),
    );
  }

  const runTraceMatch = matchRunTraceFiles(traceFiles, {
    runTraceDir: options.runTraceDir,
    fallbackWindowMs: options.fallbackWindowMs,
    maxFallbackFiles: options.maxFallbackFiles,
  });

  return {
    traceFiles,
    allTraceFiles,
    runTraceFiles: runTraceMatch.runTraceFiles,
    runIds: runTraceMatch.runIds,
    diagnostics: [...diagnostics, ...runTraceMatch.diagnostics],
    collectedAt: new Date().toISOString(),
    ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
  };
}
