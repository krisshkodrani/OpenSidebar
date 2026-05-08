import { ToolName } from "../../types";
import type { RecentToolCall } from "./repeat-action-policy";

const MANUAL_KNOWLEDGE_SEARCH_TOOLS = new Set<ToolName>([
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.PRESS_KEY,
  ToolName.FIND_ELEMENT,
  ToolName.NAVIGATE,
]);

function isKnowledgeSearchToolMessage(message: unknown): message is {
  role: "tool";
  content: string;
} {
  const candidate = message as { role?: unknown; content?: unknown };
  return (
    candidate.role === "tool" &&
    typeof candidate.content === "string" &&
    candidate.content.includes("Knowledge base search result.")
  );
}

function hasKnowledgeSearchEvidence(messages: unknown[]): boolean {
  return messages.some((message) => {
    const candidate = message as {
      role?: unknown;
      content?: unknown;
      tool_calls?: Array<{ function?: { name?: unknown } }>;
    };
    if (isKnowledgeSearchToolMessage(message)) {
      return true;
    }
    if (candidate.role !== "assistant" || !Array.isArray(candidate.tool_calls)) {
      return false;
    }
    return (
      candidate.tool_calls.some(
        (toolCall) => toolCall.function?.name === ToolName.SEARCH_KNOWLEDGE_BASE,
      )
    );
  });
}

export function buildKnowledgeBaseSearchArgs(originalQuery: string): {
  question: string;
  answerType: "auto" | "number";
} {
  const quotedQuestion =
    originalQuery.match(/knowledge base:\s*"([^"]+)"/i)?.[1] ??
    originalQuery.match(/"([^"]*\?[^"]*)"/)?.[1] ??
    originalQuery;
  const question = quotedQuestion.replace(/\s+/g, " ").trim();
  const wantsNumber =
    /\b(?:number|how many|count|total|amount|percent|percentage)\b/i.test(
      originalQuery,
    );
  return {
    question: question || originalQuery,
    answerType: wantsNumber ? "number" : "auto",
  };
}

export function extractKnowledgeBaseAnswerCandidate(
  toolResult: string,
): string | null {
  const match = toolResult.match(/^Answer candidate:\s*(.+)$/im);
  if (!match) return null;
  const candidate = match[1]?.trim().replace(/^["']|["']$/g, "");
  if (!candidate || /^not found\b/i.test(candidate)) return null;
  return candidate;
}

export function extractKnowledgeBaseAnswerFromText(
  text: string,
  originalQuery: string,
): string | null {
  if (!/\bknowledge\s+base\b/i.test(originalQuery)) return null;
  if (!/\b(?:knowledge|article|kb_|kb\s|Knowledge Portal)\b/i.test(text)) {
    return null;
  }
  const wantsNumber =
    /\b(?:number|how many|count|total|amount|percent|percentage)\b/i.test(
      originalQuery,
    );
  if (!wantsNumber) return null;
  const requiresHiringCue =
    /\b(?:new hires?|hiring|recruit|headcount)\b/i.test(originalQuery);
  const normalized = text.replace(/\s+/g, " ").trim();
  const chunks = normalized
    .split(/(?<=[.!?])\s+|(?:\bArticle\s+\d+\b)/i)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 20);
  const candidates = chunks.length > 0 ? chunks : [normalized];
  let best: { answer: string; score: number } | null = null;
  for (const chunk of candidates) {
    if (
      requiresHiringCue &&
      !/\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(
        chunk,
      )
    ) {
      continue;
    }
    const matches = [...chunk.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g)];
    for (const match of matches) {
      const answer = match[0];
      const index = match.index ?? 0;
      const before = chunk.slice(Math.max(0, index - 100), index);
      const after = chunk.slice(index, index + 100);
      const localContext = `${before} ${after}`;
      if (/\b\d{1,3}(?:,\d{3})*\s+results?\s+for\b/i.test(localContext)) {
        continue;
      }
      if (
        requiresHiringCue &&
        /[$]|\b(?:budget|spending|costs?|expense|expenses|funding|csr|corporate social responsibility)\b/i.test(
          localContext,
        )
      ) {
        continue;
      }
      if (
        requiresHiringCue &&
        (!/\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(
          localContext,
        ) ||
          !/\b(?:typically|annual(?:ly)?|yearly|each year|per year|year)\b/i.test(
            localContext,
          ))
      ) {
        continue;
      }
      let score = 0;
      if (
        /\b(?:is|are|was|were|makes?|made|typically|usually|average|annual(?:ly)?|yearly|each year|per year|hires?|employees?|headcount|count|total)\b/i.test(
          before,
        )
      ) {
        score += 10;
      }
      if (/\b(?:hires?|employees?|headcount|count|total)\b/i.test(after)) {
        score += 4;
      }
      if (/\b(?:new hires?|hiring|recruitment)\b/i.test(chunk)) score += 5;
      if (/\b(?:year|annual|annually|yearly|each year|per year)\b/i.test(chunk)) {
        score += 4;
      }
      if (/\.\d+$/.test(answer)) score -= 4;
      const immediateBefore = before.slice(-24);
      if (
        /\b(?:article|relevancy|rank|views?|rating|updated|authored|metadata|kb)\b/i.test(
          immediateBefore,
        )
      ) {
        score -= 12;
      }
      if (/\bresults?\b/i.test(`${before} ${after}`)) {
        score -= 12;
      }
      if (!best || score > best.score) {
        best = { answer, score };
      }
    }
  }
  return best && best.score >= 6 ? best.answer : null;
}

