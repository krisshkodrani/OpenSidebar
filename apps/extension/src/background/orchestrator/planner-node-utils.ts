/**
 * Pure TaskNode/string helpers for the orchestrator planner. Extracted from
 * `planner.ts` under the decomposition ratchet (the display-label work
 * displaced these lines).
 */
import { ToolName } from "../../types";
import type { TaskNode } from "./types";

export function unionTools(groups: TaskNode[]): ToolName[] {
  const tools: ToolName[] = [];
  for (const node of groups) {
    for (const tool of node.allowedTools) {
      if (!tools.includes(tool)) tools.push(tool);
    }
  }
  return tools;
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** True when every node follows its predecessor, allowing redundant ancestors. */
export function isSerializedDependencyChain(nodes: TaskNode[]): boolean {
  const precedingIds = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const dependencies = nodes[i].dependencies;
    if (
      i === 0
        ? dependencies.length !== 0
        : !dependencies.includes(nodes[i - 1].id) ||
          dependencies.some((dependency) => !precedingIds.has(dependency))
    ) {
      return false;
    }
    precedingIds.add(nodes[i].id);
  }
  return true;
}

/** Every http(s) origin named in the nodes' descriptions (lowercased). */
export function nodeUrlOrigins(nodes: TaskNode[]): Set<string> {
  const origins = new Set<string>();
  for (const node of nodes) {
    for (const match of node.description.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      try {
        origins.add(new URL(match[0]).origin.toLowerCase());
      } catch {
        origins.add(match[0].toLowerCase());
      }
    }
  }
  return origins;
}

export function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A collapsed whole workflow is judged against the user, not predicted UI states. */
export function wholeWorkflowSuccessCriteria(query: string): string {
  return `Every requested outcome and explicit constraint is satisfied: ${JSON.stringify(query)}`;
}

/** Opening an editor is part of the dependent form work, not a field-inventory gate. */
export function foldEditorEntryPlan(
  nodes: TaskNode[],
  query: string,
  maxDescriptionLength: number,
): TaskNode[] {
  const [entry, ...edits] = nodes;
  if (
    !entry ||
    !edits.length ||
    !isSerializedDependencyChain(nodes) ||
    nodeUrlOrigins(nodes).size > 1 ||
    nodes.some((node) => node.status !== "pending") ||
    entry.toolProfile !== "navigate" ||
    !/^open\b.*\b(?:edit form|editor)\b/i.test(entry.description) ||
    /\b(?:tab|window|return|read|extract|report|compare)\b/i.test(
      entry.description,
    ) ||
    /\b(?:stop|approval|approve|ask me|wait for|separate(?:ly)?)\b/i.test(
      query,
    ) ||
    !edits.every(
      (node) =>
        node.toolProfile === "form_fill" || node.toolProfile === "submit_form",
    )
  )
    return nodes;

  const last = edits[edits.length - 1];
  const description = compactText(
    nodes.map((node) => node.description).join(" "),
  );
  if (description.length > maxDescriptionLength) return nodes;
  return [
    {
      ...entry,
      description,
      displayLabel: last.displayLabel,
      selectedSkillId: last.selectedSkillId,
      selectedSkillReason: last.selectedSkillReason,
      successCriteria: wholeWorkflowSuccessCriteria(query),
      allowedTools: unionTools(nodes),
      toolProfile: undefined,
      assumptions: dedupeStrings(
        nodes.flatMap((node) => node.assumptions || []),
      ),
      verificationGate: last.verificationGate
        ? { ...last.verificationGate, action: "call_done" }
        : undefined,
      handoffArtifacts: [
        ...nodes.flatMap((node) =>
          node.handoffArtifacts.filter(
            (artifact) =>
              artifact.phase !== "planned" &&
              artifact.phase !== "planner_replan",
          ),
        ),
        {
          role: "planner",
          phase: "planned",
          note: `Planner assigned objective: ${description}`,
          timestamp: entry.handoffArtifacts[0]?.timestamp ?? 0,
        },
      ],
    },
  ];
}
