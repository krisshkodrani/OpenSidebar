import type { LLMMessage } from "../llm/types";
import type { CompressedHistory } from "./checkpoint-types";
import { summarizeHistory } from "./context-formatting";
import type { HistoryLog } from "./context-history";
import type { ObservationMemory } from "./observation-memory";

export function exportContextHistory(
  log: HistoryLog,
  observations: ObservationMemory,
  recentWindow: number,
): CompressedHistory {
  const full = log.fullLog;
  const recent = full.slice(-recentWindow);
  const older = full.slice(0, Math.max(0, full.length - recentWindow));
  return {
    recentMessages: [...recent],
    olderSummaries: summarizeHistory([...older], 30),
    originalCount: full.length,
    pageObservations: observations.export(),
  };
}

export function restoreContextHistory(
  log: HistoryLog,
  observations: ObservationMemory,
  checkpoint: CompressedHistory,
): void {
  const summaries: LLMMessage[] =
    checkpoint.olderSummaries.length > 0
      ? [
          {
            role: "system",
            content: `Prior turns (compressed, ${checkpoint.originalCount - checkpoint.recentMessages.length} messages):\n${checkpoint.olderSummaries.join("\n")}`,
          },
        ]
      : [];
  log.restore([...summaries, ...checkpoint.recentMessages]);
  observations.restore(checkpoint.pageObservations);
}
