import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { LOG_DIR, TRACE_DIR, readSessionFiles, readSessionIndex } from "./utils";

export interface LiveBenchmarkSession {
  sessionId: string;
  recordedAt?: string;
  query: string;
  startUrl?: string;
  outcome: string;
  failureCategory?: string;
  failureCode?: string;
  turnCount?: number;
  summary?: string;
  metrics?: {
    totalCostEstimated?: number;
    totalCostActual?: number;
    totalLlmTimeMs?: number;
    totalSessionTimeMs?: number;
    llmCallCount?: number;
  };
  controller?: {
    avgToolCount?: number;
    avgExecutedToolsPerTurn?: number;
    toolProfileAppliedTurns?: number;
    toolProfileAvgFilteredCount?: number;
    groundingMismatchCount?: number;
    invalidIdRecoveryHintCount?: number;
    blockedByPolicyCount?: number;
    safetyBlockedCount?: number;
    stagnationSignalCount?: number;
    sameUrlEscalationCount?: number;
    strategyPivotCount?: number;
    deadEndPivotCount?: number;
    zeroEffectWarningCount?: number;
    redundantActionNudgeCount?: number;
  };
}

export interface LiveBenchmarkOptions {
  limit?: number;
  onlyLocalhost?: boolean;
  queryContains?: string;
  sourceContains?: string;
  sinceDays?: number;
}

export interface LiveBenchmarkSummary {
  totalSessions: number;
  completedSessions: number;
  successRate: number;
  nonProviderSessions: number;
  nonProviderCompletedSessions: number;
  nonProviderSuccessRate: number;
  providerFailureSessions: number;
  outcomeCounts: Record<string, number>;
  failureCategoryCounts: Record<string, number>;
  avgTurns: number;
  medianTurns: number;
  avgLlmCalls: number;
  avgSessionTimeMs: number;
  avgLlmTimeMs: number;
  avgEstimatedCost: number;
  hostCounts: Record<string, number>;
  controller: {
    avgRequestedToolCount: number;
    avgExecutedToolsPerTurn: number;
    totalToolProfileAppliedTurns: number;
    avgFilteredToolCount: number;
    groundingMismatchCount: number;
    invalidIdRecoveryHintCount: number;
    blockedByPolicyCount: number;
    safetyBlockedCount: number;
    stagnationSignalCount: number;
    sameUrlEscalationCount: number;
    strategyPivotCount: number;
    deadEndPivotCount: number;
    zeroEffectWarningCount: number;
    redundantActionNudgeCount: number;
  };
  pendingSessions: Array<{
    sessionId: string;
    recordedAt?: string;
    startUrl?: string;
    turnCount?: number;
  }>;
  sessions: LiveBenchmarkSession[];
}

interface TraceTurnControllerMetrics {
  requestedToolCount: number;
  executedTools: number;
  toolProfileApplied: boolean;
  filteredToolCount?: number;
  groundingMismatchCount: number;
  invalidIdRecoveryHintCount: number;
  blockedByPolicyCount: number;
  safetyBlockedCount: number;
  stagnationSignals: number;
  sameUrlEscalations: number;
  strategyPivots: number;
  deadEndPivots: number;
  zeroEffectWarnings: number;
  redundantActionNudges: number;
}

