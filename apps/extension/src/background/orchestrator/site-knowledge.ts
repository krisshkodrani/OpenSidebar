/**
 * Site-Specific Learning — extraction, storage, retrieval, and formatting.
 *
 * Extracts reusable site-specific tips from task execution trajectories
 * and formats them for injection into planner and executor prompts.
 *
 * Research basis: AWM, WebCoach, HMT, TIMA, AutoRefine
 * See: lab/rfcs/rfc-site-specific-learning.md
 */

import type { LLMClient } from "../llm/client";
import type { OrchestratorTask } from "./types";
import type { TaskCompletionMessage } from "../../types/messages";
import type { MemoryResult } from "../infrastructure/backend-client";
import { renderPrompt } from "../../prompts";

// ── Types ──

export interface SiteKnowledgeEntry {
  domain: string;
  tip: string;
  tipType: "strategy" | "recovery" | "optimization";
  confidence: number;
}

export interface SiteKnowledgeMemo {
  tip: string;
  tipType?: string;
  confidence: number;
}

const SITE_KNOWLEDGE_STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "are",
  "before",
  "for",
  "from",
  "get",
  "give",
  "how",
  "i",
  "in",
  "is",
  "it",
  "list",
  "me",
  "my",
  "of",
  "on",
  "please",
  "question",
  "questions",
  "show",
  "that",
  "the",
  "this",
  "to",
  "up",
  "use",
  "what",
  "with",
]);

// ── Domain utility ──

export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "chrome:" || parsed.protocol === "about:" || parsed.protocol === "chrome-extension:") {
      return null;
    }
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ── Extraction context builder ──

export function buildExtractionContext(
  task: OrchestratorTask,
  payload: TaskCompletionMessage["payload"],
  finalUrl: string | null,
): string {
  const domain = extractDomain(finalUrl || "") || "unknown";
  const sections: string[] = [
    `Domain: ${domain}`,
    `Task: ${task.query}`,
    `Outcome: ${payload.status}`,
    `Summary: ${payload.summary}`,
    "",
  ];

  for (const node of task.nodes) {
    const lines: string[] = [
      `Step: ${node.description}`,
      `Status: ${node.status}`,
    ];

    if (node.retries > 0) {
      lines.push(`Retries: ${node.retries}`);
    }

    if (node.error) {
      lines.push(`Error: ${node.error.slice(0, 200)}`);
    }

    if (node.result) {
      lines.push(`Result: ${node.result.slice(0, 200)}`);
    }

    for (const entry of node.reflexionLog) {
      lines.push(
        `  Attempt ${entry.attempt}: ${entry.verifierDecision}` +
          (entry.failureType ? ` (${entry.failureType})` : "") +
          ` — ${entry.verifierReason.slice(0, 150)}`,
      );
      if (entry.suggestedApproach) {
        lines.push(`  Suggested: ${entry.suggestedApproach.slice(0, 150)}`);
      }
    }

    sections.push(lines.join("\n"));
  }

  // Cap total context to ~1500 tokens (~6000 chars)
  const full = sections.join("\n");
  return full.length > 6000 ? full.slice(0, 6000) + "\n[truncated]" : full;
}

// ── LLM-based extraction (primary path) ──

const EXTRACTION_SYSTEM_PROMPT = renderPrompt(
  "orchestrator.site_knowledge_extraction.system",
);

export async function extractSiteKnowledge(
  context: string,
  domain: string,
  client: LLMClient,
): Promise<SiteKnowledgeEntry[]> {
  const response = await client.complete({
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: context },
    ],
    temperature: 0.2,
    max_tokens: 512,
    response_format: { type: "json_object" },
    signal: AbortSignal.timeout(10_000),
  });

  const text = (response.content || "").trim();
  if (!text) return [];

  try {
    let parsed = JSON.parse(text);
    // Handle both array and { tips: [] } formats
    if (!Array.isArray(parsed)) {
      if (Array.isArray(parsed.tips)) parsed = parsed.tips;
      else return [];
    }

    return parsed
      .filter(
        (e: Record<string, unknown>) =>
          typeof e.tip === "string" &&
          e.tip.length > 5 &&
          ["strategy", "recovery", "optimization"].includes(e.tipType as string),
      )
      .slice(0, 4)
      .map((e: Record<string, unknown>) => ({
        domain,
        tip: (e.tip as string).slice(0, 200),
        tipType: e.tipType as SiteKnowledgeEntry["tipType"],
        confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0.5)),
      }));
  } catch {
    return [];
  }
}

// ── Rule-based extraction (fallback) ──

const BLOCKER_PATTERNS: Array<{ pattern: RegExp; tip: string }> = [
  { pattern: /cookie|consent|gdpr/i, tip: "Dismiss cookie/consent banner before interacting with page elements" },
  { pattern: /overlay|popup|modal|dialog/i, tip: "Close overlays or modals before clicking underlying elements" },
  { pattern: /captcha/i, tip: "This site uses CAPTCHA — escalate if automated interaction is blocked" },
  { pattern: /login|sign.?in|auth/i, tip: "This site requires login — check authentication state before proceeding" },
  { pattern: /paywall|subscribe/i, tip: "This site has a paywall — content may be inaccessible without subscription" },
];

