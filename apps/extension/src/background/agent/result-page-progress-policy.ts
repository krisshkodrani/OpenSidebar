import { ToolName } from "../../types";

export interface ResultPageProgressState {
  resultReadsByUrl: Map<string, { fingerprint: string; count: number }>;
  recordedReadFingerprints: Set<string>;
  visitedCandidateUrls: Set<string>;
  refinementsByUrl: Map<string, number>;
}

export type ResultPageProgressDecision =
  | { action: "none"; reason: string }
  | { action: "read_page"; reason: string }
  | { action: "navigate"; url: string; reason: string }
  | { action: "exhausted"; reason: string };

export function createResultPageProgressState(): ResultPageProgressState {
  return {
    resultReadsByUrl: new Map(),
    recordedReadFingerprints: new Set(),
    visitedCandidateUrls: new Set(),
    refinementsByUrl: new Map(),
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}

function normalizeUrlKey(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value.split("#")[0] ?? value;
  }
}

function extractQuestionTerms(originalQuery: string): string[] {
  const quoted =
    originalQuery.match(/"([^"]*\?[^"]*)"/)?.[1] ??
    originalQuery.match(/"([^"]+)"/)?.[1] ??
    originalQuery;
  const stopWords = new Set([
    "answer",
    "base",
    "charged",
    "company",
    "does",
    "ensuring",
    "find",
    "following",
    "full",
    "how",
    "knowledge",
    "look",
    "name",
    "please",
    "question",
    "search",
    "should",
    "state",
    "the",
    "using",
    "what",
    "when",
    "where",
    "which",
    "with",
    "your",
  ]);
  return [
    ...new Set(
      quoted
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((word) => word.length > 2 && !stopWords.has(word)) ?? [],
    ),
  ];
}

function isResultPageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.searchParams.get("id") === "kb_search") return true;
    return /\b(?:search|results?)\b/i.test(`${url.pathname} ${url.search}`);
  } catch {
    return /\b(?:search|results?)\b/i.test(value);
  }
}

function isResultPageText(value: string): boolean {
  if (/\b(?:0|no)\s+results?\b|\bno results found\b/i.test(value)) {
    return true;
  }
  return (
    /\b(?:Search Results?|Knowledge Search|results?\s+for|showing\s+\d+\s+(?:-|to)\s+\d+\s+of\s+\d+)\b/i.test(
      value,
    ) && /\b(?:https?:\/\/|href=|\[[^\]]+\]\(|\[\d+\]\s+a\b|article|result)\b/i.test(value)
  );
}

function pageObservationUrl(value: string): string | null {
  return value.match(/\nURL:\s*(\S+)/m)?.[1] ?? null;
}

function latestToolContent(
  messages: unknown[],
  currentUrl: string | null | undefined,
): string | null {
  const currentUrlKey = normalizeUrlKey(currentUrl);
  for (const message of [...messages].reverse()) {
    const candidate = message as { role?: unknown; content?: unknown };
    if (
      candidate.role === "tool" &&
      typeof candidate.content === "string" &&
      /^Page:/m.test(candidate.content) &&
      /\nURL:\s*\S+/m.test(candidate.content)
    ) {
      const observationUrlKey = normalizeUrlKey(pageObservationUrl(candidate.content));
      if (currentUrlKey && observationUrlKey && currentUrlKey !== observationUrlKey) {
        continue;
      }
      return candidate.content;
    }
  }
  return null;
}

function resultPageKey(currentUrl: string | null | undefined, text: string | null): string | null {
  const urlKey = normalizeUrlKey(currentUrl);
  if (urlKey && isResultPageUrl(urlKey)) return urlKey;
  if (text && isResultPageText(text)) return urlKey ?? stableHash(text.slice(0, 500));
  return null;
}

function recordResultRead(
  state: ResultPageProgressState,
  key: string,
  text: string | null,
  messageCount: number,
): void {
  if (!text || !isResultPageText(text)) return;
  const fingerprint = stableHash(normalizeWhitespace(text).slice(0, 4000));
  const recordKey = `${key}\u0000${fingerprint}\u0000${messageCount}`;
  if (state.recordedReadFingerprints.has(recordKey)) return;
  state.recordedReadFingerprints.add(recordKey);
  const existing = state.resultReadsByUrl.get(key);
  state.resultReadsByUrl.set(key, {
    fingerprint,
    count: existing?.fingerprint === fingerprint ? existing.count + 1 : 1,
  });
}

function cleanCandidateUrl(value: string): string {
  return value.replace(/[.,;:]+$/, "");
}

function isNavigableResultCandidateUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  return !/\.(?:avif|gif|ico|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(value);
}

