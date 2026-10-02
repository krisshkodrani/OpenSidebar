import type { LoopResult } from "../agent/loop-types";
import { compactExecutorSummaryForNode } from "./handoff";
import { appendHandoffArtifact } from "./task-messaging";
import type { StructuredEvidence, TaskNode } from "./types";

export function attachExecutorResultEvidence(
  node: TaskNode,
  result: LoopResult,
): { compactResultSummary: string; executorEvidence: StructuredEvidence[] } {
  const compactResultSummary = compactExecutorSummaryForNode(
    node,
    result.summary,
  );
  const executorEvidence: StructuredEvidence[] = [
    {
      claim: compactResultSummary || "Executor finished without summary.",
      basis: "tool_output",
      confidence: result.outcome === "completed" ? 1.0 : 0.5,
    },
    ...(result.trajectory ?? [])
      .filter((entry) => /\b(inspect_chart|read_page|read_element)\b/.test(entry))
      .slice(-4)
      .map((entry) => ({
        claim: entry,
        basis: "tool_output" as const,
        confidence: result.outcome === "completed" ? 0.85 : 0.5,
        sourceToolCall: entry.match(/\bT\d+:\s*([a-z_]+)/)?.[1],
      })),
    ...(result.evidence ?? []).map((event) => ({
      event,
      claim: `${event.type} from ${event.source}`,
      basis: "tool_output" as const,
      confidence:
        event.confidence === "high"
          ? 1
          : event.confidence === "medium"
            ? 0.75
            : 0.4,
      sourceToolCall: event.source,
    })),
    ...(result.completionEnvelope
      ? [
          {
            claim: `Completion envelope ${result.completionEnvelope.resultId} accepted by ${result.completionEnvelope.contractKind}: ${result.completionEnvelope.decisionReason}`,
            basis: "tool_output" as const,
            confidence: 1,
          },
        ]
      : []),
  ];
  appendHandoffArtifact(node, {
    role: "executor",
    phase: "executor_finished",
    note: result.summary.slice(0, 4000) || "Executor finished without summary.",
    evidence: executorEvidence,
  });
  return { compactResultSummary, executorEvidence };
}
