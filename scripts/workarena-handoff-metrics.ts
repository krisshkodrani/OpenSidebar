import { existsSync, readFileSync } from "fs";

type JsonRecord = Record<string, unknown>;

export type TraceMetrics = {
  traceIds: string[];
  traceFiles: string[];
  finalAnswer: string | null;
  submittedRecordNumber: string | null;
  turns: number;
  perceptions: number;
  toolCalls: number;
  toolExecutions: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number;
};

export type TraceTerminal = {
  ok: boolean;
  reason: "task_completed" | "task_failed";
  status: "completed" | "failed";
  outcome: string;
  summary: string | null;
  workspaceId: string;
  runId: string | null;
  sessionId: string | null;
  recordedAt: string | null;
  query: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function terminalStatusFromOutcome(
  outcome: string,
): Pick<TraceTerminal, "ok" | "reason" | "status"> | null {
  if (outcome === "completed") {
    return { ok: true, reason: "task_completed", status: "completed" };
  }
  if (
    outcome === "max_turns" ||
    outcome === "failed" ||
    outcome === "error" ||
    outcome === "stopped"
  ) {
    return { ok: false, reason: "task_failed", status: "failed" };
  }
  return null;
}

export function readTraceTerminalFromIndex(
  indexFilePath: string,
  workspaceId: string,
): TraceTerminal | null {
  if (!existsSync(indexFilePath)) return null;

  try {
    const lines = readFileSync(indexFilePath, "utf-8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const entry = JSON.parse(lines[index]) as JsonRecord;
      if (entry.traceKind !== "agent.session") continue;
      if (entry.workspaceId !== workspaceId) continue;
      const outcome =
        typeof entry.outcome === "string" ? entry.outcome.trim() : "";
      const terminal = terminalStatusFromOutcome(outcome);
      if (!terminal) continue;

      return {
        ...terminal,
        outcome,
        summary: typeof entry.summary === "string" ? entry.summary : null,
        workspaceId,
        runId: typeof entry.runId === "string" ? entry.runId : null,
        sessionId: typeof entry.sessionId === "string" ? entry.sessionId : null,
        recordedAt:
          typeof entry.recordedAt === "string" ? entry.recordedAt : null,
        query: typeof entry.query === "string" ? entry.query : null,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function safeParseArgs(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRejectedDoneTurn(entry: JsonRecord): boolean {
  const events = Array.isArray(entry.events) ? entry.events : [];
  return events.some((event) => {
    if (!isRecord(event)) return false;
    const type = String(event.type ?? "");
    return (
      type.startsWith("done_rejected") ||
      type.startsWith("done_blocked") ||
      type === "auto_advance_blocked"
    );
  });
}

function extractDoneSummary(traceFiles: string[]): string {
  let latestAccepted: {
    summary: string;
    timestamp: string;
    fileIndex: number;
    lineIndex: number;
  } | null = null;
  let latestRejected: {
    summary: string;
    timestamp: string;
    fileIndex: number;
    lineIndex: number;
  } | null = null;

  for (let fileIndex = 0; fileIndex < traceFiles.length; fileIndex += 1) {
    const filePath = traceFiles[fileIndex];
    if (!existsSync(filePath)) continue;
    try {
      const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const entry = JSON.parse(lines[lineIndex]) as JsonRecord;
        const llmResponse = isRecord(entry.llmResponse) ? entry.llmResponse : {};
        const toolCalls = Array.isArray(llmResponse.toolCalls) ? llmResponse.toolCalls : [];
        const rejected = isRejectedDoneTurn(entry);
        const timestamp = String(entry.recordedAt ?? entry.timestamp ?? entry.turnNumber ?? "");
        for (const toolCall of toolCalls) {
          if (!isRecord(toolCall)) continue;
          const fn = isRecord(toolCall.function) ? toolCall.function : {};
          const name = fn.name ?? toolCall.name;
          if (name !== "done") continue;
          const args =
            typeof fn.arguments === "string"
              ? safeParseArgs(fn.arguments)
              : isRecord(toolCall.args)
                ? toolCall.args
                : {};
          const value =
            typeof args.summary === "string" && args.summary.trim()
              ? args.summary
              : typeof args.message === "string" && args.message.trim()
                ? args.message
                : "";
          const summary = value.trim();
          if (!summary) continue;
          const candidate = { summary, timestamp, fileIndex, lineIndex };
          if (rejected) {
            if (
              !latestRejected ||
              candidate.timestamp >= latestRejected.timestamp ||
              (candidate.timestamp === latestRejected.timestamp &&
                (candidate.fileIndex > latestRejected.fileIndex ||
                  candidate.lineIndex > latestRejected.lineIndex))
            ) {
              latestRejected = candidate;
            }
            continue;
          }
          if (
            !latestAccepted ||
            candidate.timestamp >= latestAccepted.timestamp ||
            (candidate.timestamp === latestAccepted.timestamp &&
              (candidate.fileIndex > latestAccepted.fileIndex ||
                candidate.lineIndex > latestAccepted.lineIndex))
          ) {
            latestAccepted = candidate;
          }
        }
      }
    } catch {
      continue;
    }
  }

  return latestAccepted?.summary ?? latestRejected?.summary ?? "";
}

export function normalizeRecordNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^[A-Z]{2,}\d+$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9a-f]{32}$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

export function extractSubmittedRecordNumberFromText(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const direct = value.match(
    /\bSubmit advanced from populated record\s+([A-Z]{2,}\d+)\s+to\s+fresh record form\b/i,
  );
  if (direct) return normalizeRecordNumber(direct[1]);

  const serviceNowForm = value.match(
    /\bSubmitted ServiceNow form record:\s*([A-Z]{2,}\d+)\b/i,
  );
  if (serviceNowForm) return normalizeRecordNumber(serviceNowForm[1]);

  const serviceNowFormSysId = value.match(
    /\bSubmitted ServiceNow form sys_id:\s*([0-9a-f]{32})\b/i,
  );
  if (serviceNowFormSysId) return normalizeRecordNumber(serviceNowFormSysId[1]);

  const catalogRequest = value.match(
    /\b(?:Request Number|Order Status)\s*:?\s*(REQ\d+)\b/i,
  );
  if (catalogRequest) return normalizeRecordNumber(catalogRequest[1]);

  const fallback = value.match(
    /\bpreviousRecordId["'\s:]+([A-Z]{2,}\d+|[0-9a-f]{32})\b/i,
  );
  return fallback ? normalizeRecordNumber(fallback[1]) : null;
}

export function submittedRecordNumberFromEvents(events: unknown): string | null {
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    if (!isRecord(event) || event.type !== "submit_form_reset_success") continue;
    const data = isRecord(event.data) ? event.data : {};
    const direct = normalizeRecordNumber(data.previousRecordId);
    if (direct) return direct;
    const reason = extractSubmittedRecordNumberFromText(data.reason);
    if (reason) return reason;
  }
  return null;
}

function submittedRecordNumberFromTraceEntry(entry: JsonRecord): string | null {
  const eventRecord = submittedRecordNumberFromEvents(entry.events);
  if (eventRecord) return eventRecord;

  const toolExecutions = Array.isArray(entry.toolExecutions) ? entry.toolExecutions : [];
  for (const execution of toolExecutions) {
    if (!isRecord(execution)) continue;
    const resultRecord = extractSubmittedRecordNumberFromText(execution.result);
    if (resultRecord) return resultRecord;
    const errorRecord = extractSubmittedRecordNumberFromText(execution.error);
    if (errorRecord) return errorRecord;
  }

  const llmRequest = isRecord(entry.llmRequest) ? entry.llmRequest : {};
  const messages = Array.isArray(llmRequest.messages) ? llmRequest.messages : [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const messageRecord = extractSubmittedRecordNumberFromText(message.content);
    if (messageRecord) return messageRecord;
  }

  const llmResponse = isRecord(entry.llmResponse) ? entry.llmResponse : {};
  const responseRecord = extractSubmittedRecordNumberFromText(llmResponse.content);
  if (responseRecord) return responseRecord;

  return null;
}

export function readTraceMetrics(traceFiles: string[]): TraceMetrics {
  let input = 0;
  let output = 0;
  let total = 0;
  let costUsd = 0;
  let toolCalls = 0;
  let toolExecutions = 0;
  let perceptions = 0;
  let submittedRecordNumber: string | null = null;
  let turns = 0;
  const traceIds = new Set<string>();

  for (const filePath of traceFiles) {
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, "utf-8").trim().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as JsonRecord;
        turns++;
        if (typeof entry.runId === "string") traceIds.add(entry.runId);
        submittedRecordNumber =
          submittedRecordNumber ?? submittedRecordNumberFromTraceEntry(entry);
        const llmResponse = isRecord(entry.llmResponse) ? entry.llmResponse : {};
        const usage = isRecord(llmResponse.usage) ? llmResponse.usage : {};
        input += Number(usage.prompt_tokens ?? 0);
        output += Number(usage.completion_tokens ?? 0);
        total += Number(usage.total_tokens ?? 0);
        costUsd += Number(usage.cost ?? 0);
        toolCalls += Array.isArray(llmResponse.toolCalls) ? llmResponse.toolCalls.length : 0;
        toolExecutions += Array.isArray(entry.toolExecutions) ? entry.toolExecutions.length : 0;
        const llmRequest = isRecord(entry.llmRequest) ? entry.llmRequest : {};
        const messages = Array.isArray(llmRequest.messages) ? llmRequest.messages : [];
        if (
          messages.some(
            (message) =>
              isRecord(message) &&
              typeof message.content === "string" &&
              message.content.includes("Page Interpretation"),
          )
        ) {
          perceptions++;
        }
      } catch {
        // Ignore malformed trace lines in metrics aggregation.
      }
    }
  }

  return {
    traceIds: [...traceIds].sort(),
    traceFiles,
    finalAnswer: extractDoneSummary(traceFiles) || null,
    submittedRecordNumber,
    turns,
    perceptions,
    toolCalls,
    toolExecutions,
    tokens: { input, output, total },
    costUsd,
  };
}