const ERROR_PATTERNS: Array<{ pattern: RegExp; tip: string }> = [
  { pattern: /rate.?limit|too many|429/i, tip: "This site has rate limiting — add delays between rapid actions" },
  { pattern: /bot|automated|selenium|webdriver/i, tip: "This site has bot detection — avoid rapid sequential interactions" },
  { pattern: /lazy.?load|infinite.?scroll|dynamic/i, tip: "Page content loads dynamically — scroll or wait before reading full content" },
  { pattern: /iframe|shadow.?dom|web.?component/i, tip: "Key elements may be inside iframes or shadow DOM — use xray_page to inspect" },
];

export function extractSiteKnowledgeFallback(
  task: OrchestratorTask,
  payload: TaskCompletionMessage["payload"],
  domain: string,
): SiteKnowledgeEntry[] {
  const entries: SiteKnowledgeEntry[] = [];
  const seen = new Set<string>();

  function addIfNew(tip: string, tipType: SiteKnowledgeEntry["tipType"], confidence: number) {
    const key = tip.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ domain, tip, tipType, confidence });
  }

  for (const node of task.nodes) {
    // Rule 1: Blocker patterns from reflexion logs
    for (const entry of node.reflexionLog) {
      if (entry.failureType === "blocked" || entry.verifierDecision === "retry") {
        const text = `${entry.verifierReason} ${entry.executorSummary}`;
        for (const bp of BLOCKER_PATTERNS) {
          if (bp.pattern.test(text)) {
            addIfNew(bp.tip, "recovery", entry.confidence);
          }
        }
      }

      // Rule 2: Transient workarounds
      if (entry.failureType === "transient" && entry.suggestedApproach) {
        addIfNew(
          `On retry: ${entry.suggestedApproach.slice(0, 150)}`,
          "recovery",
          0.7,
        );
      }

      // Rule 3: Reroute lessons
      if (entry.verifierDecision === "reroute" && entry.suggestedApproach) {
        addIfNew(
          `Alternative approach: ${entry.suggestedApproach.slice(0, 150)}`,
          "strategy",
          0.75,
        );
      }
    }

    // Rule 4: Success after retry
    if (
      node.status === "completed" &&
      node.retries > 0 &&
      node.reflexionLog.length > 0
    ) {
      const last = node.reflexionLog[node.reflexionLog.length - 1];
      if (last.suggestedApproach) {
        addIfNew(
          last.suggestedApproach.slice(0, 150),
          "strategy",
          0.8,
        );
      }
    }

    // Rule 5: Error patterns
    if (node.error) {
      for (const ep of ERROR_PATTERNS) {
        if (ep.pattern.test(node.error)) {
          addIfNew(ep.tip, "recovery", 0.7);
        }
      }
    }
  }

  return entries.slice(0, 4);
}

// ── Deduplication ──

export function deduplicateSiteKnowledge(
  memories: MemoryResult[],
): SiteKnowledgeMemo[] {
  const seen = new Set<string>();
  const results: SiteKnowledgeMemo[] = [];

  for (const mem of memories) {
    const normalized = mem.content.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const meta = mem.metadata as Record<string, unknown> | undefined;
    results.push({
      tip: mem.content,
      tipType: (meta?.tipType as string) ?? undefined,
      confidence: (meta?.confidence as number) ?? 0.7,
    });
  }

  return results;
}

function tokenizeForRanking(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !SITE_KNOWLEDGE_STOP_WORDS.has(token));
}

export function rankSiteKnowledgeForTask(
  entries: SiteKnowledgeMemo[],
  query: string,
  maxEntries = 3,
): SiteKnowledgeMemo[] {
  if (entries.length === 0) return [];

  const queryTokens = new Set(tokenizeForRanking(query));
  const ranked = entries
    .map((entry, index) => {
      const tipTokens = tokenizeForRanking(entry.tip);
      const overlapCount = tipTokens.filter((token) => queryTokens.has(token)).length;
      const overlapScore = overlapCount * 0.35;
      const tipTypeBoost =
        entry.tipType === "strategy" ? 0.08 :
        entry.tipType === "recovery" ? 0.04 :
        0;
      return {
        entry,
        index,
        score: entry.confidence + overlapScore + tipTypeBoost,
        overlapCount,
      };
    })
    .sort((a, b) => {
      if (b.overlapCount !== a.overlapCount) return b.overlapCount - a.overlapCount;
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .slice(0, maxEntries);

  return ranked.map((item) => item.entry);
}

// ── Prompt formatting ──

export function formatSiteKnowledgeForPrompt(
  entries: SiteKnowledgeMemo[],
): string {
  if (entries.length === 0) return "";

  // Sort by confidence descending, take top 4
  const sorted = [...entries]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);

  const lines = sorted.map((e) => {
    const prefix = e.tipType ? `[${e.tipType}] ` : "";
    return `- ${prefix}${e.tip}`;
  });

  // Cap total to ~800 chars
  let result = "SITE KNOWLEDGE (learned from prior visits to this domain):\n";
  for (const line of lines) {
    if (result.length + line.length > 800) break;
    result += line + "\n";
  }

  return result.trimEnd();
}
