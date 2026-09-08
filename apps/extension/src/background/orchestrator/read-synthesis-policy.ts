import type { TaskNode } from "./types";

const READ_SYNTHESIS_REQUEST =
  /\b(?:compare|report|summari[sz]e|explain|tell me|give me|what (?:is|are)|how (?:many|much)|extract)\b/i;
const USER_REQUESTED_MUTATION =
  /\b(?:create|add|update|set|change|fill|submit|order|purchase|buy|delete|remove|send|post|publish|apply|select|choose|type|enter|save|approve|confirm)\b/i;
const READ_SYNTHESIS_STEP =
  /\b(?:read|inspect|check|review|compare|report|summari[sz]e|explain|tell|extract|find|look up|search|navigate|open|visit)\b/i;

const NODE_NAVIGATION_VERB =
  /\b(?:navigate to|go(?:ing)? to|open(?:ing)? (?:a )?new tab|visit\w*|return\w* to|back to)\b/i;

export function requiresSeparateNavigation(
  nodes: TaskNode[],
  query: string,
): boolean {
  return (
    !isReadSynthesisPlan(nodes, query) &&
    nodes.some(
      (node) =>
        node.toolProfile === "navigate" ||
        NODE_NAVIGATION_VERB.test(node.description),
    )
  );
}

export function isReadSynthesisPlan(nodes: TaskNode[], query: string): boolean {
  if (
    !READ_SYNTHESIS_REQUEST.test(query) ||
    USER_REQUESTED_MUTATION.test(query)
  ) {
    return false;
  }
  return nodes.every((node) => {
    const text = `${node.description}\n${node.successCriteria}`;
    return (
      READ_SYNTHESIS_STEP.test(text) && !USER_REQUESTED_MUTATION.test(text)
    );
  });
}
