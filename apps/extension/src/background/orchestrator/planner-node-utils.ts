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

/** Every http(s) origin named in the nodes' descriptions (lowercased). */
export function nodeUrlOrigins(nodes: TaskNode[]): Set<string> {
  const origins = new Set<string>();
  for (const node of nodes) {
    for (const match of node.description.matchAll(
      /https?:\/\/[^\s"'<>]+/gi,
    )) {
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
