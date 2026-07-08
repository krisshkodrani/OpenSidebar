/**
 * High-risk judge-gate runner (RFC LP-16 Phase 5). Runs the verifier's judge
 * gate against the trusted corpus for a high-risk completion. Pure — verbatim
 * movement of the Orchestrator helper.
 */
import { logger } from "../../utils";
import { getTrustedCorpusStore } from "../memory/corpus-runtime";
import {
  corpusEntryToFactRef,
  type JudgeGateOutcome,
} from "../agent/completion/judge-gate";
import type { VerifierLike } from "./lane-types";
import type { OrchestratorTask, StructuredEvidence, TaskNode } from "./types";

export async function runHighRiskJudgeGate(
  task: OrchestratorTask,
  node: TaskNode,
  verifier: VerifierLike,
  evidence: StructuredEvidence[],
  summary: string,
): Promise<JudgeGateOutcome | null> {
  if (!verifier.judgeGate) return null;
  try {
    const entries = await getTrustedCorpusStore().load();
    const corpusFacts = entries
      .filter(
        (entry) =>
          entry.kind === "personal_profile_fact" ||
          entry.kind === "extracted_fact",
      )
      .map(corpusEntryToFactRef);
    const evidenceLines = evidence
      .map((item) => item.claim ?? item.event?.detail ?? item.event?.type ?? "")
      .filter((line): line is string => Boolean(line));
    return await verifier.judgeGate({
      claim: node.description,
      successCriteria: node.successCriteria,
      evidence: evidenceLines.length > 0 ? evidenceLines : [summary],
      corpusFacts,
    });
  } catch (error) {
    logger.warn(
      "orchestrator",
      "High-risk judge gate failed; keeping the verifier accept",
      { taskId: task.id, nodeId: node.id, error },
    );
    return null;
  }
}
