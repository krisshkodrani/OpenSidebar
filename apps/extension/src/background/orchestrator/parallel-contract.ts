import { inferToolProfileForStep } from "../agent/planner";
import {
  getToolProfileNodeConcurrency,
  type ToolProfile,
} from "../tools/metadata";
import type {
  NodeParallelContract,
  ResourceAccess,
  ResourceHint,
  TaskNode,
} from "./types";

const READ_VERBS =
  /\b(read|check|inspect|review|summari[sz]e|extract|compare|report|look up|find|count|inventory|observe)\b/i;
const MUTATION_VERBS =
  /\b(click|type|enter|fill|select|choose|set|toggle|submit|save|update|edit|delete|remove|add|order|purchase|buy|checkout|send|post|apply|configure|create|close|open)\b/i;
const NAVIGATION_VERBS =
  /\b(navigate|go to|open|visit|return to|go back|switch tab|create tab|close tab)\b/i;
const WRITE_VERBS =
  /\b(click|type|enter|fill|select|choose|set|toggle|submit|save|update|edit|delete|remove|add|order|purchase|buy|checkout|send|post|apply|configure|create|close)\b/i;

function compactKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[#?].*$/, "")
    .replace(/[^a-z0-9./:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function addHint(hints: ResourceHint[], hint: ResourceHint): void {
  const existing = hints.find(
    (candidate) =>
      candidate.kind === hint.kind &&
      candidate.key === hint.key &&
      candidate.access === hint.access,
  );
  if (!existing) {
    hints.push(hint);
    return;
  }
  existing.confidence = Math.max(existing.confidence, hint.confidence);
}

function getProfileAccess(toolProfile?: ToolProfile): ResourceAccess | null {
  const concurrency = getToolProfileNodeConcurrency(toolProfile);
  return concurrency ? (concurrency.access as ResourceAccess) : null;
}

function profileRequiresSerialization(toolProfile?: ToolProfile): boolean {
  return getToolProfileNodeConcurrency(toolProfile)?.scope === "never";
}

function inferAccess(text: string, toolProfile?: ToolProfile): ResourceAccess {
  if (
    /\b(approve|approval|confirm final|place order|send|publish|delete|submit)\b/i.test(
      text,
    )
  ) {
    return "approval";
  }

  const profileAccess = getProfileAccess(toolProfile);
  if (
    profileAccess === "navigate" &&
    READ_VERBS.test(text) &&
    !WRITE_VERBS.test(text)
  ) {
    return "read";
  }
  if (profileAccess) return profileAccess;

  if (NAVIGATION_VERBS.test(text) && !READ_VERBS.test(text)) return "navigate";
  if (MUTATION_VERBS.test(text)) return "write";
  if (READ_VERBS.test(text)) return "read";
  return "write";
}

function extractUrls(text: string): string[] {
  const urls = [...text.matchAll(/\bhttps?:\/\/[^\s)"']+/gi)].map((match) =>
    match[0].replace(/[),.;]+$/, ""),
  );
  return [...new Set(urls)];
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

function addUrlHints(
  hints: ResourceHint[],
  urls: string[],
  access: ResourceAccess,
): void {
  for (const url of urls) {
    const key = compactKey(url);
    if (!key) continue;
    addHint(hints, {
      kind: "url",
      key,
      access,
      confidence: 0.95,
      source: "repair",
    });
    const origin = safeOrigin(url);
    if (origin) {
      addHint(hints, {
        kind: "origin",
        key: compactKey(origin),
        access,
        confidence: 0.9,
        source: "repair",
      });
    }
  }
}

function addSemanticTargetHints(
  hints: ResourceHint[],
  text: string,
  access: ResourceAccess,
): void {
  const normalized = text.replace(/\s+/g, " ").trim();
  const targetPatterns: Array<{
    kind: ResourceHint["kind"];
    pattern: RegExp;
    confidence: number;
  }> = [
    {
      kind: "cart",
      pattern: /\b(cart|checkout|basket|order summary)\b/gi,
      confidence: 0.9,
    },
    {
      kind: "form",
      pattern:
        /\b([a-z0-9][a-z0-9 -]{0,50}\s+(?:form|field|input|dropdown|checkbox|wizard))\b/gi,
      confidence: 0.8,
    },
    {
      kind: "record",
      pattern: /\b(record|ticket|incident|case|request)\s+([a-z0-9._:-]+)?/gi,
      confidence: 0.75,
    },
    {
      kind: "table",
      pattern:
        /\b([a-z0-9][a-z0-9 -]{0,50}\s+(?:table|list|grid|rows?|catalog))\b/gi,
      confidence: 0.75,
    },
    {
      kind: "account",
      pattern: /\b(account|profile|user settings|personal profile)\b/gi,
      confidence: 0.75,
    },
  ];

  for (const { kind, pattern, confidence } of targetPatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const rawKey =
        match[1] && match[2] ? `${match[1]}-${match[2]}` : match[1];
      const key = compactKey(rawKey || kind);
      if (!key) continue;
      addHint(hints, {
        kind,
        key,
        access,
        confidence,
        source: "repair",
      });
    }
  }
}

function defaultTabHint(access: ResourceAccess): ResourceHint {
  return {
    kind: "tab",
    key: "root",
    access,
    confidence: access === "read" ? 0.45 : 0.6,
    source: "repair",
  };
}

function inferResourceHints(input: {
  text: string;
  access: ResourceAccess;
}): ResourceHint[] {
  const hints: ResourceHint[] = [];
  const urls = extractUrls(input.text);
  addUrlHints(
    hints,
    urls,
    input.access === "navigate" ? "navigate" : input.access,
  );
  addSemanticTargetHints(hints, input.text, input.access);

  if (hints.length === 0) {
    hints.push(defaultTabHint(input.access));
  }

  return hints;
}

function hasHighConfidenceResource(hints: ResourceHint[]): boolean {
  return hints.some((hint) => hint.confidence >= 0.7 && hint.kind !== "tab");
}

function isReadOnlyContract(contract: NodeParallelContract): boolean {
  return contract.resourceHints.every((hint) => hint.access === "read");
}

function buildDependencyReason(
  node: Pick<TaskNode, "dependencies">,
): string | undefined {
  return node.dependencies.length > 0
    ? "Planner or repair dependency requires predecessor completion."
    : undefined;
}

export function inferNodeParallelContract(
  node: Pick<
    TaskNode,
    | "description"
    | "successCriteria"
    | "dependencies"
    | "toolProfile"
    | "parallelContract"
  >,
): NodeParallelContract {
  if (node.parallelContract) return node.parallelContract;

  const text = `${node.description}\n${node.successCriteria}`;
  const toolProfile =
    node.toolProfile ??
    inferToolProfileForStep(node.description, node.successCriteria);
  const access = inferAccess(text, toolProfile);
  const resourceHints = inferResourceHints({ text, access });
  const hasDependencies = node.dependencies.length > 0;
  const toolUnsafeParallelism = profileRequiresSerialization(toolProfile);
  const highConfidenceResource = hasHighConfidenceResource(resourceHints);
  const readOnly = resourceHints.every((hint) => hint.access === "read");

  const parallelism: NodeParallelContract["parallelism"] =
    hasDependencies || toolUnsafeParallelism
      ? "serialized"
      : readOnly && highConfidenceResource
        ? "independent"
        : readOnly
          ? "unknown"
          : highConfidenceResource
            ? "resource_bound"
            : "serialized";

  return {
    parallelism,
    ...(buildDependencyReason(node)
      ? { dependencyReason: buildDependencyReason(node) }
      : {}),
    resourceHints,
    siblingAwareness:
      parallelism === "serialized" ? "coordination_required" : "summary",
  };
}

function resourcesConflict(
  first: NodeParallelContract,
  second: NodeParallelContract,
): boolean {
  if (first.resourceHints.length === 0 || second.resourceHints.length === 0) {
    return true;
  }

  for (const a of first.resourceHints) {
    for (const b of second.resourceHints) {
      if (a.kind !== b.kind || a.key !== b.key) continue;
      if (a.access === "read" && b.access === "read") {
        const highConfidenceRead =
          a.confidence >= 0.7 && b.confidence >= 0.7 && a.kind !== "tab";
        if (highConfidenceRead) continue;
      }
      return true;
    }
  }

  return false;
}

function dependencyExists(
  nodesById: Map<string, TaskNode>,
  node: TaskNode,
  dependencyId: string,
  seen = new Set<string>(),
): boolean {
  if (node.dependencies.includes(dependencyId)) return true;
  for (const depId of node.dependencies) {
    if (seen.has(depId)) continue;
    seen.add(depId);
    const dep = nodesById.get(depId);
    if (dep && dependencyExists(nodesById, dep, dependencyId, seen)) {
      return true;
    }
  }
  return false;
}

export function annotateParallelContracts(nodes: TaskNode[]): TaskNode[] {
  for (const node of nodes) {
    node.toolProfile =
      inferToolProfileForStep(node.description, node.successCriteria) ??
      node.toolProfile;
    const explicitPlannerContract = node.parallelContract?.resourceHints.some(
      (hint) => hint.source === "planner",
    )
      ? node.parallelContract
      : undefined;
    node.parallelContract = inferNodeParallelContract({
      ...node,
      parallelContract: explicitPlannerContract,
    });
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (let index = 1; index < nodes.length; index++) {
    const node = nodes[index];
    const contract = node.parallelContract!;
    for (let priorIndex = 0; priorIndex < index; priorIndex++) {
      const prior = nodes[priorIndex];
      const priorContract = prior.parallelContract!;
      if (dependencyExists(nodesById, node, prior.id)) continue;
      if (!resourcesConflict(priorContract, contract)) continue;

      node.dependencies.push(prior.id);
      node.parallelContract = {
        ...contract,
        parallelism: "serialized",
        dependencyReason: `Serialized with ${prior.id} because both nodes may touch ${
          priorContract.resourceHints
            .map((hint) => `${hint.kind}:${hint.key}`)
            .join(", ") || "shared browser state"
        }.`,
        siblingAwareness: "coordination_required",
      };
      break;
    }
  }

  return nodes;
}

export function buildPlanTraceGraph(nodes: TaskNode[]): {
  nodes: Array<{
    nodeId: string;
    index: number;
    dependencies: string[];
    parallelContract: NodeParallelContract;
  }>;
  edges: Array<{ from: string; to: string; reason: string }>;
} {
  return {
    nodes: nodes.map((node, index) => ({
      nodeId: node.id,
      index,
      dependencies: [...node.dependencies],
      parallelContract:
        node.parallelContract ?? inferNodeParallelContract(node),
    })),
    edges: nodes.flatMap((node) =>
      node.dependencies.map((depId) => ({
        from: depId,
        to: node.id,
        reason:
          node.parallelContract?.dependencyReason ?? "Planner dependency edge.",
      })),
    ),
  };
}

export function getNodeResourceConflicts(
  candidate: TaskNode,
  runningNodes: TaskNode[],
): TaskNode[] {
  const candidateContract =
    candidate.parallelContract ?? inferNodeParallelContract(candidate);
  return runningNodes.filter((node) => {
    const runningContract =
      node.parallelContract ?? inferNodeParallelContract(node);
    return (
      resourcesConflict(candidateContract, runningContract) ||
      (!isReadOnlyContract(candidateContract) &&
        !isReadOnlyContract(runningContract))
    );
  });
}
