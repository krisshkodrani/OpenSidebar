/**
 * Navigation-only goal heuristics for the orchestrator (RFC LP-16 Phase 5).
 *
 * Pure label/text helpers extracted verbatim from orchestrator/index.ts that
 * decide whether a navigation-only request's destination is already open.
 * No behavior change — the orchestrator imports these back.
 */
import type { TaskNode } from "./types";

export function normalizeNavigationText(value: string | undefined | null): string {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[_/|>.-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeNavigationLabel(label: string): string[] {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "module",
    "page",
    "application",
    "app",
    "section",
    "screen",
    "of",
    "in",
    "to",
  ]);
  return normalizeNavigationText(label)
    .split(" ")
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

export function navigationLabelMatches(label: string, corpus: string): boolean {
  const tokens = tokenizeNavigationLabel(label);
  if (tokens.length === 0) return false;
  const normalizedCorpus = ` ${normalizeNavigationText(corpus)} `;
  return tokens.every((token) => normalizedCorpus.includes(` ${token} `));
}

export function cleanNavigationLabel(value: string): string {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ");
}

export function extractQuotedNavigationLabels(query: string): string[] {
  const labels: string[] = [];
  for (const match of query.matchAll(/"([^"]+)"|'([^']+)'/g)) {
    const label = cleanNavigationLabel(match[1] || match[2] || "");
    if (!label) continue;
    labels.push(label);
    if (label.includes(">")) {
      labels.push(
        ...label.split(">").map(cleanNavigationLabel).filter(Boolean),
      );
    }
  }
  return [...new Set(labels)];
}

export function extractNavigationTargetLabels(query: string): {
  labels: string[];
  terminalLabels: string[];
} {
  const quotedLabels = extractQuotedNavigationLabels(query);
  const terminalLabels: string[] = [];
  for (const label of quotedLabels) {
    const parts = label
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) terminalLabels.push(parts[parts.length - 1]);
  }

  const unquotedMatch = query.match(
    /\b(?:navigate to|go to|open|visit|show|display|take me to)\s+(?:the\s+)?([^.\n]+?)(?:\s+(?:module|page|screen|section|application|app)\b|[.!?]|$)/i,
  );
  if (unquotedMatch?.[1]) {
    const label = cleanNavigationLabel(
      unquotedMatch[1].replace(
        /\b(?:of|in)\s+the\s+["'][^"']+["']\s+(?:application|app)\b/gi,
        "",
      ),
    );
    if (label) {
      quotedLabels.push(label);
      const parts = label.split(">").map(cleanNavigationLabel).filter(Boolean);
      terminalLabels.push(parts.length > 0 ? parts[parts.length - 1] : label);
    }
  }

  return {
    labels: [...new Set(quotedLabels)],
    terminalLabels: [...new Set(terminalLabels)],
  };
}

export function isNavigationOnlyRequest(query: string): boolean {
  const normalized = normalizeNavigationText(query);
  if (
    !/\b(navigate to|go to|open|visit|show|display|take me to)\b/i.test(query)
  ) {
    return false;
  }

  const nonNavigationWork =
    /\b(filter|sort|search for|find|look up|answer|read|summari[sz]e|extract|report|compare|create|add|fill|submit|save|update|edit|delete|remove|order|purchase|checkout|impersonate|type|enter|select|choose)\b/i;
  if (nonNavigationWork.test(query)) return false;

  return !/\b(return|go back|then|after that|and then)\b/.test(normalized);
}

export function assessNavigationGoalCompletion(input: {
  query: string;
  snapshot?: {
    title?: string;
    url?: string;
    visibleContent?: string;
    pageContent?: string;
  };
  completedNodes: TaskNode[];
}): { satisfied: boolean; matchedLabels: string[]; reason: string } {
  if (!isNavigationOnlyRequest(input.query)) {
    return {
      satisfied: false,
      matchedLabels: [],
      reason: "Original request is not navigation-only.",
    };
  }

  const { labels, terminalLabels } = extractNavigationTargetLabels(input.query);
  const targetLabels = labels.length > 0 ? labels : terminalLabels;
  if (targetLabels.length === 0 && terminalLabels.length === 0) {
    return {
      satisfied: false,
      matchedLabels: [],
      reason: "No concrete navigation target labels were detected.",
    };
  }

  const currentCorpus = [
    input.snapshot?.title,
    input.snapshot?.url,
    input.snapshot?.visibleContent,
    input.snapshot?.pageContent,
  ]
    .filter(Boolean)
    .join("\n");
  const currentLocationCorpus = [input.snapshot?.title, input.snapshot?.url]
    .filter(Boolean)
    .join("\n");
  const evidenceCorpus = [
    currentCorpus,
    ...input.completedNodes.map((node) => node.result || ""),
  ].join("\n");

  const currentMatches = (
    terminalLabels.length > 0 ? terminalLabels : targetLabels
  ).filter((label) => navigationLabelMatches(label, currentLocationCorpus));
  const evidenceMatches = targetLabels.filter((label) =>
    navigationLabelMatches(label, evidenceCorpus),
  );

  if (currentMatches.length === 0) {
    return {
      satisfied: false,
      matchedLabels: evidenceMatches,
      reason: "Current page does not match the requested destination.",
    };
  }

  const enoughEvidence =
    targetLabels.length <= 1 ||
    evidenceMatches.length >= Math.min(2, targetLabels.length);
  if (!enoughEvidence) {
    return {
      satisfied: false,
      matchedLabels: evidenceMatches,
      reason:
        "Completed evidence does not cover enough requested destination labels.",
    };
  }

  return {
    satisfied: true,
    matchedLabels: [...new Set([...currentMatches, ...evidenceMatches])],
    reason: "Navigation-only destination is already open.",
  };
}
