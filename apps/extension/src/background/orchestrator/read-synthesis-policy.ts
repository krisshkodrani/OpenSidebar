import type { TaskNode } from "./types";

const READ_SYNTHESIS_REQUEST =
  /\b(?:compare|report|summari[sz]e|explain|tell me|give me|what (?:is|are)|how (?:many|much)|extract)\b/i;
const USER_REQUESTED_MUTATION =
  /\b(?:create|add|update|set|change|fill|submit|order|purchase|buy|delete|remove|send|post|publish|apply|select|choose|type|enter|save|approve|confirm)\b/i;
const READ_SYNTHESIS_STEP =
  /\b(?:read|inspect|check|review|compare|report|summari[sz]e|explain|tell|extract|find|look up|search|navigate|open|visit)\b/i;

export function hasSequentialDependencyOrder(nodes: TaskNode[]): boolean {
  return nodes.every((node, index) => {
    const dependencies = node.dependencies;
    if (index === 0) return dependencies.length === 0;
    const priorIds = new Set(nodes.slice(0, index).map((prior) => prior.id));
    return (
      dependencies.includes(nodes[index - 1].id) &&
      dependencies.every((dependency) => priorIds.has(dependency))
    );
  });
}

export function isReadSynthesisPlan(
  nodes: TaskNode[],
  query: string,
): boolean {
  if (
    !READ_SYNTHESIS_REQUEST.test(query) ||
    USER_REQUESTED_MUTATION.test(query)
  ) {
    return false;
  }
  return nodes.every((node) => {
    const text = `${node.description}\n${node.successCriteria}`;
    return (
      READ_SYNTHESIS_STEP.test(text) &&
      !USER_REQUESTED_MUTATION.test(text)
    );
  });
}