export function extractResultPageCandidates(input: {
  text: string;
  originalQuery: string;
}): Array<{ url: string; score: number; label: string }> {
  const terms = extractQuestionTerms(input.originalQuery);
  const candidates: Array<{
    url: string;
    score: number;
    label: string;
    index: number;
  }> = [];
  const push = (url: string, label: string, index: number, context: string) => {
    const cleanUrl = cleanCandidateUrl(url);
    if (!isNavigableResultCandidateUrl(cleanUrl)) return;
    if (candidates.some((candidate) => candidate.url === cleanUrl)) return;
    const lower = `${label} ${context}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (lower.includes(term)) score += term.length > 5 ? 3 : 2;
    }
    if (
      score > 0 &&
      /\b(?:article|result|answer|guide|report|policy|protocol)\b/i.test(label)
    ) {
      score += 1;
    }
    if (/\b(?:metadata|authored|updated|views?|rating|home|login)\b/i.test(label)) {
      score -= 4;
    }
    candidates.push({ url: cleanUrl, label: normalizeWhitespace(label), score, index });
  };

  const markdownPattern = /\[([^\]]{1,180})\]\((https?:\/\/[^)\s]+)\)/gi;
  const markdownMatches = [...input.text.matchAll(markdownPattern)];
  for (let i = 0; i < markdownMatches.length; i += 1) {
    const match = markdownMatches[i];
    const label = match[1] ?? "";
    const url = match[2] ?? "";
    const index = match.index ?? 0;
    const nextIndex = markdownMatches[i + 1]?.index;
    const context = input.text.slice(
      Math.max(0, index - 160),
      nextIndex == null ? index + match[0].length + 320 : nextIndex,
    );
    push(url, label, index, context);
  }

  const elementLinkPattern =
    /\[\d+\]\s+a\b[^\n]*?href=(\S+)[^\n]*?(?:"|')([^"'\n]{1,180})(?:"|')/gi;
  for (const match of input.text.matchAll(elementLinkPattern)) {
    const url = match[1] ?? "";
    const label = match[2] ?? "";
    const index = match.index ?? 0;
    const context = input.text.slice(Math.max(0, index - 160), index + match[0].length + 320);
    push(url, label, index, context);
  }

  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates.map(({ url, score, label }) => ({ url, score, label }));
}

export function assessResultPageProgress(input: {
  state: ResultPageProgressState;
  selectedSkillId: string | null;
  originalQuery: string;
  toolName: ToolName;
  messages: unknown[];
  currentUrl?: string | null;
  requestedUrl?: string | null;
  maxResultReads?: number;
  maxRefinements?: number;
}): ResultPageProgressDecision {
  if (input.selectedSkillId !== "search-answer-extraction") {
    return { action: "none", reason: "skill_not_applicable" };
  }
  if (input.toolName === ToolName.READ_PAGE || input.toolName === ToolName.DONE) {
    return { action: "none", reason: "tool_allowed" };
  }
  const latestText = latestToolContent(input.messages, input.currentUrl);
  const key = resultPageKey(input.currentUrl, latestText);
  if (!key) return { action: "none", reason: "not_result_page" };
  recordResultRead(input.state, key, latestText, input.messages.length);

  const currentCandidateUrl = normalizeUrlKey(
    input.currentUrl && !isResultPageUrl(input.currentUrl) ? input.currentUrl : null,
  );
  if (currentCandidateUrl) input.state.visitedCandidateUrls.add(currentCandidateUrl);

  const readRecord = input.state.resultReadsByUrl.get(key);
  const readCount = readRecord?.count ?? 0;
  const maxResultReads = input.maxResultReads ?? 2;
  const maxRefinements = input.maxRefinements ?? 2;
  const refinements = input.state.refinementsByUrl.get(key) ?? 0;
  const requestedUrl = normalizeUrlKey(input.requestedUrl);
  const rankedCandidates = latestText
    ? extractResultPageCandidates({
        text: latestText,
        originalQuery: input.originalQuery,
      }).filter(
        (candidate) =>
          candidate.score > 0 &&
          !input.state.visitedCandidateUrls.has(normalizeUrlKey(candidate.url) ?? candidate.url),
      )
    : [];
  const requestedCandidate = requestedUrl
    ? rankedCandidates.find(
        (candidate) => requestedUrl === normalizeUrlKey(candidate.url),
      )
    : undefined;

  if (input.toolName === ToolName.NAVIGATE && requestedCandidate) {
    input.state.visitedCandidateUrls.add(requestedUrl);
    return { action: "none", reason: "allow_requested_candidate" };
  }

  const candidates = requestedUrl
    ? rankedCandidates.filter(
        (candidate) => requestedUrl !== normalizeUrlKey(candidate.url),
      )
    : rankedCandidates;

  if (candidates.length > 0 && readCount >= 1) {
    const url = candidates[0].url;
    input.state.visitedCandidateUrls.add(normalizeUrlKey(url) ?? url);
    return { action: "navigate", url, reason: "ranked_candidate" };
  }

  if (readCount === 0 && input.toolName !== ToolName.NAVIGATE) {
    return { action: "read_page", reason: "initial_result_grounding" };
  }

  if (readCount < maxResultReads && input.toolName !== ToolName.NAVIGATE) {
    return { action: "read_page", reason: "bounded_result_grounding" };
  }

  if (input.toolName === ToolName.SEARCH_KNOWLEDGE_BASE) {
    if (refinements >= maxRefinements) {
      return { action: "exhausted", reason: "refinement_cap_reached" };
    }
    input.state.refinementsByUrl.set(key, refinements + 1);
    return { action: "none", reason: "allow_refinement" };
  }

  if (readCount >= maxResultReads && candidates.length === 0) {
    return { action: "exhausted", reason: "no_unvisited_candidates" };
  }

  return { action: "none", reason: "no_policy_action" };
}
