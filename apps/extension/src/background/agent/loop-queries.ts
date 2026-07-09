/**
 * Pure read-only queries over agent/loop state (RFC LP-16 Phase 3b — loop.ts
 * landmine decomposition).
 *
 * Small side-effect-free predicates, getters, and resume-interaction lookups
 * that `loop()` and its helpers consult but which own no state. Relocated
 * verbatim from AgentLoop via the dispatch-host idiom (callers pass `this`);
 * behavior-preserving.
 */

import type { ToolName, DomSnapshot } from "../../types";
import type { RuntimeLimits } from "./constants";
import type {
  PendingApprovalInteraction,
  PendingClarificationInteraction,
  PendingUserInteraction,
} from "./loop-types";
import { buildMutationKey } from "./checkpoint-types";

export interface LoopQueriesHost {
  readonly limits: RuntimeLimits;
  readonly doneRejections: number;
  readonly llm: { isPlannerTier(): boolean };
  readonly originalQuery: string;
  readonly planSteps: ReadonlyArray<{
    objective?: string;
    successCriteria?: string;
  }>;
  readonly planSubtasks: ReadonlyArray<{
    status: string;
    description?: string;
  }>;
  readonly context: {
    getPlanStatusRaw?(): { currentIndex?: number } | null | undefined;
    getSnapshot?(): DomSnapshot | null | undefined;
  };
  readonly lastPlanIndex: number;
  readonly resumeInteraction: PendingUserInteraction | null;
  readonly guardAfterDoneRejection: boolean;
  readonly checkpoints: {
    lookupReplay(
      toolName: ToolName,
      args: Record<string, unknown>,
      snapshot: DomSnapshot | null,
      guardAfterDoneRejection: boolean,
    ): { result: string; source: "ledger" | "ephemeral" } | null;
  };
  getWorkspaceTabIds(): Promise<number[] | null | undefined>;
}

/** Whether a done() rejection at the mid-point threshold should escalate tier. */
export function shouldEscalateOnDoneRejection(host: LoopQueriesHost): boolean {
  if (host.limits.maxDoneRejections < 2) return false;
  const midPoint = Math.ceil(host.limits.maxDoneRejections / 2);
  return host.doneRejections === midPoint && !host.llm.isPlannerTier();
}

/** Whether the task is a pure list/filter read (no mutating/aggregating verbs). */
export function isPureListFilterWorkflowRequest(
  host: LoopQueriesHost,
): boolean {
  const taskText = `${host.originalQuery}\n${host.planSteps
    .map((step) => `${step.objective}\n${step.successCriteria ?? ""}`)
    .join("\n")}`;
  if (!taskText.trim()) return true;
  return !/\b(?:delete|remove|mark|update|close|assign|order|submit|select|approve|reject|duplicate|duplicated|total|sum|return|investment|manage)\b/i.test(
    taskText,
  );
}

/** The running (or current) plan subtask's description, if any. */
export function getActiveSubtaskDescription(
  host: LoopQueriesHost,
): string | undefined {
  const running = host.planSubtasks.find(
    (subtask) => subtask.status === "running",
  );
  if (running?.description) return running.description;
  const plan = host.context.getPlanStatusRaw?.();
  const currentIndex =
    typeof plan?.currentIndex === "number"
      ? plan.currentIndex
      : host.lastPlanIndex;
  return host.planSubtasks[currentIndex]?.description;
}

/** The pending approval interaction matching this tool call, if it is a resume. */
export function getMatchingApprovalInteraction(
  host: LoopQueriesHost,
  toolName: ToolName,
  args: Record<string, unknown>,
  context: string,
): PendingApprovalInteraction | null {
  if (host.resumeInteraction?.kind !== "approval") return null;
  const interaction = host.resumeInteraction;
  const currentKey = buildMutationKey(toolName, args);
  const pendingKey = buildMutationKey(interaction.toolName, interaction.args);
  if (pendingKey !== currentKey || interaction.context !== context) {
    return null;
  }
  return interaction;
}

/** The pending clarification interaction matching this question, if a resume. */
export function getMatchingClarificationInteraction(
  host: LoopQueriesHost,
  question: string,
  suggestions?: string[],
): PendingClarificationInteraction | null {
  if (host.resumeInteraction?.kind !== "clarification") return null;
  const interaction = host.resumeInteraction;
  const currentSuggestions = JSON.stringify(suggestions ?? []);
  const pendingSuggestions = JSON.stringify(interaction.suggestions ?? []);
  if (
    interaction.question !== question ||
    currentSuggestions !== pendingSuggestions
  ) {
    return null;
  }
  return interaction;
}

/** The replay result for a tool call if the checkpoint ledger/ephemeral has one. */
export function lookupMutationReplay(
  host: LoopQueriesHost,
  toolName: ToolName,
  args: Record<string, unknown>,
): { result: string; source: "ledger" | "ephemeral" } | null {
  const currentSnapshot = host.context.getSnapshot?.() ?? null;
  return host.checkpoints.lookupReplay(
    toolName,
    args,
    currentSnapshot,
    host.guardAfterDoneRejection,
  );
}

/** The workspace's tabs (or all tabs when no workspace scoping is active). */
export async function getWorkspaceTabs(
  host: LoopQueriesHost,
): Promise<chrome.tabs.Tab[]> {
  const wsTabIds = await host.getWorkspaceTabIds();
  if (!wsTabIds) {
    return await chrome.tabs.query({});
  }
  const tabs: chrome.tabs.Tab[] = [];
  for (const id of wsTabIds) {
    try {
      tabs.push(await chrome.tabs.get(id));
    } catch {
      // Ignore tabs closed outside the agent loop.
    }
  }
  return tabs;
}
