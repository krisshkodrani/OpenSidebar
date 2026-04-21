import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const TRACE_DIR = join(PROJECT_ROOT, "traces");
const TRACE_INDEX = join(TRACE_DIR, "index.jsonl");
const OUTPUT_ROOT = resolve(PROJECT_ROOT, "data", "trace-projections");

interface TraceSessionRecord {
  sessionId: string;
  runId?: string;
  workspaceId?: string;
  recordedAt?: string;
  startTime: number;
  endTime: number;
  query: string;
  startUrl: string;
  outcome: string;
  failureCategory?: string;
  failureCode?: string;
  failureDetail?: string;
  turnCount: number;
  summary: string;
  metrics?: {
    totalTokens?: number;
    totalCost?: number;
    totalLlmTimeMs?: number;
    totalSessionTimeMs?: number;
  } | null;
  models?: string[];
}

interface TraceTurnRecord {
  turnNumber: number;
  timestamp: number;
  snapshot?: {
    url?: string;
    title?: string;
  };
  llmResponse?: {
    toolCalls?: Array<{ function?: { name?: string } }>;
    content?: string | null;
    durationMs?: number;
  };
  toolExecutions?: Array<{
    toolName: string;
    success: boolean;
    result?: string;
    error?: string;
  }>;
  events?: Array<{
    type?: string;
  }>;
}

interface ProjectedSessionManifestEntry {
  slug: string;
  outputPath: string;
  timelineEntries: Array<{
    date: string;
    source: string;
    summary: string;
    detail: string;
  }>;
  rawData: {
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
      metrics: TraceSessionRecord["metrics"] | null;
      sourceFiles: {
        index: string;
        turns: string;
      };
    };
    turns: Array<{
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
  };
}

interface ProjectionManifest {
  generatedAt: string;
  source: string;
  daysBack: number;
  limit: number;
  writeOnly: boolean;
  clean: boolean;
  sessionsWritten: number;
  sessions: ProjectedSessionManifestEntry[];
}

const args = process.argv.slice(2);
const daysBack = parsePositiveInt(flagValue("--days"), 7);
const limit = parsePositiveInt(flagValue("--limit"), 100);
const writeOnly = args.includes("--write-only");
const clean = args.includes("--clean");

if (!existsSync(TRACE_INDEX)) {
  console.error("No traces/index.jsonl found.");
  process.exit(1);
}

if (clean && existsSync(OUTPUT_ROOT)) {
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
}
mkdirSync(OUTPUT_ROOT, { recursive: true });

const cutoffMs = Date.now() - daysBack * 24 * 60 * 60 * 1000;
const sessions = readJsonl<TraceSessionRecord>(TRACE_INDEX)
  .filter((session) => {
    const recordedAtMs = session.recordedAt ? Date.parse(session.recordedAt) : session.endTime;
    return Number.isFinite(recordedAtMs) && recordedAtMs >= cutoffMs;
  })
  .slice(-limit);

let written = 0;
const manifestSessions: ProjectedSessionManifestEntry[] = [];
for (const session of sessions) {
  const traceFile = join(TRACE_DIR, `${session.sessionId}.jsonl`);
  const turns = existsSync(traceFile) ? readJsonl<TraceTurnRecord>(traceFile) : [];
  const outputPath = sessionOutputPath(session);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buildMarkdown(session, turns), "utf-8");
  manifestSessions.push(buildManifestEntry(session, turns, outputPath, traceFile));
  written++;
}

