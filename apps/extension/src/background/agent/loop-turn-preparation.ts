import type { ToolDefinition } from "../../types";
import type { DomSnapshot } from "../../types";
import type { logger } from "../../utils";
import type { LLMClient } from "../llm";
import type { LLMMessage } from "../llm/types";
import { buildElementSummary } from "../perception";
import type { PerceptionAgent } from "../perception/perception-agent";
import type { ContextManager } from "./context";
import type { ContextMetrics } from "./context-types";
import {
  buildDomPromptDeltaMetrics,
  buildPromptSectionMetrics,
  buildStructuredRuntimeStateShadowMetrics,
  resolveContextModeTelemetry,
} from "./context-economy";
import { TraceRecorder } from "./trace";
import { withToolCapabilityCatalog } from "./tool-capabilities";

type TurnPreparationLogger = Pick<typeof logger, "info">;

export type LlmTurnPreparationDeps = {
  turnCount: number;
  previousElementCount: number;
  context: Pick<
    ContextManager,
    "getPrompt" | "getPromptMetricsFrom" | "getSnapshot" | "getHistoryLength"
  >;
  allTools: ToolDefinition[];
  selectTools: (tools: ToolDefinition[]) => ToolDefinition[];
  llm: Pick<LLMClient, "getCurrentModel" | "isPlannerTier">;
  perception: Pick<
    PerceptionAgent,
    | "getInterpretation"
    | "getLastTraceMeta"
    | "getLastTraceStats"
    | "getLastScreenshot"
  >;
  log: TurnPreparationLogger;
  traceRecorder: TraceRecorder | null;
  previousSnapshotForDelta?: DomSnapshot | null;
};

export type LlmTurnPreparationResult = {
  messages: LLMMessage[];
  tools: ToolDefinition[];
  metrics: ContextMetrics;
  previousElementCount: number;
};

export async function prepareLlmTurnRequest(
  deps: LlmTurnPreparationDeps,
): Promise<LlmTurnPreparationResult> {
  const tools = deps.selectTools(deps.allTools);
  const messages = withToolCapabilityCatalog(deps.context.getPrompt(), tools);
  const metrics = deps.context.getPromptMetricsFrom(messages);
  const previousElementCount =
    deps.previousElementCount < 0
      ? metrics.elementCount
      : deps.previousElementCount;

  deps.log.info("agent", "Context metrics", {
    turn: deps.turnCount,
    systemTokens: metrics.systemTokens,
    historyTokens: metrics.historyTokens,
    totalTokens: metrics.totalTokens,
    utilization: Math.round(metrics.utilization * 100) + "%",
    elements: metrics.elementCount,
    compression: metrics.compressionLevel,
    toolCount: tools.length,
  });

  if (deps.traceRecorder) {
    const snap = deps.context.getSnapshot();
    const systemContent =
      messages.length > 0 && messages[0].role === "system"
        ? typeof messages[0].content === "string"
          ? messages[0].content
          : ""
        : "";
    const cachedPrefixLength = systemContent.indexOf("## Page Context");
    const droppedMessageCount = Math.max(
      0,
      deps.context.getHistoryLength() - (messages.length - 1),
    );
    const promptSections = buildPromptSectionMetrics({
      messages,
      estimatedPromptTokens: metrics.systemTokens + metrics.historyTokens,
    });
    const structuredRuntimeState = buildStructuredRuntimeStateShadowMetrics({
      promptSections,
      messages,
    });
    const contextMode = resolveContextModeTelemetry({ messages, snapshot: snap });
    const domPromptDelta = buildDomPromptDeltaMetrics({
      previous: deps.previousSnapshotForDelta ?? null,
      current: snap ?? null,
      cause: deps.previousSnapshotForDelta ? "last_action" : "unknown",
    });

    deps.traceRecorder.startTurn(
      deps.turnCount,
      {
        url: snap?.url || "",
        title: snap?.title || "",
        elementCount: metrics.elementCount,
        visibleContentLength: snap?.visibleContent?.length || 0,
        pageContentLength: snap?.pageContent?.length || 0,
        scrollY: snap?.scroll?.y || 0,
      },
      snap?.elements || [],
      metrics.systemTokens + metrics.historyTokens,
      tools.length,
      deps.llm.getCurrentModel(),
      metrics.compressionLevel,
      TraceRecorder.toTraceMessages(messages),
      {
        systemTokens: metrics.systemTokens,
        historyTokens: metrics.historyTokens,
        totalTokens: metrics.totalTokens,
        maxTokens: metrics.maxTokens,
        utilization: metrics.utilization,
        droppedMessageCount,
        compressionLevel: metrics.compressionLevel,
        cachedPrefixLength: cachedPrefixLength >= 0 ? cachedPrefixLength : 0,
        promptSections,
        structuredRuntimeState,
        contextMode,
        domPromptDelta,
      },
      deps.llm.isPlannerTier() ? "planner" : "executor",
    );

    const interpretation = deps.perception.getInterpretation();
    if (deps.turnCount === 1 && interpretation) {
      const elSummary = snap ? buildElementSummary(snap.elements) : undefined;
      const perceptionMeta = deps.perception.getLastTraceMeta();
      const perceptionStats = deps.perception.getLastTraceStats();
      await deps.traceRecorder.recordPerception(
        {
          interpretation,
          ...perceptionStats,
          ...perceptionMeta,
        },
        deps.perception.getLastScreenshot() || undefined,
        elSummary,
      );
    }
  }

  return {
    messages,
    tools,
    metrics,
    previousElementCount,
  };
}
