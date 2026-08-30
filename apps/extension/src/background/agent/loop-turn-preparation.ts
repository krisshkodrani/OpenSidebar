import { listPromptDescriptors } from "../../prompts";
import type { ToolDefinition } from "../../types";
import type { DomSnapshot } from "../../types";
import type { logger } from "../../utils";
import type { LLMClient } from "../llm";
import type { LLMMessage } from "../llm/types";
import { buildElementSummary } from "../perception";
import type { PageStateCoordinator } from "./page-state";
import type { ContextManager } from "./context";
import type { ContextMetrics } from "./context-types";
import {
  buildDomPromptDeltaMetrics,
  buildPromptSectionMetrics,
  buildStructuredRuntimeStateShadowMetrics,
  resolveContextModeTelemetry,
} from "./context-economy";
import {
  comparePromptPrefix,
  fingerprintPrompt,
  type PromptPrefixFingerprint,
} from "./prompt-prefix-telemetry";
import { TraceRecorder } from "./trace";
import { withToolCapabilityCatalog } from "./tool-capabilities";

type TurnPreparationLogger = Pick<typeof logger, "info">;

/**
 * Identity of the executor system-prompt template, resolved once at module load
 * (the generated registry is static, so it cannot change within a run).
 * Recorded per turn so cache analysis can refuse to compare populations built
 * from different prompts — the template IS the cached prefix.
 */
const SYSTEM_PROMPT_IDENTITY = listPromptDescriptors(["agent.system"])[0];

export type LlmTurnPreparationDeps = {
  turnCount: number;
  previousElementCount: number;
  context: Pick<
    ContextManager,
    | "getPrompt"
    | "getPromptMetricsFrom"
    | "getSnapshot"
    | "getHistoryLength"
    | "consumePrefixReset"
  >;
  allTools: ToolDefinition[];
  selectTools: (tools: ToolDefinition[]) => ToolDefinition[];
  llm: Pick<LLMClient, "getCurrentModel" | "isPlannerTier">;
  perception: Pick<
    PageStateCoordinator,
    | "getInterpretation"
    | "getLastTraceMeta"
    | "getLastTraceStats"
    | "getLastScreenshot"
  >;
  log: TurnPreparationLogger;
  traceRecorder: TraceRecorder | null;
  previousSnapshotForDelta?: DomSnapshot | null;
  /** Previous turn's prompt fingerprint, for LP-21 §9 divergence measurement. */
  previousPromptFingerprint?: PromptPrefixFingerprint | null;
};

export type LlmTurnPreparationResult = {
  messages: LLMMessage[];
  tools: ToolDefinition[];
  metrics: ContextMetrics;
  previousElementCount: number;
  /** Carry this into the next turn's `previousPromptFingerprint`. */
  promptFingerprint: PromptPrefixFingerprint;
};