const manifest: ProjectionManifest = {
  generatedAt: new Date().toISOString(),
  source: "traces/index.jsonl",
  daysBack,
  limit,
  writeOnly,
  clean,
  sessionsWritten: written,
  sessions: manifestSessions,
};
writeFileSync(join(OUTPUT_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");

console.log(`Projected ${written} trace sessions into ${OUTPUT_ROOT}`);
if (writeOnly) {
  console.log("Write-only mode enabled. Skipping GBrain import.");
}

function flagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readJsonl<T>(filePath: string): T[] {
  const raw = readFileSync(filePath, "utf-8").trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as T[];
}

function sessionOutputPath(session: TraceSessionRecord): string {
  const day = session.recordedAt ? dayKey(Date.parse(session.recordedAt)) : dayKey(session.endTime);
  return join(OUTPUT_ROOT, "trace-session", day, `${session.sessionId}.md`);
}

function dayKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildMarkdown(session: TraceSessionRecord, turns: TraceTurnRecord[]): string {
  const recordedAtMs = session.recordedAt ? Date.parse(session.recordedAt) : session.endTime;
  const day = dayKey(recordedAtMs);
  const hostname = extractHostname(session.startUrl);
  const fixture = inferFixtureName(session.startUrl);
  const models = (session.models ?? []).map(normalizeTag).filter(Boolean);
  const tags = unique([
    "trace",
    "trace-session",
    hostname ? `domain-${normalizeTag(hostname)}` : "",
    fixture ? `fixture-${normalizeTag(fixture)}` : "",
    session.outcome ? `outcome-${normalizeTag(session.outcome)}` : "",
    session.failureCode && session.failureCode !== "none" ? `failure-${normalizeTag(session.failureCode)}` : "",
    ...models.map((model) => `model-${model}`),
  ]).filter(Boolean);

  const frontmatter = [
    "---",
    "type: source",
    `title: "${escapeYaml(titleFor(session, fixture))}"`,
    `slug: "trace-session/${day}/${session.sessionId}"`,
    `tags: [${tags.map((tag) => `"${escapeYaml(tag)}"`).join(", ")}]`,
    `recordedAt: "${escapeYaml(session.recordedAt ?? new Date(session.endTime).toISOString())}"`,
    `sessionId: "${escapeYaml(session.sessionId)}"`,
    `runId: "${escapeYaml(session.runId ?? "")}"`,
    `workspaceId: "${escapeYaml(session.workspaceId ?? "")}"`,
    `startUrl: "${escapeYaml(session.startUrl)}"`,
    `domain: "${escapeYaml(hostname ?? "")}"`,
    `fixture: "${escapeYaml(fixture ?? "")}"`,
    `outcome: "${escapeYaml(session.outcome)}"`,
    `failureCode: "${escapeYaml(session.failureCode ?? "none")}"`,
    `failureCategory: "${escapeYaml(session.failureCategory ?? "none")}"`,
    `turnCount: ${session.turnCount}`,
    `models: [${(session.models ?? []).map((model) => `"${escapeYaml(model)}"`).join(", ")}]`,
    "---",
  ].join("\n");

  const compiledTruth = [
    `# ${titleFor(session, fixture)}`,
    "",
    "## Summary",
    "",
    `- Outcome: \`${session.outcome}\``,
    `- Domain: ${hostname ?? "(unknown)"}`,
    `- Fixture: ${fixture ?? "(unknown)"}`,
    `- Failure code: \`${session.failureCode ?? "none"}\``,
    `- Turns: ${session.turnCount}`,
    `- Duration: ${formatDuration(session.endTime - session.startTime)}`,
    session.metrics?.totalTokens != null ? `- Tokens: ${formatInteger(session.metrics.totalTokens)}` : "",
    session.metrics?.totalCost != null ? `- Estimated cost: $${session.metrics.totalCost.toFixed(4)}` : "",
    session.models?.length ? `- Models: ${session.models.join(", ")}` : "",
    "",
    "## Query",
    "",
    "```text",
    summarizeQuery(session.query),
    "```",
    "",
    "## Session Abstract",
    "",
    session.summary.trim() || "No session summary recorded.",
  ]
    .filter(Boolean)
    .join("\n");

  const timeline = turns.length > 0
    ? turns
        .map((turn) => {
          const tools = unique([
            ...(turn.llmResponse?.toolCalls ?? []).map((call) => call.function?.name ?? "").filter(Boolean),
            ...(turn.toolExecutions ?? []).map((execution) => execution.toolName).filter(Boolean),
          ]);
          const events = unique((turn.events ?? []).map((event) => event.type ?? "").filter(Boolean));
          const text = truncate(singleLine(turn.llmResponse?.content ?? ""), 160);
          const results = (turn.toolExecutions ?? [])
            .slice(0, 3)
            .map((execution) => {
              const status = execution.success ? "ok" : "fail";
              const detail = truncate(singleLine(execution.error || execution.result || ""), 100);
              return `- ${execution.toolName} [${status}]${detail ? `: ${detail}` : ""}`;
            })
            .join("\n");

          return [
            `### Turn ${turn.turnNumber}`,
            "",
            `- Time: ${new Date(turn.timestamp).toISOString()}`,
            `- URL: ${turn.snapshot?.url ?? session.startUrl}`,
            `- Title: ${turn.snapshot?.title ?? "(unknown)"}`,
            tools.length ? `- Tools: ${tools.join(", ")}` : "- Tools: (none)",
            events.length ? `- Events: ${events.join(", ")}` : "- Events: (none)",
            turn.llmResponse?.durationMs != null ? `- LLM duration: ${turn.llmResponse.durationMs}ms` : "",
            text ? `- Response: ${text}` : "",
            results ? "- Tool results:\n" + results : "",
            "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n")
    : "No turn records were found for this session.";

  return `${frontmatter}\n\n${compiledTruth}\n\n---\n\n${timeline}\n`;
}

function buildManifestEntry(
  session: TraceSessionRecord,
  turns: TraceTurnRecord[],
  outputPath: string,
  traceFile: string,
): ProjectedSessionManifestEntry {
  const day = session.recordedAt ? dayKey(Date.parse(session.recordedAt)) : dayKey(session.endTime);
  const hostname = extractHostname(session.startUrl);
  const fixture = inferFixtureName(session.startUrl);

  return {
    slug: `trace-session/${day}/${session.sessionId}`,
    outputPath,
    timelineEntries: turns.map((turn) => ({
      date: dayKey(turn.timestamp),
      source: `trace-turn:${turn.turnNumber}`,
      summary: buildTimelineSummary(turn),
      detail: buildTimelineDetail(turn),
    })),
    rawData: {
      session: {
        sessionId: session.sessionId,
        runId: session.runId ?? null,
        workspaceId: session.workspaceId ?? null,
        recordedAt: session.recordedAt ?? null,
        startTime: session.startTime,
        endTime: session.endTime,
        startUrl: session.startUrl,
        domain: hostname,
        fixture,
        outcome: session.outcome,
        failureCategory: session.failureCategory ?? null,
        failureCode: session.failureCode ?? null,
        failureDetail: session.failureDetail ?? null,
        turnCount: session.turnCount,
        summary: session.summary,
        models: session.models ?? [],
        metrics: session.metrics ?? null,
        sourceFiles: {
          index: TRACE_INDEX,
          turns: traceFile,
        },
      },
      turns: turns.map((turn) => ({
        turnNumber: turn.turnNumber,
        timestamp: turn.timestamp,
        url: turn.snapshot?.url ?? null,
        title: turn.snapshot?.title ?? null,
        llmDurationMs: turn.llmResponse?.durationMs ?? null,
        toolNames: unique([
          ...(turn.llmResponse?.toolCalls ?? []).map((call) => call.function?.name ?? "").filter(Boolean),
          ...(turn.toolExecutions ?? []).map((execution) => execution.toolName).filter(Boolean),
        ]),
        eventTypes: unique((turn.events ?? []).map((event) => event.type ?? "").filter(Boolean)),
        responseSnippet: truncate(singleLine(turn.llmResponse?.content ?? ""), 240),
        toolResults: (turn.toolExecutions ?? []).slice(0, 5).map((execution) => ({
          toolName: execution.toolName,
          success: execution.success,
          detail: truncate(singleLine(execution.error || execution.result || ""), 160),
        })),
      })),
    },
  };
}

function buildTimelineSummary(turn: TraceTurnRecord): string {
  const tools = unique([
    ...(turn.llmResponse?.toolCalls ?? []).map((call) => call.function?.name ?? "").filter(Boolean),
    ...(turn.toolExecutions ?? []).map((execution) => execution.toolName).filter(Boolean),
  ]);
  const events = unique((turn.events ?? []).map((event) => event.type ?? "").filter(Boolean));
  const toolBlob = tools.length > 0 ? tools.join(", ") : "no-tools";
  const eventBlob = events.length > 0 ? ` | events: ${events.join(", ")}` : "";
  return `T${turn.turnNumber}: ${toolBlob}${eventBlob}`;
}

function buildTimelineDetail(turn: TraceTurnRecord): string {
  const parts: string[] = [];
  const url = turn.snapshot?.url;
  const title = turn.snapshot?.title;
  const response = truncate(singleLine(turn.llmResponse?.content ?? ""), 240);
  const results = (turn.toolExecutions ?? [])
    .slice(0, 4)
    .map((execution) => {
      const status = execution.success ? "ok" : "fail";
      const detail = truncate(singleLine(execution.error || execution.result || ""), 120);
      return `${execution.toolName} [${status}]${detail ? `: ${detail}` : ""}`;
    });

  if (url) parts.push(`URL: ${url}`);
  if (title) parts.push(`Title: ${title}`);
  if (response) parts.push(`Response: ${response}`);
  if (results.length > 0) parts.push(`Results: ${results.join(" | ")}`);
  return parts.join("\n");
}

function titleFor(session: TraceSessionRecord, fixture: string | null): string {
  const date = session.recordedAt ? dayKey(Date.parse(session.recordedAt)) : dayKey(session.endTime);
  const scope = fixture ?? extractHostname(session.startUrl) ?? "trace";
  return `Trace session ${date} ${session.sessionId.slice(0, 8)} ${scope}`;
}

function extractHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function inferFixtureName(rawUrl: string): string | null {
  try {
    const pathname = new URL(rawUrl).pathname.replace(/^\/+/, "");
    if (!pathname) return null;
    return pathname.replace(/\//g, "-");
  } catch {
    return null;
  }
}

function normalizeTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeBlock(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function summarizeQuery(query: string): string {
  const normalized = normalizeBlock(query);
  if (!normalized) return "(empty)";

  const lines = normalized.split("\n");
  const captured: string[] = [];
  const objective = lines.find((line) => line.startsWith("Objective:"));
  const success = lines.find((line) => line.startsWith("Success criteria:"));
  if (objective) captured.push(objective);
  if (success) captured.push(success);

  const originalRequestIdx = lines.findIndex((line) => line.startsWith("Original user request"));
  if (originalRequestIdx !== -1) {
    const nextLine = lines[originalRequestIdx + 1]?.trim();
    if (nextLine) {
      captured.push(`Original user request: ${nextLine}`);
    }
  }

  if (captured.length > 0) {
    return captured.join("\n");
  }

  return truncate(normalized.replace(/\n+/g, " "), 800);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLen: number): string {
  return value.length > maxLen ? `${value.slice(0, maxLen - 3)}...` : value;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
