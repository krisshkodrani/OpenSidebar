import { ToolName } from "../../types";
import type { RecentToolCall } from "./repeat-action-policy";

const MANUAL_KNOWLEDGE_SEARCH_TOOLS = new Set<ToolName>([
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.PRESS_KEY,
  ToolName.FIND_ELEMENT,
  ToolName.NAVIGATE,
]);

const KNOWLEDGE_QUESTION_STOP_WORDS = new Set([
  "answer",
  "base",
  "charged",
  "company",
  "does",
  "each",
  "ensuring",
  "following",
  "full",
  "how",
  "knowledge",
  "make",
  "many",
  "name",
  "number",
  "our",
  "should",
  "state",
  "the",
  "typically",
  "using",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "year",
  "your",
]);

const ORGANIZATION_ANSWER_CUES =
  /\b(?:charged|responsible|ensur(?:e|es|ing)|appointed|engaged|conducted|provided|provides|provider|supplies|supplier|vendor|firm|partner|auditor|audit|integrity|financial|managed|owned|operated)\b/i;

function extractKnowledgeQuestionTerms(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter(
          (word) => word.length > 2 && !KNOWLEDGE_QUESTION_STOP_WORDS.has(word),
        ) ?? [],
    ),
  ];
}

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

function hasPendingKnowledgeSearchToolCall(message: unknown): boolean {
  const candidate = message as {
    role?: unknown;
    tool_calls?: Array<{ function?: { name?: unknown } }>;
  };
  return (
    candidate.role === "assistant" &&
    Array.isArray(candidate.tool_calls) &&
    candidate.tool_calls.some(
      (toolCall) => toolCall.function?.name === ToolName.SEARCH_KNOWLEDGE_BASE,
    )
  );
}

function hasKnowledgeSearchEvidence(messages: unknown[]): boolean {
  return messages.some(
    (message) =>
      isKnowledgeSearchToolMessage(message) ||
      hasPendingKnowledgeSearchToolCall(message),
  );
}

export function buildKnowledgeBaseSearchArgs(originalQuery: string): {
  question: string;
  query?: string;
  answerType: "auto" | "number";
} {
  const question = extractKnowledgeBaseQuestion(originalQuery);
  const wantsNumber =
    /\b(?:number|how many|count|total|amount|percent|percentage)\b/i.test(
      question,
    );
  const query = buildKnowledgeBaseSearchQuery(question);
  return {
    question: question || originalQuery,
    ...(query ? { query } : {}),
    answerType: wantsNumber ? "number" : "auto",
  };
}

function extractKnowledgeBaseQuestion(originalQuery: string): string {
  const originalRequestMatch = [
    ...originalQuery.matchAll(/Original user request[^\r\n:]*:\s*([\s\S]*)/gi),
  ].at(-1);
  const source = originalRequestMatch?.[1] ?? originalQuery;
  const quotedQuestion =
    source.match(/knowledge base:\s*"([^"]+)"/i)?.[1] ??
    source.match(/"([^"]*\?[^"]*)"/)?.[1] ??
    source.match(/"([^"]+)"/)?.[1] ??
    source;
  return quotedQuestion.replace(/\s+/g, " ").trim();
}

function buildKnowledgeBaseSearchQuery(question: string): string {
  if (/\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(question)) {
    return "new hires hiring recruitment headcount";
  }
  return extractKnowledgeQuestionTerms(question).slice(0, 5).join(" ");
}