function parseTraceTurnMetrics(sessionId: string): TraceTurnControllerMetrics[] {
  const path = join(TRACE_DIR, `${sessionId}.jsonl`);
  if (!existsSync(path)) return [];

  const lines = readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);

  const turns: TraceTurnControllerMetrics[] = [];

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.traceKind !== "agent.turn") continue;

    const llmRequest = isRecordObject(entry.llmRequest) ? entry.llmRequest : null;
    const toolExecutions = Array.isArray(entry.toolExecutions) ? entry.toolExecutions : [];
    const events = Array.isArray(entry.events) ? entry.events : [];
    const progressState = isRecordObject(entry.progressState) ? entry.progressState : null;

    let toolProfileApplied = false;
    let filteredToolCount: number | undefined;
    let groundingMismatchCount = 0;
    let invalidIdRecoveryHintCount = 0;
    let safetyBlockedCount = 0;
    let sameUrlEscalations = 0;
    let strategyPivots = 0;
    let deadEndPivots = 0;
    let zeroEffectWarnings = 0;
    let redundantActionNudges = 0;
    let stagnationSignals = 0;

    for (const rawEvent of events) {
      if (!isRecordObject(rawEvent)) continue;
      const type = typeof rawEvent.type === "string" ? rawEvent.type : "";
      const data = isRecordObject(rawEvent.data) ? rawEvent.data : null;

      if (type === "tool_profile_applied") {
        toolProfileApplied = true;
        if (data && typeof data.filteredToolCount === "number") {
          filteredToolCount = data.filteredToolCount;
        }
      }
      if (type === "grounding_mismatch") groundingMismatchCount++;
      if (type === "safety_gate_blocked") safetyBlockedCount++;
      if (type === "same_url_forced_escalation") sameUrlEscalations++;
      if (type === "strategy_pivot") strategyPivots++;
      if (type === "dead_end_pivot") deadEndPivots++;
      if (type === "zero_effect_warning") zeroEffectWarnings++;
      if (type === "redundant_action_nudge") redundantActionNudges++;
      if (type === "stuck_signal") stagnationSignals++;
    }

    if (progressState && typeof progressState.signal === "string" && progressState.signal.length > 0) {
      stagnationSignals++;
    }

    const blockedByPolicyCount = toolExecutions.filter((execution) => {
      if (!isRecordObject(execution)) return false;
      const result = typeof execution.result === "string" ? execution.result : "";
      return result.includes("disabled by current policy");
    }).length;
    for (const execution of toolExecutions) {
      if (!isRecordObject(execution)) continue;
      const result = typeof execution.result === "string" ? execution.result : "";
      if (
        result.includes("Reveal or refresh the relevant UI first") &&
        result.includes("currently visible tag")
      ) {
        invalidIdRecoveryHintCount++;
      }
    }

    turns.push({
      requestedToolCount:
        llmRequest && typeof llmRequest.toolCount === "number" ? llmRequest.toolCount : 0,
      executedTools: toolExecutions.length,
      toolProfileApplied,
      filteredToolCount,
      groundingMismatchCount,
      invalidIdRecoveryHintCount,
      blockedByPolicyCount,
      safetyBlockedCount,
      stagnationSignals,
      sameUrlEscalations,
      strategyPivots,
      deadEndPivots,
      zeroEffectWarnings,
      redundantActionNudges,
    });
  }

  return turns;
}

