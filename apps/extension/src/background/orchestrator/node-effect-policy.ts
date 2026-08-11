import { MUTATION_SENSITIVE_TOOLS } from "../tools/metadata";
import type { TaskNode } from "./types";

export type NodeEffect =
  | "read_only"
  | "preparatory_write"
  | "consequential_write"
  | "unknown_write";

const CONSEQUENTIAL_ACTION =
  /\b(?:submit|send|post|publish|buy|purchase|place\s+(?:the\s+)?order|delete|confirm|approve|finalize|apply)\b/i;
const PREPARATORY_ACTION =
  /\b(?:prepare|draft|stage|load|fill|select|choose|configure|compose)\b/i;
const READ_ONLY_ACTION =
  /\b(?:read|inspect|check|verify|compare|calculate|report|summarize|explain|tell|list|extract|review)\b/i;
const GENERIC_WRITE_ACTION =
  /\b(?:click|type|enter|fill|select|choose|change|update|edit|add|remove|replace|save|navigate|open|switch|search)\b/i;

/** Remove explicit prohibitions before classifying what this node is meant to do. */
function executableText(text: string): string {
  return text
    .replace(
      /\b(?:do\s+not|don't|never|without)\b[^.;\n]*(?:submit|send|post|publish|buy|purchase|place\s+(?:the\s+)?order|delete|confirm|approve|finalize)[^.;\n]*/gi,
      " ",
    )
    .replace(/\b(?:leave|keep)\b[^.;\n]*\b(?:unsubmitted|unsent|unconfirmed|unpurchased)\b[^.;\n]*/gi, " ")
    .replace(
      /\b(?:purchase|submission|message|order|change|action)\b[^.;\n]{0,80}\b(?:remains?|stays?|is|was)\s+(?:not\s+)?(?:unsubmitted|unsent|unconfirmed|unpurchased|pending|not\s+(?:submitted|sent|confirmed|purchased))\b[^.;\n]*/gi,
      " ",
    );
}

export function classifyNodeEffect(
  input: Pick<TaskNode, "description" | "successCriteria" | "allowedTools">,
): NodeEffect {
  const text = executableText(`${input.description}\n${input.successCriteria}`);
  if (CONSEQUENTIAL_ACTION.test(text)) return "consequential_write";
  if (PREPARATORY_ACTION.test(text)) return "preparatory_write";
  if (READ_ONLY_ACTION.test(text) && !GENERIC_WRITE_ACTION.test(text)) {
    return "read_only";
  }
  if (GENERIC_WRITE_ACTION.test(text)) return "unknown_write";

  const hasMutationSensitiveTool = input.allowedTools.some((tool) =>
    MUTATION_SENSITIVE_TOOLS.has(tool),
  );
  return hasMutationSensitiveTool ? "unknown_write" : "read_only";
}

export function isMutationEffect(effect: NodeEffect): boolean {
  return effect !== "read_only";
}

export function isConsequentialEffect(effect: NodeEffect): boolean {
  return effect === "consequential_write";
}

export function isSafeToSuppressAfterRootCompletion(effect: NodeEffect): boolean {
  return effect === "read_only" || effect === "preparatory_write";
}
