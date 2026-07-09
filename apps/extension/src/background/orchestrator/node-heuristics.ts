/**
 * Small node/goal heuristics for the orchestrator (RFC LP-16 Phase 5).
 * Completed-node summaries, goal-shortcut-skip predicates, the
 * action/mutation-node classifier, and recent-side-effect formatting.
 * Verbatim movement from orchestrator/index.ts.
 */
import type { SideEffectEntry } from "../agent/checkpoint-types";
import type { TaskNode } from "./types";

export function summaryOfCompletedNodes(nodes: TaskNode[]): string {
  return nodes
    .map((node) => `${node.description}\n${node.result || ""}`)
    .join("\n");
}

export function isGlobalGoalShortcutSkip(node: TaskNode): boolean {
  return (
    node.status === "skipped" &&
    String(node.result || "").includes("Skipped: global goal already achieved")
  );
}

export function isNavigationGoalShortcutSkip(node: TaskNode): boolean {
  return (
    node.status === "skipped" &&
    String(node.result || "").includes(
      "Skipped: navigation goal already achieved",
    )
  );
}

export function isUnpenalizedGoalShortcutSkip(node: TaskNode): boolean {
  return isGlobalGoalShortcutSkip(node) || isNavigationGoalShortcutSkip(node);
}


export function isActionOrMutationNode(node: TaskNode): boolean {
  const text = `${node.description}\n${node.successCriteria}`.toLowerCase();
  return [
    /\bsearch(?:ing)?\b/,
    /\bsubmit(?:ting)?\b/,
    /\bapply(?:ing)?\b/,
    /\btype\b|\btyping\b/,
    /\benter\b|\bentering\b/,
    /\bfill\b|\bfilling\b/,
    /\bclick\b|\bclicking\b/,
    /\bselect\b|\bselecting\b/,
    /\bremove\b|\bremoving\b/,
    /\badd\b|\badding\b/,
    /\bswap\b|\bswapping\b/,
    /\breplace\b|\breplacing\b/,
    /\bcheckout\b/,
    /\bpurchase\b/,
    /\bplace order\b/,
    /\bcomplete order\b/,
    /\bconfirm\b|\bconfirming\b/,
    /\bfinalize\b|\bfinalizing\b/,
    /\bdelete\b|\bdeleting\b/,
    /\bsave\b|\bsaving\b/,
    /\bsend\b|\bsending\b/,
    /\bswitch\b|\bswitching\b/,
    /\bimpersonate\b|\bimpersonating\b|\bimpersonation\b/,
  ].some((pattern) => pattern.test(text));
}

export function formatRecentSideEffects(
  entries: SideEffectEntry[] | undefined,
): string {
  if (!entries || entries.length === 0) return "";
  const recent = entries.slice(-3);
  return recent
    .map((entry) => {
      const result = String(entry.result || "").trim();
      return `${entry.toolName}: ${result.slice(0, 120) || "executed"}`;
    })
    .join("; ");
}

export function appendRecentSideEffects(
  message: string,
  entries: SideEffectEntry[] | undefined,
): string {
  const sideEffects = formatRecentSideEffects(entries);
  if (!sideEffects) return message;
  return `${message}\nRecent side effects: ${sideEffects}`;
}