export async function prepareLlmTurnRequest(
  deps: LlmTurnPreparationDeps,
): Promise<LlmTurnPreparationResult> {
  const tools = deps.selectTools(deps.allTools);
  // Kept separately: the catalog appended by #107 is a synthetic trailing
  // message, not conversation history, so history-derived counts below must be
  // taken from the pre-injection prompt or they silently drift by one.
  const promptWithoutCatalog = deps.context.getPrompt();
  const messages = withToolCapabilityCatalog(promptWithoutCatalog, tools);
  const metrics = deps.context.getPromptMetricsFrom(messages);
  const previousElementCount =
    deps.previousElementCount < 0
      ? metrics.elementCount
      : deps.previousElementCount;

  // LP-21 §9. Computed unconditionally — the fingerprint has to carry to the
  // next turn whether or not a trace recorder is attached, and a divergence
  // measured only on traced runs would miss the runs we most want to explain.
  // Tools are fingerprinted too: the profile pipeline filters AND reorders the
  // array per turn, and providers serialize it ahead of every message — churn
  // there breaks the cache with zero message-level divergence to show for it.
  const promptFingerprint = fingerprintPrompt(messages, tools);
  const promptDivergence = comparePromptPrefix(
    deps.previousPromptFingerprint ?? null,
    promptFingerprint,
  );
  // Drained every turn, so a compaction's cost is attributed to exactly one turn.
  const prefixReset = deps.context.consumePrefixReset();

  deps.log.info("agent", "Context metrics", {
    turn: deps.turnCount,
    systemTokens: metrics.systemTokens,
    historyTokens: metrics.historyTokens,
    totalTokens: metrics.totalTokens,
    utilization: Math.round(metrics.utilization * 100) + "%",
    elements: metrics.elementCount,
    compression: metrics.compressionLevel,
    toolCount: tools.length,
    prefixStablePct: promptDivergence.stablePrefixPct,
    prefixDivergesIn: promptDivergence.firstDivergenceRegion,
    prefixToolsChange: promptDivergence.toolsChange,
    prefixReset: prefixReset?.cause,
  });

  if (deps.traceRecorder) {
    const snap = deps.context.getSnapshot();
    const systemContent =
      messages.length > 0 && messages[0].role === "system"
        ? typeof messages[0].content === "string"
          ? messages[0].content
          : ""
        : "";
    // How much of the SYSTEM message survived unchanged since last turn.
    // Previously `systemContent.indexOf("## Page Context")`, which reported a
    // real number only while page state lived inside message 0; LP-21 phase 2
    // moved it to a trailing message, so that lookup has silently returned -1
    // (recorded as 0) on every turn since. Derived from the actual cross-turn
    // diff now, so the trace viewer's cached/dynamic split means something.
    // Turn 1 has no previous prompt to have been cached against, so the honest
    // answer there is 0 rather than "the whole system message".
    const cachedPrefixLength = promptDivergence.isFirstTurn
      ? 0
      : promptDivergence.firstDivergenceRegion === "system"
        ? (promptDivergence.firstDivergenceOffset ?? 0)
        : systemContent.length;
    const droppedMessageCount = Math.max(
      0,
      deps.context.getHistoryLength() - (promptWithoutCatalog.length - 1),
    );
    const promptSections = buildPromptSectionMetrics({
      messages,
      estimatedPromptTokens: metrics.systemTokens + metrics.historyTokens,
    });
    const structuredRuntimeState = buildStructuredRuntimeStateShadowMetrics({
      promptSections,
      messages,
    });
    const contextMode = resolveContextModeTelemetry({
      messages,
      snapshot: snap,
    });
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
        promptPrefix: {
          digest: promptFingerprint.digest,
          firstDivergenceMessageIndex:
            promptDivergence.firstDivergenceMessageIndex,
          firstDivergenceOffset: promptDivergence.firstDivergenceOffset,
          firstDivergenceRegion: promptDivergence.firstDivergenceRegion,
          stablePrefixChars: promptDivergence.stablePrefixChars,
          stablePrefixPct: promptDivergence.stablePrefixPct,
          stablePrefixMessages: promptDivergence.stablePrefixMessages,
          totalChars: promptFingerprint.totalChars,
          toolsChange: promptDivergence.toolsChange,
          toolsCount: promptFingerprint.toolsCount ?? null,
          ...(prefixReset ? { prefixReset } : {}),
        },
        promptTemplate: {
          id: SYSTEM_PROMPT_IDENTITY.id,
          version: SYSTEM_PROMPT_IDENTITY.version,
          hash: SYSTEM_PROMPT_IDENTITY.hash,
        },
        promptSections,
        structuredRuntimeState,
        contextMode,
        domPromptDelta,
      },
      deps.llm.isPlannerTier() ? "planner" : "executor",
    );

    const interpretation = deps.perception.getInterpretation();
    const screenshot = deps.perception.getLastScreenshot();
    if (deps.turnCount === 1 && (interpretation || screenshot)) {
      const elSummary = snap ? buildElementSummary(snap.elements) : undefined;
      const perceptionMeta = deps.perception.getLastTraceMeta();
      const perceptionStats = deps.perception.getLastTraceStats();
      await deps.traceRecorder.recordPerception(
        {
          interpretation:
            interpretation ??
            "[VL mode] Screenshot sent directly to executor — no separate perception call.",
          ...perceptionStats,
          ...perceptionMeta,
        },
        screenshot || undefined,
        elSummary,
      );
    }
  }

  return {
    messages,
    tools,
    metrics,
    previousElementCount,
    promptFingerprint,
  };
}