function buildControllerMetrics(sessionId: string): LiveBenchmarkSession["controller"] {
  const turns = parseTraceTurnMetrics(sessionId);
  if (turns.length === 0) return undefined;

  const filteredCounts = turns
    .map((turn) => turn.filteredToolCount)
    .filter((count): count is number => typeof count === "number");

  return {
    avgToolCount: mean(turns.map((turn) => turn.requestedToolCount)),
    avgExecutedToolsPerTurn: mean(turns.map((turn) => turn.executedTools)),
    toolProfileAppliedTurns: turns.filter((turn) => turn.toolProfileApplied).length,
    toolProfileAvgFilteredCount: mean(filteredCounts),
    groundingMismatchCount: turns.reduce((sum, turn) => sum + turn.groundingMismatchCount, 0),
    invalidIdRecoveryHintCount: turns.reduce((sum, turn) => sum + turn.invalidIdRecoveryHintCount, 0),
    blockedByPolicyCount: turns.reduce((sum, turn) => sum + turn.blockedByPolicyCount, 0),
    safetyBlockedCount: turns.reduce((sum, turn) => sum + turn.safetyBlockedCount, 0),
    stagnationSignalCount: turns.reduce((sum, turn) => sum + turn.stagnationSignals, 0),
    sameUrlEscalationCount: turns.reduce((sum, turn) => sum + turn.sameUrlEscalations, 0),
    strategyPivotCount: turns.reduce((sum, turn) => sum + turn.strategyPivots, 0),
    deadEndPivotCount: turns.reduce((sum, turn) => sum + turn.deadEndPivots, 0),
    zeroEffectWarningCount: turns.reduce((sum, turn) => sum + turn.zeroEffectWarnings, 0),
    redundantActionNudgeCount: turns.reduce((sum, turn) => sum + turn.redundantActionNudges, 0),
  };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSession(entry: Record<string, unknown>): LiveBenchmarkSession | null {
  const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : null;
  const query = typeof entry.query === "string" ? entry.query : "";
  const outcome = typeof entry.outcome === "string" ? entry.outcome : "unknown";
  if (!sessionId) return null;

  const metrics = isRecordObject(entry.metrics)
    ? {
        totalCostEstimated:
          typeof entry.metrics.totalCostEstimated === "number"
            ? entry.metrics.totalCostEstimated
            : undefined,
        totalCostActual:
          typeof entry.metrics.totalCostActual === "number"
            ? entry.metrics.totalCostActual
            : undefined,
        totalLlmTimeMs:
          typeof entry.metrics.totalLlmTimeMs === "number"
            ? entry.metrics.totalLlmTimeMs
            : undefined,
        totalSessionTimeMs:
          typeof entry.metrics.totalSessionTimeMs === "number"
            ? entry.metrics.totalSessionTimeMs
            : undefined,
        llmCallCount:
          typeof entry.metrics.llmCallCount === "number"
            ? entry.metrics.llmCallCount
            : undefined,
      }
    : undefined;

  return {
    sessionId,
    recordedAt: typeof entry.recordedAt === "string" ? entry.recordedAt : undefined,
    query,
    startUrl: typeof entry.startUrl === "string" ? entry.startUrl : undefined,
    outcome,
    failureCategory:
      typeof entry.failureCategory === "string" ? entry.failureCategory : undefined,
    failureCode: typeof entry.failureCode === "string" ? entry.failureCode : undefined,
    turnCount: typeof entry.turnCount === "number" ? entry.turnCount : undefined,
    summary: typeof entry.summary === "string" ? entry.summary : undefined,
    metrics,
    controller: buildControllerMetrics(sessionId),
  };
}

function parseHost(startUrl?: string): string {
  if (!startUrl) return "unknown";
  try {
    return new URL(startUrl).host;
  } catch {
    return "unknown";
  }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function matchesSince(recordedAt: string | undefined, sinceDays: number | undefined): boolean {
  if (!sinceDays) return true;
  if (!recordedAt) return false;
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const ts = Date.parse(recordedAt);
  return Number.isFinite(ts) && ts >= cutoff;
}

function dedupeSessions(sessions: LiveBenchmarkSession[]): LiveBenchmarkSession[] {
  const byId = new Map<string, LiveBenchmarkSession>();

  for (const session of sessions) {
    const existing = byId.get(session.sessionId);
    if (!existing) {
      byId.set(session.sessionId, session);
      continue;
    }

    const existingTs = existing.recordedAt ? Date.parse(existing.recordedAt) : 0;
    const nextTs = session.recordedAt ? Date.parse(session.recordedAt) : 0;
    if (nextTs >= existingTs) {
      byId.set(session.sessionId, session);
    }
  }

  return [...byId.values()];
}

function collectPendingSessionLogs(finalizedSessionIds: Set<string>) {
  if (!existsSync(LOG_DIR)) return [];

  const files = readdirSync(LOG_DIR).filter(
    (file) => file.startsWith("session-") && file.endsWith(".jsonl"),
  );
  const pending: Array<{
    sessionId: string;
    recordedAt?: string;
    startUrl?: string;
    turnCount?: number;
  }> = [];

  for (const file of files) {
    const sessionId = file.slice("session-".length, -".jsonl".length);
    if (finalizedSessionIds.has(sessionId)) continue;

    try {
      const lines = readFileSync(join(LOG_DIR, file), "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean);
      if (lines.length === 0) continue;

      let recordedAt: string | undefined;
      let startUrl: string | undefined;
      let maxTurn = 0;

      for (const line of lines) {
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }

        if (!recordedAt && typeof entry.ts === "string") {
          recordedAt = entry.ts;
        }
        const data = isRecordObject(entry.data) ? entry.data : null;
        if (data && typeof data.url === "string") {
          startUrl = data.url;
        }
        if (data && typeof data.turn === "number" && data.turn > maxTurn) {
          maxTurn = data.turn;
        }
      }

      pending.push({
        sessionId,
        recordedAt,
        startUrl,
        turnCount: maxTurn > 0 ? maxTurn : undefined,
      });
    } catch {
      continue;
    }
  }

  pending.sort((a, b) => {
    const aTs = a.recordedAt ? Date.parse(a.recordedAt) : 0;
    const bTs = b.recordedAt ? Date.parse(b.recordedAt) : 0;
    return bTs - aTs;
  });

  return pending;
}

export function collectLiveBenchmarkSessions(
  options: LiveBenchmarkOptions = {},
): LiveBenchmarkSession[] {
  const entries = [...readSessionIndex(), ...readSessionFiles()]
    .map((entry) => parseSession(entry))
    .filter((entry): entry is LiveBenchmarkSession => entry !== null);

  let sessions = dedupeSessions(entries).filter((entry) =>
    matchesSince(entry.recordedAt, options.sinceDays)
  );

  if (options.onlyLocalhost) {
    sessions = sessions.filter((entry) => {
      const host = parseHost(entry.startUrl);
      return host.startsWith("127.0.0.1") || host.startsWith("localhost");
    });
  }

  if (options.queryContains) {
    const needle = options.queryContains.toLowerCase();
    sessions = sessions.filter((entry) => entry.query.toLowerCase().includes(needle));
  }

  if (options.sourceContains) {
    const needle = options.sourceContains.toLowerCase();
    sessions = sessions.filter((entry) => (entry.startUrl ?? "").toLowerCase().includes(needle));
  }

  sessions.sort((a, b) => {
    const aTs = a.recordedAt ? Date.parse(a.recordedAt) : 0;
    const bTs = b.recordedAt ? Date.parse(b.recordedAt) : 0;
    return bTs - aTs;
  });

  if (options.limit && options.limit > 0) {
    sessions = sessions.slice(0, options.limit);
  }

  return sessions;
}

export function summarizeLiveBenchmarkSessions(
  sessions: LiveBenchmarkSession[],
): LiveBenchmarkSummary {
  const outcomeCounts: Record<string, number> = {};
  const failureCategoryCounts: Record<string, number> = {};
  const hostCounts: Record<string, number> = {};
  const turns: number[] = [];
  const llmCalls: number[] = [];
  const sessionTimes: number[] = [];
  const llmTimes: number[] = [];
  const estimatedCosts: number[] = [];
  const requestedToolCounts: number[] = [];
  const executedToolsPerTurn: number[] = [];
  const filteredToolCounts: number[] = [];
  let totalToolProfileAppliedTurns = 0;
  let groundingMismatchCount = 0;
  let invalidIdRecoveryHintCount = 0;
  let blockedByPolicyCount = 0;
  let safetyBlockedCount = 0;
  let stagnationSignalCount = 0;
  let sameUrlEscalationCount = 0;
  let strategyPivotCount = 0;
  let deadEndPivotCount = 0;
  let zeroEffectWarningCount = 0;
  let redundantActionNudgeCount = 0;
  let providerFailureSessions = 0;
  let nonProviderSessions = 0;
  let nonProviderCompletedSessions = 0;
  const pendingSessions = collectPendingSessionLogs(new Set(sessions.map((session) => session.sessionId)));

  for (const session of sessions) {
    outcomeCounts[session.outcome] = (outcomeCounts[session.outcome] ?? 0) + 1;

    const failureKey = session.failureCategory && session.failureCategory !== "none"
      ? session.failureCategory
      : null;
    if (failureKey) {
      failureCategoryCounts[failureKey] = (failureCategoryCounts[failureKey] ?? 0) + 1;
    }
    const isProviderFailure = session.failureCategory === "provider";
    if (isProviderFailure) {
      providerFailureSessions++;
    } else {
      nonProviderSessions++;
      if (session.outcome === "completed") {
        nonProviderCompletedSessions++;
      }
    }

    const host = parseHost(session.startUrl);
    hostCounts[host] = (hostCounts[host] ?? 0) + 1;

    if (typeof session.turnCount === "number") turns.push(session.turnCount);
    if (typeof session.metrics?.llmCallCount === "number") llmCalls.push(session.metrics.llmCallCount);
    if (typeof session.metrics?.totalSessionTimeMs === "number") sessionTimes.push(session.metrics.totalSessionTimeMs);
    if (typeof session.metrics?.totalLlmTimeMs === "number") llmTimes.push(session.metrics.totalLlmTimeMs);

    const estimatedCost = session.metrics?.totalCostActual && session.metrics.totalCostActual > 0
      ? session.metrics.totalCostActual
      : session.metrics?.totalCostEstimated;
    if (typeof estimatedCost === "number") estimatedCosts.push(estimatedCost);

    if (typeof session.controller?.avgToolCount === "number") {
      requestedToolCounts.push(session.controller.avgToolCount);
    }
    if (typeof session.controller?.avgExecutedToolsPerTurn === "number") {
      executedToolsPerTurn.push(session.controller.avgExecutedToolsPerTurn);
    }
    if (typeof session.controller?.toolProfileAvgFilteredCount === "number") {
      filteredToolCounts.push(session.controller.toolProfileAvgFilteredCount);
    }
    totalToolProfileAppliedTurns += session.controller?.toolProfileAppliedTurns ?? 0;
    groundingMismatchCount += session.controller?.groundingMismatchCount ?? 0;
    invalidIdRecoveryHintCount += session.controller?.invalidIdRecoveryHintCount ?? 0;
    blockedByPolicyCount += session.controller?.blockedByPolicyCount ?? 0;
    safetyBlockedCount += session.controller?.safetyBlockedCount ?? 0;
    stagnationSignalCount += session.controller?.stagnationSignalCount ?? 0;
    sameUrlEscalationCount += session.controller?.sameUrlEscalationCount ?? 0;
    strategyPivotCount += session.controller?.strategyPivotCount ?? 0;
    deadEndPivotCount += session.controller?.deadEndPivotCount ?? 0;
    zeroEffectWarningCount += session.controller?.zeroEffectWarningCount ?? 0;
    redundantActionNudgeCount += session.controller?.redundantActionNudgeCount ?? 0;
  }

  const completedSessions = sessions.filter((session) => session.outcome === "completed").length;
  const totalSessions = sessions.length;

  return {
    totalSessions,
    completedSessions,
    successRate: totalSessions === 0 ? 0 : completedSessions / totalSessions,
    nonProviderSessions,
    nonProviderCompletedSessions,
    nonProviderSuccessRate:
      nonProviderSessions === 0 ? 0 : nonProviderCompletedSessions / nonProviderSessions,
    providerFailureSessions,
    outcomeCounts,
    failureCategoryCounts,
    avgTurns: mean(turns),
    medianTurns: median(turns),
    avgLlmCalls: mean(llmCalls),
    avgSessionTimeMs: mean(sessionTimes),
    avgLlmTimeMs: mean(llmTimes),
    avgEstimatedCost: mean(estimatedCosts),
    hostCounts,
    controller: {
      avgRequestedToolCount: mean(requestedToolCounts),
      avgExecutedToolsPerTurn: mean(executedToolsPerTurn),
      totalToolProfileAppliedTurns,
      avgFilteredToolCount: mean(filteredToolCounts),
      groundingMismatchCount,
      invalidIdRecoveryHintCount,
      blockedByPolicyCount,
      safetyBlockedCount,
      stagnationSignalCount,
      sameUrlEscalationCount,
      strategyPivotCount,
      deadEndPivotCount,
      zeroEffectWarningCount,
      redundantActionNudgeCount,
    },
    pendingSessions,
    sessions,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMs(value: number): string {
  if (value <= 0) return "0ms";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function topEntries(counts: Record<string, number>, limit = 5): Array<[string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

export function buildLiveBenchmarkReport(
  summary: LiveBenchmarkSummary,
  options: LiveBenchmarkOptions = {},
): string {
  const lines: string[] = [];
  lines.push("# Live Benchmark Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(`- Sessions analyzed: ${summary.totalSessions}`);
  lines.push("- Source: `traces/index.jsonl` + raw `traces/*.jsonl` fallback");
  if (options.onlyLocalhost) lines.push("- Filter: localhost/fixture sessions only");
  if (options.limit) lines.push(`- Limit: latest ${options.limit} session(s)`);
  if (options.sinceDays) lines.push(`- Recency window: last ${options.sinceDays} day(s)`);
  if (options.queryContains) lines.push(`- Query filter: contains \`${options.queryContains}\``);
  if (options.sourceContains) lines.push(`- URL filter: contains \`${options.sourceContains}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Success rate | ${formatPercent(summary.successRate)} (${summary.completedSessions}/${summary.totalSessions}) |`);
  lines.push(`| Success rate (excluding provider failures) | ${formatPercent(summary.nonProviderSuccessRate)} (${summary.nonProviderCompletedSessions}/${summary.nonProviderSessions}) |`);
  lines.push(`| Provider-failure sessions | ${summary.providerFailureSessions} |`);
  lines.push(`| Avg turns | ${summary.avgTurns.toFixed(1)} |`);
  lines.push(`| Median turns | ${summary.medianTurns.toFixed(1)} |`);
  lines.push(`| Avg LLM calls | ${summary.avgLlmCalls.toFixed(1)} |`);
  lines.push(`| Avg session time | ${formatMs(summary.avgSessionTimeMs)} |`);
  lines.push(`| Avg LLM time | ${formatMs(summary.avgLlmTimeMs)} |`);
  lines.push(`| Avg cost | $${summary.avgEstimatedCost.toFixed(6)} |`);
  lines.push(`| Avg requested tools/turn | ${summary.controller.avgRequestedToolCount.toFixed(1)} |`);
  lines.push(`| Avg executed tools/turn | ${summary.controller.avgExecutedToolsPerTurn.toFixed(1)} |`);
  lines.push(`| Unfinalized session logs | ${summary.pendingSessions.length} |`);
  lines.push("");
  lines.push("## Controller Metrics");
  lines.push("");
  lines.push(`- Tool-profile-applied turns: ${summary.controller.totalToolProfileAppliedTurns}`);
  lines.push(`- Avg filtered tool count: ${summary.controller.avgFilteredToolCount.toFixed(1)}`);
  lines.push(`- Grounding mismatches: ${summary.controller.groundingMismatchCount}`);
  lines.push(`- Invalid-ID recovery hints: ${summary.controller.invalidIdRecoveryHintCount}`);
  lines.push(`- Blocked-by-policy tool results: ${summary.controller.blockedByPolicyCount}`);
  lines.push(`- Safety-gate blocks: ${summary.controller.safetyBlockedCount}`);
  lines.push(`- Stagnation signals: ${summary.controller.stagnationSignalCount}`);
  lines.push(`- Same-URL escalations: ${summary.controller.sameUrlEscalationCount}`);
  lines.push(`- Strategy pivots: ${summary.controller.strategyPivotCount}`);
  lines.push(`- Dead-end pivots: ${summary.controller.deadEndPivotCount}`);
  lines.push(`- Zero-effect warnings: ${summary.controller.zeroEffectWarningCount}`);
  lines.push(`- Redundant-action nudges: ${summary.controller.redundantActionNudgeCount}`);
  if (summary.pendingSessions.length > 0) {
    lines.push("");
    lines.push("## Unfinalized Session Logs");
    lines.push("");
    lines.push(
      "These sessions have `logs/session-*.jsonl` telemetry but no finalized `agent.session` manifest yet, so they are excluded from success-rate math.",
    );
    lines.push("");
    for (const pending of summary.pendingSessions.slice(0, 5)) {
      const host = parseHost(pending.startUrl);
      const turnPart = typeof pending.turnCount === "number" ? `, ${pending.turnCount} turn(s)` : "";
      lines.push(`- \`${pending.sessionId}\` (${host}${turnPart})`);
    }
  }
  lines.push("");
  lines.push("## Outcomes");
  lines.push("");
  for (const [outcome, count] of topEntries(summary.outcomeCounts, 10)) {
    lines.push(`- \`${outcome}\`: ${count}`);
  }
  if (Object.keys(summary.outcomeCounts).length === 0) {
    lines.push("- No sessions matched the filters.");
  }
  lines.push("");
  lines.push("## Failure Categories");
  lines.push("");
  if (Object.keys(summary.failureCategoryCounts).length === 0) {
    lines.push("- No explicit failure categories in the selected sessions.");
  } else {
    for (const [category, count] of topEntries(summary.failureCategoryCounts, 10)) {
      lines.push(`- \`${category}\`: ${count}`);
    }
  }
  lines.push("");
  lines.push("## Hosts");
  lines.push("");
  for (const [host, count] of topEntries(summary.hostCounts, 10)) {
    lines.push(`- \`${host}\`: ${count}`);
  }
  if (Object.keys(summary.hostCounts).length === 0) {
    lines.push("- No host data.");
  }
  lines.push("");
  lines.push("## Recent Sessions");
  lines.push("");
  lines.push("| Recorded | Session | Outcome | Turns | Cost | Tools/turn | Profile turns | URL |");
  lines.push("|----------|---------|---------|-------|------|------------|---------------|-----|");
  for (const session of summary.sessions.slice(0, 15)) {
    const cost = session.metrics?.totalCostActual && session.metrics.totalCostActual > 0
      ? session.metrics.totalCostActual
      : session.metrics?.totalCostEstimated;
    lines.push(
      `| ${session.recordedAt ?? "unknown"} | ${session.sessionId} | ${session.outcome} | ${session.turnCount ?? "?"} | $${(cost ?? 0).toFixed(6)} | ${(session.controller?.avgToolCount ?? 0).toFixed(1)} | ${session.controller?.toolProfileAppliedTurns ?? 0} | ${session.startUrl ?? "unknown"} |`,
    );
  }
  if (summary.sessions.length === 0) {
    lines.push("| none | none | none | none | none | none | none | none |");
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This benchmark measures recorded live sessions, not replay-only critique turns.");
  lines.push("- Use it as the primary runtime KPI alongside `critique-recovery`, not as a replacement for targeted pathology diagnostics.");
  return lines.join("\n");
}

export function writeLiveBenchmarkReport(report: string): string {
  const reportsDir = join(TRACE_DIR, "..", "evals", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(reportsDir, `live-benchmark-${stamp}.md`);
  writeFileSync(path, report, "utf-8");
  return path;
}