function extractQuestionTopicTerms(question: string): string[] {
  return extractKnowledgeQuestionTerms(question);
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
  const question = extractKnowledgeBaseQuestion(originalQuery);
  const wantsNumber =
    /\b(?:number|how many|count|total|amount|percent|percentage)\b/i.test(
      question,
    );
  if (!wantsNumber) {
    return extractTextKnowledgeBaseAnswerFromText(text, question);
  }
  const requiresHiringCue =
    /\b(?:new hires?|hiring|recruit|headcount)\b/i.test(question);
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

function extractTextKnowledgeBaseAnswerFromText(
  text: string,
  question: string,
): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (/\bKnowledge Search\b/i.test(normalized) && /\b\d+\s+results?\s+for\b/i.test(normalized)) {
    return null;
  }
  const wantsCompany =
    /\b(?:company|vendor|supplier|provider|firm|organization|organisation)\b/i.test(
      question,
    );
  if (!wantsCompany) return null;
  const topicTerms = extractQuestionTopicTerms(question);
  const chunks = normalized
    .split(/(?<=[.!?])\s+|(?:\bArticle\s+\d+\b)/i)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 20);
  const organizationPattern =
    /\b(?:[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,4})(?:\s+(?:LLC|LLP|PLC|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Group|Partners|Associates|Consulting|Auditors?|Accountants?))\b|\b[A-Z][A-Za-z]+(?:[A-Z][a-z]+){1,}\b/g;
  let best: { answer: string; score: number } | null = null;
  for (const chunk of chunks.length > 0 ? chunks : [normalized]) {
    const lower = chunk.toLowerCase();
    let relevanceScore = 0;
    for (const term of topicTerms) {
      if (lower.includes(term)) relevanceScore += term.length > 5 ? 3 : 2;
    }
    if (ORGANIZATION_ANSWER_CUES.test(chunk)) relevanceScore += 6;
    if (relevanceScore < 8) continue;
    for (const match of chunk.matchAll(organizationPattern)) {
      const answer = match[0].trim().replace(/[.,;:]+$/, "");
      if (
        !answer ||
        /^(?:Article|Knowledge|General Knowledge|System Administrator|ServiceNow|Financial Reporting|Knowledge Portal|Our Company|The Company)$/i.test(
          answer,
        )
      ) {
        continue;
      }
      const index = match.index ?? 0;
      const context = chunk.slice(Math.max(0, index - 140), index + answer.length + 140);
      const lowerContext = context.toLowerCase();
      let localTopicScore = 0;
      for (const term of topicTerms) {
        if (lowerContext.includes(term)) localTopicScore += term.length > 5 ? 3 : 2;
      }
      if (localTopicScore < 4) continue;
      let score = relevanceScore + localTopicScore;
      if (ORGANIZATION_ANSWER_CUES.test(context)) {
        score += 10;
      }
      if (/\b(?:authored|metadata|views?|rating|updated|knowledge portal)\b/i.test(context)) {
        score -= 12;
      }
      if (!best || score > best.score) {
        best = { answer, score };
      }
    }
  }
  return best && best.score >= 16 ? best.answer : null;
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
  const recentKnowledgeSearches =
    input.recentToolCalls?.filter((toolCall) => toolCall.tool === ToolName.SEARCH_KNOWLEDGE_BASE)
      .length ?? 0;
  if (recentKnowledgeSearches >= 2) return false;
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

export function extractKnowledgeBaseArticleUrlFromRenderedText(
  text: string,
  originalQuery?: string,
): string | null {
  if (!/\bKnowledge Search\b/i.test(text)) return null;
  const topicTerms = originalQuery
    ? extractQuestionTopicTerms(extractKnowledgeBaseQuestion(originalQuery))
    : [];
  const candidates: Array<{ url: string; score: number; index: number }> = [];
  const pushCandidate = (url: string, index: number, context: string) => {
    const cleanUrl = url.replace(/[.,;]+$/, "");
    const lowerContext = context.toLowerCase();
    let score = 0;
    for (const term of topicTerms) {
      if (lowerContext.includes(term)) score += term.length > 5 ? 3 : 2;
    }
    if (ORGANIZATION_ANSWER_CUES.test(context)) score += 4;
    if (/\b(?:article metadata|authored by|views?|updated|rating)\b/i.test(context)) {
      score -= 4;
    }
    candidates.push({ url: cleanUrl, score, index });
  };

  const markdownArticleLinkPattern =
    /\[[^\]]+\]\((https?:\/\/[^)\s]+(?:kb_article_view|sys_kb_id=)[^)\s]*)\)/gi;
  const markdownMatches = [...text.matchAll(markdownArticleLinkPattern)];
  for (let i = 0; i < markdownMatches.length; i += 1) {
    const match = markdownMatches[i];
    const url = match[1];
    if (!url) continue;
    const index = match.index ?? 0;
    const nextIndex = markdownMatches[i + 1]?.index;
    const context = text.slice(
      Math.max(0, index - 120),
      nextIndex == null ? index + match[0].length + 360 : nextIndex,
    );
    pushCandidate(url, index, context);
  }

  for (const match of text.matchAll(
    /https?:\/\/[^\s)]+(?:kb_article_view|sys_kb_id=)[^\s)]*/gi,
  )) {
    const url = match[0];
    if (candidates.some((candidate) => candidate.url === url.replace(/[.,;]+$/, ""))) {
      continue;
    }
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 240), index + url.length + 360);
    pushCandidate(url, index, context);
  }

  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  if (topicTerms.length > 0 && candidates[0].score <= 0) return null;
  return candidates[0].url;
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

export function shouldRouteKnowledgeBaseSearchToTopArticle(input: {
  selectedSkillId: string | null;
  toolName: ToolName;
  originalQuery: string;
  messages: unknown[];
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
  if (!/\bknowledge\s+base\b/i.test(input.originalQuery)) return null;
  if (
    input.currentUrl &&
    !isKnowledgeSearchResultsUrl(input.currentUrl)
  ) {
    return null;
  }
  for (const message of [...input.messages].reverse()) {
    const candidate = message as { role?: unknown; content?: unknown };
    if (candidate.role !== "tool" || typeof candidate.content !== "string") {
      continue;
    }
    const url = extractKnowledgeBaseArticleUrlFromRenderedText(
      candidate.content,
      input.originalQuery,
    );
    if (!url) continue;
    if (input.requestedUrl && urlsMatchIgnoringHash(input.requestedUrl, url)) {
      return null;
    }
    if (input.currentUrl && urlsMatchIgnoringHash(input.currentUrl, url)) {
      return null;
    }
    return url;
  }
  return null;
}
