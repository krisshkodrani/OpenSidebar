import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { TRACE_DIR, readSessionIndex } from "./utils";

export interface ProviderFailureOptions {
  limit?: number;
  onlyLocalhost?: boolean;
  sinceDays?: number;
}

export interface ProviderFailureTurn {
  sessionId: string;
  recordedAt?: string;
  startUrl?: string;
  outcome: string;
  failureCode?: string;
  turnNumber: number;
  actualModel?: string;
  actualProviderId?: string;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  retryCount: number;
  query: string;
}

export interface ProviderFailureSummary {
  totalSessions: number;
  totalFailureTurns: number;
  byFailureCode: Record<string, number>;
  byModel: Record<string, number>;
  byFinishReason: Record<string, number>;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgDurationMs: number;
  avgRetryCount: number;
  failureTurns: ProviderFailureTurn[];
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseHost(startUrl?: string): string {
  if (!startUrl) return "unknown";
  try {
    return new URL(startUrl).host;
  } catch {
    return "unknown";
  }
}

function matchesSince(recordedAt: string | undefined, sinceDays: number | undefined): boolean {
  if (!sinceDays) return true;
  if (!recordedAt) return false;
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const ts = Date.parse(recordedAt);
  return Number.isFinite(ts) && ts >= cutoff;
}

function readTraceLines(sessionId: string): Array<Record<string, unknown>> {
  const path = join(TRACE_DIR, `${sessionId}.jsonl`);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((line): line is Record<string, unknown> => line !== null);
}

function extractProviderFailureTurns(
  session: Record<string, unknown>,
): ProviderFailureTurn[] {
  const sessionId = typeof session.sessionId === "string" ? session.sessionId : null;
  if (!sessionId) return [];

  const traceLines = readTraceLines(sessionId);
  const failures: ProviderFailureTurn[] = [];

  for (const line of traceLines) {
    if (line.traceKind !== "agent.turn") continue;

    const llmResponse = isRecordObject(line.llmResponse) ? line.llmResponse : null;
    const events = Array.isArray(line.events) ? line.events : [];
    if (!llmResponse) continue;

    const content = typeof llmResponse.content === "string" ? llmResponse.content : null;
    const toolCalls = Array.isArray(llmResponse.toolCalls) ? llmResponse.toolCalls : [];
    const finishReason = typeof llmResponse.finishReason === "string" ? llmResponse.finishReason : undefined;
    const usage = isRecordObject(llmResponse.usage) ? llmResponse.usage : null;

    const retryCount = events.filter((event) => {
      if (!isRecordObject(event)) return false;
      return event.type === "turn_retry" && isRecordObject(event.data) && event.data.errorClass === "empty_response";
    }).length;
    const hitCircuitBreaker = events.some((event) => {
      if (!isRecordObject(event)) return false;
      return event.type === "empty_response_circuit_breaker";
    });

    const isEmptyResponse =
      hitCircuitBreaker ||
      (finishReason === "stop" && !content && toolCalls.length === 0);

    if (!isEmptyResponse) continue;

    failures.push({
      sessionId,
      recordedAt: typeof session.recordedAt === "string" ? session.recordedAt : undefined,
      startUrl: typeof session.startUrl === "string" ? session.startUrl : undefined,
      outcome: typeof session.outcome === "string" ? session.outcome : "unknown",
      failureCode: typeof session.failureCode === "string" ? session.failureCode : undefined,
      turnNumber: typeof line.turnNumber === "number" ? line.turnNumber : 0,
      actualModel: typeof llmResponse.actualModel === "string" ? llmResponse.actualModel : undefined,
      actualProviderId:
        typeof llmResponse.actualProviderId === "string" ? llmResponse.actualProviderId : undefined,
      finishReason,
      promptTokens: usage && typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
      completionTokens:
        usage && typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
      totalTokens: usage && typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
      durationMs: typeof llmResponse.durationMs === "number" ? llmResponse.durationMs : undefined,
      retryCount,
      query: typeof session.query === "string" ? session.query : "",
    });
  }

  return failures;
}

export function collectProviderFailureTurns(
  options: ProviderFailureOptions = {},
): ProviderFailureTurn[] {
  const sessions = readSessionIndex()
    .filter((session) => isRecordObject(session))
    .filter((session) => session.failureCategory === "provider")
    .filter((session) =>
      matchesSince(
        typeof session.recordedAt === "string" ? session.recordedAt : undefined,
        options.sinceDays,
      ))
    .filter((session) => {
      if (!options.onlyLocalhost) return true;
      const host = parseHost(typeof session.startUrl === "string" ? session.startUrl : undefined);
      return host.startsWith("127.0.0.1") || host.startsWith("localhost");
    });

  const turns = sessions.flatMap((session) => extractProviderFailureTurns(session));
  turns.sort((a, b) => {
    const aTs = a.recordedAt ? Date.parse(a.recordedAt) : 0;
    const bTs = b.recordedAt ? Date.parse(b.recordedAt) : 0;
    return bTs - aTs;
  });

  if (options.limit && options.limit > 0) {
    return turns.slice(0, options.limit);
  }
  return turns;
}

export function summarizeProviderFailures(
  failureTurns: ProviderFailureTurn[],
): ProviderFailureSummary {
  const byFailureCode: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byFinishReason: Record<string, number> = {};
  const promptTokens: number[] = [];
  const completionTokens: number[] = [];
  const durations: number[] = [];
  const retries: number[] = [];
  const sessionIds = new Set<string>();

  for (const turn of failureTurns) {
    sessionIds.add(turn.sessionId);
    byFailureCode[turn.failureCode ?? "unknown"] = (byFailureCode[turn.failureCode ?? "unknown"] ?? 0) + 1;
    byModel[turn.actualModel ?? "unknown"] = (byModel[turn.actualModel ?? "unknown"] ?? 0) + 1;
    byFinishReason[turn.finishReason ?? "unknown"] = (byFinishReason[turn.finishReason ?? "unknown"] ?? 0) + 1;
    if (typeof turn.promptTokens === "number") promptTokens.push(turn.promptTokens);
    if (typeof turn.completionTokens === "number") completionTokens.push(turn.completionTokens);
    if (typeof turn.durationMs === "number") durations.push(turn.durationMs);
    retries.push(turn.retryCount);
  }

  return {
    totalSessions: sessionIds.size,
    totalFailureTurns: failureTurns.length,
    byFailureCode,
    byModel,
    byFinishReason,
    avgPromptTokens: mean(promptTokens),
    avgCompletionTokens: mean(completionTokens),
    avgDurationMs: mean(durations),
    avgRetryCount: mean(retries),
    failureTurns,
  };
}

function topEntries(counts: Record<string, number>, limit = 10): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

export function buildProviderFailureReport(
  summary: ProviderFailureSummary,
  options: ProviderFailureOptions = {},
): string {
  const lines: string[] = [];
  lines.push("# Provider Failure Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(`- Sessions analyzed: ${summary.totalSessions}`);
  lines.push(`- Failure turns analyzed: ${summary.totalFailureTurns}`);
  if (options.onlyLocalhost) lines.push("- Filter: localhost/fixture sessions only");
  if (options.limit) lines.push(`- Limit: latest ${options.limit} failure turn(s)`);
  if (options.sinceDays) lines.push(`- Recency window: last ${options.sinceDays} day(s)`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Avg prompt tokens | ${summary.avgPromptTokens.toFixed(1)} |`);
  lines.push(`| Avg completion tokens | ${summary.avgCompletionTokens.toFixed(1)} |`);
  lines.push(`| Avg response time | ${(summary.avgDurationMs / 1000).toFixed(1)}s |`);
  lines.push(`| Avg retry count before failure | ${summary.avgRetryCount.toFixed(1)} |`);
  lines.push("");
  lines.push("## Failure Codes");
  lines.push("");
  for (const [key, count] of topEntries(summary.byFailureCode)) {
    lines.push(`- \`${key}\`: ${count}`);
  }
  lines.push("");
  lines.push("## Actual Models");
  lines.push("");
  for (const [key, count] of topEntries(summary.byModel)) {
    lines.push(`- \`${key}\`: ${count}`);
  }
  lines.push("");
  lines.push("## Finish Reasons");
  lines.push("");
  for (const [key, count] of topEntries(summary.byFinishReason)) {
    lines.push(`- \`${key}\`: ${count}`);
  }
  lines.push("");
  lines.push("## Recent Failure Turns");
  lines.push("");
  lines.push("| Recorded | Session | Turn | Model | Finish | Prompt toks | Retries | URL |");
  lines.push("|----------|---------|------|-------|--------|-------------|---------|-----|");
  for (const failure of summary.failureTurns.slice(0, 15)) {
    lines.push(
      `| ${failure.recordedAt ?? "unknown"} | ${failure.sessionId} | ${failure.turnNumber} | ${failure.actualModel ?? "unknown"} | ${failure.finishReason ?? "unknown"} | ${failure.promptTokens ?? "?"} | ${failure.retryCount} | ${failure.startUrl ?? "unknown"} |`,
    );
  }
  if (summary.failureTurns.length === 0) {
    lines.push("| none | none | none | none | none | none | none | none |");
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- These are provider-classified runtime failures from recorded traces.");
  lines.push("- The key pattern to watch is `finishReason=stop` with empty content and zero tool calls after the retry loop.");
  return lines.join("\n");
}

export function writeProviderFailureReport(report: string): string {
  const reportsDir = join(TRACE_DIR, "..", "evals", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(reportsDir, `provider-failures-${stamp}.md`);
  writeFileSync(path, report, "utf-8");
  return path;
}