export function shouldRouteKnowledgeBaseSearchFirst(input: {
  selectedSkillId: string | null;
  toolName: ToolName;
  originalQuery: string;
  messages: unknown[];
  recentToolCalls?: RecentToolCall[];
}): boolean {
  if (input.selectedSkillId !== "search-answer-extraction") return false;
  if (!MANUAL_KNOWLEDGE_SEARCH_TOOLS.has(input.toolName)) return false;
  if (!/\bknowledge\s+base\b/i.test(input.originalQuery)) return false;
  if (
    input.recentToolCalls?.some(
      (toolCall) => toolCall.tool === ToolName.SEARCH_KNOWLEDGE_BASE,
    )
  ) {
    return false;
  }
  return !hasKnowledgeSearchEvidence(input.messages);
}

export function extractKnowledgeBaseRenderedSearchUrl(
  messages: unknown[],
): string | null {
  for (const message of [...messages].reverse()) {
    if (!isKnowledgeSearchToolMessage(message)) continue;
    if (extractKnowledgeBaseAnswerCandidate(message.content)) return null;
    if (!/No answer candidate found/i.test(message.content)) return null;
    const match = message.content.match(
      /https?:\/\/[^\s)]+\/(?:kb|sp)\?id=kb_search[^\s)]*/i,
    );
    return match?.[0]?.replace(/[.,;]+$/, "") ?? null;
  }
  return null;
}

function urlsMatchIgnoringHash(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.href === rightUrl.href;
  } catch {
    return left === right;
  }
}

function isKnowledgeSearchResultsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      /\/(?:kb|sp)(?:\/|$)/i.test(url.pathname) &&
      url.searchParams.get("id") === "kb_search"
    );
  } catch {
    return /\/(?:kb|sp)(?:\/[a-z-]+)?\?[^#]*\bid=kb_search\b/i.test(value);
  }
}

export function shouldRouteKnowledgeBaseSearchToRenderedResults(input: {
  selectedSkillId: string | null;
  toolName: ToolName;
  originalQuery: string;
  messages: unknown[];
  recentToolCalls?: RecentToolCall[];
  currentUrl?: string | null;
  requestedUrl?: string | null;
}): string | null {
  if (input.selectedSkillId !== "search-answer-extraction") return null;
  if (
    input.toolName !== ToolName.SEARCH_KNOWLEDGE_BASE &&
    !MANUAL_KNOWLEDGE_SEARCH_TOOLS.has(input.toolName)
  ) {
    return null;
  }
  if (
    input.toolName === ToolName.NAVIGATE &&
    (!input.requestedUrl || !isKnowledgeSearchResultsUrl(input.requestedUrl))
  ) {
    return null;
  }
  if (!/\bknowledge\s+base\b/i.test(input.originalQuery)) return null;
  const url = extractKnowledgeBaseRenderedSearchUrl(input.messages);
  if (!url) return null;
  if (input.requestedUrl && urlsMatchIgnoringHash(input.requestedUrl, url)) {
    return null;
  }
  if (input.currentUrl && urlsMatchIgnoringHash(input.currentUrl, url)) {
    return null;
  }
  const recentlyNavigatedThere = input.recentToolCalls?.some(
    (toolCall) =>
      toolCall.tool === ToolName.NAVIGATE && toolCall.argsKey.includes(url),
  );
  return recentlyNavigatedThere ? null : url;
}
