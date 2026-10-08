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
