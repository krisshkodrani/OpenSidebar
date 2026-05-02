import {
  Citation,
  MessageSource,
  RiskLevel,
  RuntimeMessage,
  SessionMetrics,
  SubtaskResult,
  SubtaskSummary,
  ToolName,
} from "../../types";

type RuntimeEnvelopeKey = "requestId" | "source" | "workspaceId";

export type BroadcastMessage = RuntimeMessage extends infer Message
  ? Message extends RuntimeMessage
    ? Omit<Message, RuntimeEnvelopeKey>
    : never
  : never;

export function shouldBroadcastSessionMetrics(args: {
  showSessionMetrics: boolean;
  turnCount: number;
  interval: number;
}): boolean {
  if (!args.showSessionMetrics) return false;
  return args.turnCount === 1 || args.turnCount % args.interval === 0;
}

export function sessionMetricsSnapshot(args: {
  metrics: SessionMetrics;
  now: number;
  sessionStartTime: number;
}): SessionMetrics {
  return {
    ...args.metrics,
    totalSessionTimeMs: args.now - args.sessionStartTime,
  };
}

export function sessionMetricsMessage(
  metrics: SessionMetrics,
): BroadcastMessage {
  return {
    type: "SESSION_METRICS",
    payload: { ...metrics },
  };
}

export function taskProgressMessage(args: {
  taskId: string;
  subtasks: SubtaskSummary[];
  currentIndex: number;
  totalTurnsUsed: number;
}): BroadcastMessage {
  return {
    type: "TASK_PROGRESS",
    payload: {
      taskId: args.taskId,
      subtasks: args.subtasks,
      currentIndex: args.currentIndex,
      totalTurnsUsed: args.totalTurnsUsed,
    },
  };
}

export function approvalRequestMessage(args: {
  approvalId: string;
  toolName: ToolName;
  toolArgs: Record<string, unknown>;
  context: string;
  timeoutMs: number;
  workspaceId: string | null;
  requestId: string;
}): RuntimeMessage {
  return {
    type: "APPROVAL_REQUEST",
    requestId: args.requestId,
    source: MessageSource.BACKGROUND,
    workspaceId: args.workspaceId,
    payload: {
      approvalId: args.approvalId,
      toolName: args.toolName,
      args: args.toolArgs,
      risk: RiskLevel.HIGH,
      context: args.context,
      timeoutMs: args.timeoutMs,
    },
  } as RuntimeMessage;
}

export function clarificationRequestMessage(args: {
  clarificationId: string;
  question: string;
  suggestions?: string[];
  timeoutMs: number;
  workspaceId: string | null;
  requestId: string;
}): RuntimeMessage {
  return {
    type: "CLARIFICATION_REQUEST",
    requestId: args.requestId,
    source: MessageSource.BACKGROUND,
    workspaceId: args.workspaceId,
    payload: {
      clarificationId: args.clarificationId,
      question: args.question,
      suggestions: args.suggestions,
      timeoutMs: args.timeoutMs,
    },
  } as RuntimeMessage;
}

export function forwardSuppressedStreamChunk(
  msg: BroadcastMessage,
  onStreamChunk?: (
    delta: string,
    done: boolean,
    replaceContent?: string,
    thinking?: string,
  ) => void,
): void {
  if (msg.type !== "STREAM_CHUNK" || !onStreamChunk) return;
  onStreamChunk(
    msg.payload.delta,
    msg.payload.done,
    msg.payload.replaceContent,
    msg.payload.thinking,
  );
}

export function runtimeBroadcastMessage(args: {
  msg: BroadcastMessage;
  citations: Citation[];
  workspaceId: string | null;
  requestId: string;
}): RuntimeMessage {
  const msg =
    args.msg.type === "STREAM_CHUNK" &&
    args.msg.payload.done &&
    args.citations.length > 0
      ? {
          ...args.msg,
          payload: { ...args.msg.payload, citations: [...args.citations] },
        }
      : args.msg;

  return {
    ...msg,
    requestId: args.requestId,
    source: MessageSource.BACKGROUND,
    workspaceId: args.workspaceId,
  } as RuntimeMessage;
}

export function buildSubtaskResults(
  subtasks: Pick<
    SubtaskSummary,
    "description" | "status" | "turnsUsed" | "result"
  >[],
): SubtaskResult[] {
  return subtasks.map((st) => ({
    description: st.description,
    status:
      st.status === "completed"
        ? ("completed" as const)
        : st.status === "skipped"
          ? ("skipped" as const)
          : ("failed" as const),
    turnsUsed: st.turnsUsed,
    result: st.result || "",
  }));
}

export function planTerminationMessage(args: {
  taskId: string | null;
  subtasks: Pick<
    SubtaskSummary,
    "description" | "status" | "turnsUsed" | "result"
  >[];
  outcome: "stopped" | "max_turns" | "error";
  summary: string;
  turnCount: number;
  maxTurns: number;
  totalTimeMs: number;
  urlHistory: string[];
  metrics: SessionMetrics;
}): BroadcastMessage | null {
  if (!args.taskId || args.subtasks.length === 0) return null;

  const subtaskResults = buildSubtaskResults(args.subtasks);
  return {
    type: "TASK_COMPLETION",
    payload: {
      taskId: args.taskId,
      status: subtaskResults.some((r) => r.status === "completed")
        ? "partial"
        : "failed",
      totalTurnsUsed: args.turnCount,
      totalTimeMs: args.totalTimeMs,
      summary: args.summary,
      subtaskResults,
      urlHistory: args.urlHistory,
      metrics: args.metrics,
      terminationReason:
        args.outcome === "stopped"
          ? "Stopped by user"
          : args.outcome === "max_turns"
            ? `Turn limit reached (${args.turnCount}/${args.maxTurns})`
            : args.summary,
    },
  };
}
