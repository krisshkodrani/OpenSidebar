import { spawnSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");

export interface LabTraceSummary {
  slug: string;
  title: string;
  recorded_at: string | null;
  session_id: string;
  run_id: string | null;
  domain: string | null;
  fixture: string | null;
  outcome: string;
  failure_category: string;
  failure_code: string;
  turn_count: number;
  models: string[];
  tools: string[];
  events: string[];
  summary: string;
  score?: number;
}

export interface LabTraceSessionDetail {
  slug: string;
  title: string;
  tags: string[];
  page: {
    type: string;
    updated_at: string;
    compiled_truth: string;
    frontmatter?: Record<string, unknown>;
  };
  session: {
    sessionId: string;
    runId: string | null;
    workspaceId: string | null;
    recordedAt: string | null;
    startTime: number;
    endTime: number;
    startUrl: string;
    domain: string | null;
    fixture: string | null;
    outcome: string;
    failureCategory: string | null;
    failureCode: string | null;
    failureDetail: string | null;
    turnCount: number;
    summary: string;
    models: string[];
    metrics: Record<string, unknown> | null;
    sourceFiles: Record<string, string> | null;
  };
  turns?: Array<{
    turnNumber: number;
    timestamp: number;
    url: string | null;
    title: string | null;
    llmDurationMs: number | null;
    toolNames: string[];
    eventTypes: string[];
    responseSnippet: string;
    toolResults: Array<{
      toolName: string;
      success: boolean;
      detail: string;
    }>;
  }>;
  timeline?: Array<{
    date: string;
    source: string;
    summary: string;
    detail: string;
  }>;
}

export interface LabTracePathologySummary {
  total_sessions: number;
  failed_sessions: number;
  completed_sessions: number;
  outcomes: Array<{ value: string; count: number }>;
  failure_categories: Array<{ value: string; count: number }>;
  failure_codes: Array<{ value: string; count: number }>;
  domains: Array<{ value: string; count: number }>;
  fixtures: Array<{ value: string; count: number }>;
  recurring_tools_in_failed_sessions: Array<{ value: string; count: number }>;
  recurring_events_in_failed_sessions: Array<{ value: string; count: number }>;
}

export interface LabTraceDiagnosis {
  session: LabTraceSessionDetail;
  similarFailures: {
    target: LabTraceSummary | null;
    query: string | null;
    failure_code: string | null;
    total_matches: number;
    results: LabTraceSummary[];
  };
  pathologySummary: LabTracePathologySummary;
  pathologyScope: {
    domain: string | null;
    fixture: string | null;
  };
}

export interface LabResearchSeedResult {
  title: string;
  output: string;
}

export interface LabTraceBugBriefResult {
  title: string;
  content: string;
}

function normalizeCommand(command: string, args: string[]): {
  command: string;
  args: string[];
} {
  if (process.platform !== "win32") {
    return { command, args };
  }

  if (command === "npx" || command === "npm" || command === "bun") {
    return { command: "cmd", args: ["/c", command, ...args] };
  }

  return { command, args };
}

function callLabTraceTool<T>(
  toolName: string,
  payload: Record<string, unknown>,
): T {
  const invocation = normalizeCommand("npx", [
    "tsx",
    "lab/bin/gbrain.ts",
    "call",
    toolName,
    JSON.stringify(payload),
  ]);

  const result = spawnSync(invocation.command, invocation.args, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    },
    stdio: "pipe",
    encoding: "utf-8",
  });

  if ((result.status ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(detail);
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    throw new Error(`Lab trace tool ${toolName} returned no output`);
  }

  return JSON.parse(stdout) as T;
}

export function fetchLabTraceSession(
  sessionId: string,
): LabTraceSessionDetail {
  return callLabTraceTool<LabTraceSessionDetail>("get_trace_session", {
    session_id: sessionId,
  });
}

export function fetchSimilarLabTraceFailures(
  sessionId: string,
  limit = 5,
): LabTraceDiagnosis["similarFailures"] {
  return callLabTraceTool<LabTraceDiagnosis["similarFailures"]>(
    "find_similar_failures",
    {
      session_id: sessionId,
      limit,
    },
  );
}

export function fetchLabTracePathologies(
  scope: {
    domain?: string | null;
    fixture?: string | null;
    limit?: number;
  },
): LabTracePathologySummary {
  return callLabTraceTool<LabTracePathologySummary>(
    "list_trace_pathologies",
    {
      ...(scope.domain ? { domain: scope.domain } : {}),
      ...(scope.fixture ? { fixture: scope.fixture } : {}),
      limit: scope.limit ?? 5,
    },
  );
}

export function fetchLabTraceDiagnosis(
  sessionId: string,
  limit = 5,
): LabTraceDiagnosis {
  const session = fetchLabTraceSession(sessionId);
  const pathologyScope = {
    domain: session.session.domain,
    fixture: session.session.fixture,
  };

  return {
    session,
    similarFailures: fetchSimilarLabTraceFailures(sessionId, limit),
    pathologySummary: fetchLabTracePathologies({
      domain: pathologyScope.domain,
      fixture: pathologyScope.fixture,
      limit,
    }),
    pathologyScope,
  };
}

export function createLabResearchSeedFromTrace(
  sessionId: string,
): LabResearchSeedResult {
  const diagnosis = fetchLabTraceDiagnosis(sessionId, 5);
  const failureCode =
    diagnosis.session.session.failureCode &&
    diagnosis.session.session.failureCode !== "none"
      ? diagnosis.session.session.failureCode
      : null;
  const scope =
    diagnosis.pathologyScope.fixture ||
    diagnosis.pathologyScope.domain ||
    "trace-session";
  const shortId = diagnosis.session.session.sessionId.slice(0, 8);

  const title = failureCode
    ? `Why did ${failureCode} appear in ${scope} trace ${shortId}?`
    : `What can we learn from trace session ${shortId} on ${scope}?`;

  const invocation = normalizeCommand("npx", [
    "tsx",
    "lab/bin/question.ts",
    "--type",
    "pathology",
    "--tags",
    "traces,viewer,diagnosis",
    "--source",
    "trace-viewer",
    title,
  ]);

  const result = spawnSync(invocation.command, invocation.args, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    },
    stdio: "pipe",
    encoding: "utf-8",
  });

  if ((result.status ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(detail);
  }

  return {
    title,
    output: (result.stdout || "").trim(),
  };
}

function formatCountItems(
  items: Array<{ value: string; count: number }>,
  fallback: string,
): string {
  if (!items.length) return fallback;
  return items
    .slice(0, 3)
    .map((item) => `${item.value} (${item.count})`)
    .join(", ");
}

function buildBugBriefRecommendations(
  diagnosis: LabTraceDiagnosis,
): string[] {
  const recommendations: string[] = [];
  const compareCandidate = diagnosis.similarFailures.results[0];
  const topFailedTool =
    diagnosis.pathologySummary.recurring_tools_in_failed_sessions[0]?.value;
  const topFailedEvent =
    diagnosis.pathologySummary.recurring_events_in_failed_sessions[0]?.value;
  const repeatedFailureCode = diagnosis.pathologySummary.failure_codes[0];

  if (compareCandidate) {
    recommendations.push(
      `Compare against related session \`${compareCandidate.session_id}\` to find the first divergence turn.`,
    );
  }

  if (topFailedTool) {
    recommendations.push(
      `Inspect \`${topFailedTool}\` first because it is the most repeated failed tool in this cohort.`,
    );
  }

  if (topFailedEvent) {
    recommendations.push(
      `Review the repeated \`${topFailedEvent}\` event pattern around the first failing turn.`,
    );
  }

  if (
    repeatedFailureCode &&
    repeatedFailureCode.value !== "none" &&
    repeatedFailureCode.count > 1
  ) {
    recommendations.push(
      `Treat \`${repeatedFailureCode.value}\` as a cohort issue and consider a targeted harness or regression test.`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Inspect the first non-productive turn and convert the finding into either a code fix or a targeted repro.",
    );
  }

  return recommendations.slice(0, 4);
}

export function createLabBugBriefFromTrace(
  sessionId: string,
): LabTraceBugBriefResult {
  const diagnosis = fetchLabTraceDiagnosis(sessionId, 5);
  const { session } = diagnosis.session;
  const shortId = session.sessionId.slice(0, 8);
  const scope =
    diagnosis.pathologyScope.fixture ||
    diagnosis.pathologyScope.domain ||
    "trace-session";
  const failureCode =
    session.failureCode && session.failureCode !== "none"
      ? session.failureCode
      : null;
  const title = failureCode
    ? `Bug brief: ${failureCode} on ${scope} (${shortId})`
    : `Bug brief: trace session ${shortId} on ${scope}`;
  const compareCandidate = diagnosis.similarFailures.results[0];
  const recommendations = buildBugBriefRecommendations(diagnosis);
  const scopeValue = diagnosis.pathologyScope.domain
    ? `${diagnosis.pathologyScope.domain}${
        diagnosis.pathologyScope.fixture
          ? ` / ${diagnosis.pathologyScope.fixture}`
          : ""
      }`
    : "unknown";
  const modelsValue = session.models.length
    ? session.models.map((model) => `\`${model}\``).join(", ")
    : "none recorded";
  const content = [
    `# ${title}`,
    "",
    "## Session",
    `- Session ID: \`${session.sessionId}\``,
    `- Imported slug: \`${diagnosis.session.slug}\``,
    `- Outcome: \`${session.outcome}\``,
    `- Failure code: \`${session.failureCode || "none"}\``,
    `- Failure category: \`${session.failureCategory || "none"}\``,
    `- Domain / fixture: \`${scopeValue}\``,
    `- Turns: \`${session.turnCount}\``,
    `- Models: ${modelsValue}`,
    "",
    "## Summary",
    session.summary || "No summary available.",
    "",
    "## Cohort Signals",
    `- Related failures: \`${diagnosis.similarFailures.total_matches}\``,
    `- Top failure codes: ${formatCountItems(diagnosis.pathologySummary.failure_codes, "none recorded")}`,
    `- Repeated failed tools: ${formatCountItems(diagnosis.pathologySummary.recurring_tools_in_failed_sessions, "none recorded")}`,
    `- Repeated failed events: ${formatCountItems(diagnosis.pathologySummary.recurring_events_in_failed_sessions, "none recorded")}`,
    "",
    "## Best Comparison",
    compareCandidate
      ? `- Compare against \`${compareCandidate.session_id}\` (${compareCandidate.outcome}, ${compareCandidate.turn_count} turns)`
      : "- No comparable failure was found in the imported trace cohort.",
    "",
    "## Recommended Next Actions",
    ...recommendations.map((item) => `- ${item}`),
  ].join("\n");

  return {
    title,
    content,
  };
}
