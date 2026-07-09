/**
 * ServiceNow adapter — knowledge-base search tool (RFC LP-16 Phase 4).
 *
 * Relocated verbatim from tools/index.ts, then split by tool concern so no
 * single adapter file is itself a landmine. Registered at its original ordinal
 * position in registerTools() to keep LLM-facing definition order unchanged.
 * Import-direction rule: never imports "../index" or the tools barrel.
 */

import type { ToolRegistry } from "../registry";
import { ToolName } from "../../../types";
import { logger } from "../../../utils";
import {
  SEARCH_KNOWLEDGE_BASE_DEF,
} from "../definitions";

import {
  runAsyncReadOnlyPageInspector,
} from "../page-inspector";

export function registerServiceNowKnowledgeBaseTool(
  toolRegistry: ToolRegistry,
): void {
  toolRegistry.register(
    ToolName.SEARCH_KNOWLEDGE_BASE,
    SEARCH_KNOWLEDGE_BASE_DEF,
    async (args, tabId) => {
      const question =
        typeof args.question === "string" ? args.question.trim() : "";
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const answerType =
        args.answerType === "number" || args.answerType === "text"
          ? args.answerType
          : "auto";
      const maxResults = Math.min(
        Math.max(Number(args.maxResults ?? 5) || 5, 1),
        10,
      );

      if (!question) {
        return "Error: search_knowledge_base requires a question.";
      }

      logger.info("tools", "search_knowledge_base", {
        tabId,
        question: question.slice(0, 160),
        query,
        answerType,
        maxResults,
      });

      return runAsyncReadOnlyPageInspector(
        tabId,
        async (
          input: {
            question: string;
            query: string;
            answerType: string;
            maxResults: number;
          },
        ) => {
          const normalize = (value: unknown) =>
            String(value ?? "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          const stopWords = new Set([
            "a",
            "an",
            "and",
            "are",
            "answer",
            "as",
            "at",
            "be",
            "by",
            "base",
            "company",
            "does",
            "each",
            "for",
            "following",
            "from",
            "how",
            "in",
            "is",
            "it",
            "knowledge",
            "make",
            "many",
            "of",
            "on",
            "or",
            "our",
            "requested",
            "should",
            "the",
            "this",
            "to",
            "typically",
            "using",
            "what",
            "when",
            "where",
            "who",
            "which",
            "with",
            "would",
            "year",
            "your",
          ]);
          const keywords = (text: string) => {
            const words = normalize(text)
              .toLowerCase()
              .match(/[a-z0-9]+/g);
            return [...new Set(words ?? [])].filter(
              (word) => word.length > 2 && !stopWords.has(word),
            );
          };
          const terms = keywords(`${input.question} ${input.query}`);
          const answerIntentTerms = new Set([
            "amount",
            "count",
            "number",
            "percent",
            "percentage",
            "total",
          ]);
          const questionTopicTerms = keywords(input.question).filter(
            (term) => !answerIntentTerms.has(term),
          );
          const queryTerms = keywords(input.query).filter(
            (term) => !answerIntentTerms.has(term),
          );
          const lowValueQuestionTerms = new Set([
            "answer",
            "charged",
            "ensuring",
            "following",
            "full",
            "name",
            "numeric",
            "please",
            "state",
            "value",
          ]);
          const focusedQuestionTopicTerms = questionTopicTerms.filter(
            (term) => !lowValueQuestionTerms.has(term),
          );
          const hasHiringQuestion =
            /\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(
              input.question,
            );
          const hasAuditQuestion =
            /\b(?:audits?|auditors?|financial reporting|accounting)\b/i.test(
              input.question,
            );
          const expandedTopicVariants = [
            ...(hasHiringQuestion
              ? [
                  "new hires",
                  "hires",
                  "hiring",
                  "recruitment",
                  "headcount",
                  "careers opportunities",
                  "talent acquisition",
                  "team expansion",
                ]
              : []),
            ...(hasAuditQuestion
              ? [
                  "financial reporting",
                  "audit integrity",
                  "auditor",
                  "accounting controls",
                ]
              : []),
          ];
          const escapeRegExp = (value: string) =>
            value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const hasTermCue = (text: string, term: string) => {
            if (!term) return false;
            const escaped = escapeRegExp(term);
            if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return true;
            if (
              term.endsWith("s") &&
              new RegExp(`\\b${escapeRegExp(term.slice(0, -1))}\\b`, "i").test(
                text,
              )
            ) {
              return true;
            }
            return false;
          };
          const hasQuestionTopicCue = (text: string) => {
            if (hasHiringQuestion) {
              return /\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(
                text,
              );
            }
            const topicTerms =
              focusedQuestionTopicTerms.length > 0
                ? focusedQuestionTopicTerms
                : questionTopicTerms;
            return (
              topicTerms.length === 0 ||
              topicTerms.some((term) => hasTermCue(text, term))
            );
          };
          const queryText =
            input.query ||
            terms.slice(0, 6).join(" ") ||
            normalize(input.question);
          const uniqueNonEmpty = (values: string[]) =>
            values
              .map((value) => value.trim())
              .filter(
                (value, index, all) => Boolean(value) && all.indexOf(value) === index,
              );
          const queryVariants = uniqueNonEmpty([
            input.query,
            queryText,
            focusedQuestionTopicTerms.slice(0, 4).join(" "),
            queryTerms.slice(0, 4).join(" "),
            questionTopicTerms.slice(0, 4).join(" "),
            expandedTopicVariants[0] ?? "",
          ]).slice(0, 5);
          const renderedSearchQueryText =
            focusedQuestionTopicTerms.slice(0, 3).join(" ") ||
            questionTopicTerms.slice(0, 3).join(" ") ||
            queryText;
          const wantsNumber =
            input.answerType === "number" ||
            (input.answerType === "auto" &&
              /\b(number|count|how many|percent|percentage|amount|total|year|date)\b/i.test(
                input.question,
              ));
          const scoreText = (text: string) => {
            const lower = normalize(text).toLowerCase();
            let score = 0;
            for (const term of terms) {
              if (lower.includes(term)) score += term.length > 5 ? 3 : 2;
            }
            if (/\b(new hires?|hire|hiring|recruitment|recruits?)\b/i.test(text)) {
              score += 5;
            }
            if (
              hasHiringQuestion &&
              /\b(?:careers?|opportunit(?:y|ies)|talent acquisition|team expansion)\b/i.test(
                text,
              )
            ) {
              score += 4;
            }
            if (/\b(year|annual|annually|each year|per year)\b/i.test(text)) {
              score += 4;
            }
            if (/\b\d[\d,]*(?:\.\d+)?\b/.test(text)) score += 3;
            if (/\b(views?|rating|updated|authored|metadata|kb\d+)\b/i.test(text)) {
              score -= 8;
            }
            return score;
          };
          const absoluteUrl = (href: string) => {
            try {
              return new URL(href, location.href).href;
            } catch {
              return "";
            }
          };
          const startedAt = Date.now();
          const hasBudget = () => Date.now() - startedAt < 18000;
          const fetchWithTimeout = async (
            url: string,
            init: RequestInit = {},
            timeoutMs = 4000,
          ) => {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
              return await fetch(url, {
                ...init,
                signal: controller.signal,
              });
            } finally {
              window.clearTimeout(timeout);
            }
          };
          const targetUrl = (href: string) => {
            const direct = absoluteUrl(href);
            if (!direct) return "";
            try {
              const parsed = new URL(direct);
              if (parsed.pathname.includes("/now/nav/ui/classic/params/target/")) {
                const encoded = parsed.pathname.split("/target/")[1] || "";
                return new URL(decodeURIComponent(encoded) + parsed.search, parsed.origin).href;
              }
            } catch {
              return direct;
            }
            return direct;
          };
          const isKnowledgeArticleUrl = (url: string) =>
            /(?:kb_article_view|\/article-|sys_kb_id=|sysparm_article=|kb_knowledge\.do|kb_view\.do)/i.test(
              url,
            );
          const searchUrls = () => {
            const urls = new Set<string>();
            try {
              const current = new URL(location.href);
              const currentKnowledgeBase = current.searchParams.get("kb_knowledge_base");
              for (const variant of queryVariants) {
                const encoded = encodeURIComponent(variant);
                if (current.pathname.includes("/kb")) {
                  urls.add(new URL(`?id=kb_search&query=${encoded}`, current.href).href);
                  if (currentKnowledgeBase) {
                    urls.add(
                      new URL(
                        `?id=kb_search&kb_knowledge_base=${encodeURIComponent(
                          currentKnowledgeBase,
                        )}&query=${encoded}`,
                        current.href,
                      ).href,
                    );
                  }
                }
                urls.add(new URL(`/kb?id=kb_search&query=${encoded}`, current.origin).href);
                urls.add(new URL(`/sp?id=kb_search&query=${encoded}`, current.origin).href);
              }
            } catch {
              // Ignore malformed locations.
            }
            return [...urls];
          };
          const scopedKnowledgeSearchUrlsFromDocument = (doc: Document) => {
            const encoded = encodeURIComponent(queryText);
            const urls = new Set<string>();
            for (const anchor of [
              ...doc.querySelectorAll<HTMLAnchorElement>("a[href]"),
            ]) {
              const href = anchor.getAttribute("href") || "";
              let parsed: URL;
              try {
                parsed = new URL(href, location.href);
              } catch {
                continue;
              }
              const knowledgeBase = parsed.searchParams.get("kb_knowledge_base");
              if (!knowledgeBase) continue;
              parsed.searchParams.set("id", "kb_search");
              parsed.searchParams.set("query", queryText);
              urls.add(parsed.href);
              try {
                urls.add(
                  new URL(
                    `/kb?id=kb_search&kb_knowledge_base=${encodeURIComponent(
                      knowledgeBase,
                    )}&query=${encoded}`,
                    location.origin,
                  ).href,
                );
              } catch {
                // Keep the href-based scoped search URL.
              }
            }
            return [...urls].slice(0, 8);
          };
          const collectDeep = <T extends Element>(
            root: Document | DocumentFragment | Element,
            selector: string,
          ): T[] => {
            const results = [
              ...root.querySelectorAll<T>(selector),
            ];
            for (const element of root.querySelectorAll<Element>("*")) {
              const shadowRoot = element.shadowRoot;
              if (shadowRoot) {
                results.push(...collectDeep<T>(shadowRoot, selector));
              }
            }
            return results;
          };
          const textFromDom = (
            root: Document | DocumentFragment | Element | ChildNode | null,
          ) => {
            const parts: string[] = [];
            const visit = (node: ChildNode | Document | DocumentFragment | null) => {
              if (!node || parts.join(" ").length > 60000) return;
              if (node.nodeType === Node.TEXT_NODE) {
                const text = normalize(node.textContent || "");
                if (text) parts.push(text);
                return;
              }
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (/^(script|style|noscript|svg)$/i.test(element.tagName)) {
                  return;
                }
                if (element.shadowRoot) visit(element.shadowRoot);
              }
              for (const child of [...node.childNodes]) visit(child);
            };
            visit(root);
            return normalize(parts.join(" "));
          };
          const cleanDocument = (doc: Document) =>
            normalize((doc.body as HTMLElement | null)?.innerText || textFromDom(doc));
          const resultLinksFromDocument = (doc: Document) => {
            const links = collectDeep<HTMLAnchorElement>(doc, "a[href]");
            const nearbyTextForAnchor = (anchor: HTMLAnchorElement) => {
              const title = normalize(
                anchor.innerText ||
                  textFromDom(anchor) ||
                  anchor.getAttribute("aria-label") ||
                  anchor.getAttribute("href") ||
                  "",
              );
              const focusAroundTitle = (text: string) => {
                if (text.length <= 800 || !title) return text;
                const index = text.toLowerCase().indexOf(title.toLowerCase());
                if (index < 0) return text;
                const start = Math.max(0, index - 80);
                return text.slice(start, start + 1100);
              };
              let best = title;
              let bestScore = scoreText(title);
              let current: Element | null = anchor;
              for (let depth = 0; current && depth < 7; depth += 1) {
                const text = focusAroundTitle(textFromDom(current));
                if (!text || text.length < title.length) {
                  current = current.parentElement;
                  continue;
                }
                let score = scoreText(text);
                if (text.length > title.length + 80) score += 5;
                if (text.length > 1400) score -= 3;
                if (score > bestScore) {
                  best = text;
                  bestScore = score;
                }
                current = current.parentElement;
              }
              return best;
            };
            return links
              .map((anchor) => {
                const href = anchor.getAttribute("href") || "";
                const url = targetUrl(href);
                const title = normalize(
                  anchor.innerText ||
                    anchor.textContent ||
                    anchor.getAttribute("aria-label") ||
                    href,
                );
                const nearby = nearbyTextForAnchor(anchor);
                return { title, url, snippet: nearby.slice(0, 800) };
              })
              .filter(
                (entry) =>
                  entry.url &&
                  entry.title &&
                  isKnowledgeArticleUrl(entry.url),
              );
          };
          const fetchDocument = async (url: string) => {
            const response = await fetchWithTimeout(url, {
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const html = await response.text();
            return new DOMParser().parseFromString(html, "text/html");
          };
          const textFromHtml = (html: string) => {
            const doc = new DOMParser().parseFromString(html || "", "text/html");
            return normalize(doc.body?.innerText || doc.body?.textContent || html);
          };
          const textFromJson = (value: unknown) => {
            const strings: string[] = [];
            const visit = (entry: unknown, depth: number) => {
              if (depth > 8 || strings.join(" ").length > 24000) return;
              if (typeof entry === "string") {
                const text = normalize(entry.replace(/<[^>]+>/g, " "));
                if (text.length > 2 && !/^[-_a-z0-9:/.?=&%]+$/i.test(text)) {
                  strings.push(text);
                }
                return;
              }
              if (Array.isArray(entry)) {
                for (const item of entry) visit(item, depth + 1);
                return;
              }
              if (entry && typeof entry === "object") {
                for (const item of Object.values(entry as Record<string, unknown>)) {
                  visit(item, depth + 1);
                }
              }
            };
            visit(value, 0);
            let serialized = "";
            try {
              serialized = JSON.stringify(value)
                .replace(/<[^>]+>/g, " ")
                .replace(/[{}[\]",:]/g, " ");
            } catch {
              serialized = "";
            }
            return normalize(`${strings.join(" ")} ${serialized}`);
          };
          const fetchServicePortalPagePayload = async (
            pageId: string,
            params: Record<string, string>,
          ) => {
            if (!hasBudget()) return null;
            try {
              const queryParams = new URLSearchParams({
                sysparm_type: "page",
                sysparm_id: pageId,
                ...params,
              });
              const response = await fetchWithTimeout(
                `/api/now/sp/page?${queryParams.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (!response.ok) return "";
              return await response.json().catch(() => null);
            } catch {
              return null;
            }
          };
          const fetchServicePortalPageText = async (
            pageId: string,
            params: Record<string, string>,
          ) => {
            const payload = await fetchServicePortalPagePayload(pageId, params);
            const text = textFromJson(payload);
            return text === "null" ? "" : text;
          };
          const sysKbIdFromUrl = (url: string) => {
            try {
              const parsed = new URL(url, location.href);
              return normalize(
                parsed.searchParams.get("sys_kb_id") ||
                  parsed.searchParams.get("sys_id") ||
                  parsed.searchParams.get("sysparm_article"),
              );
            } catch {
              return "";
            }
          };
          const slugFromTitle = (title: string) =>
            normalize(title)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
          const articleNumbersFromText = (text: string) => {
            const numbers = new Set<string>();
            for (const match of normalize(text).matchAll(/\bKB\d{4,}\b/gi)) {
              numbers.add(match[0].toUpperCase());
            }
            const articleMatch = normalize(text).match(/\bArticle\s+(\d{1,5})\b/i);
            if (articleMatch) {
              const articleIndex = articleMatch[1];
              numbers.add(`KB${articleIndex.padStart(7, "0")}`);
              numbers.add(`KB001${articleIndex.padStart(4, "0")}`);
            }
            return [...numbers];
          };
          const articleFetchUrls = (result: { title: string; url: string }) => {
            const urls = new Set<string>([result.url]);
            const sysKbId = sysKbIdFromUrl(result.url);
            const slug = slugFromTitle(result.title);
            try {
              const parsed = new URL(result.url, location.href);
              if (sysKbId) {
                urls.add(
                  new URL(
                    `/kb_view.do?sys_kb_id=${encodeURIComponent(sysKbId)}`,
                    parsed.origin,
                  ).href,
                );
                urls.add(
                  new URL(
                    `/kb_knowledge.do?sys_id=${encodeURIComponent(sysKbId)}`,
                    parsed.origin,
                  ).href,
                );
              }
              if (sysKbId && slug) {
                const basePath = parsed.pathname.startsWith("/kb/en")
                  ? "/kb/en"
                  : "/kb/en";
                urls.add(
                  new URL(
                    `${basePath}/${slug}?sys_kb_id=${encodeURIComponent(sysKbId)}&id=kb_article_view`,
                    parsed.origin,
                  ).href,
                );
              }
              for (const articleNumber of articleNumbersFromText(result.title)) {
                urls.add(
                  new URL(
                    `/kb_view.do?sysparm_article=${encodeURIComponent(articleNumber)}`,
                    parsed.origin,
                  ).href,
                );
              }
            } catch {
              // Keep the original URL when canonical route construction fails.
            }
            return [...urls];
          };
          const recordFromKnowledgeRow = (row: any) => {
            if (!row) return null;
            const number = normalize(
              row?.number?.display_value ?? row?.number?.value ?? row?.number,
            );
            const title = normalize(
              row?.short_description?.display_value ??
                row?.short_description?.value ??
                row?.short_description ??
                number,
            );
            const text = textFromHtml(
              normalize(row?.text?.display_value ?? row?.text?.value ?? row?.text),
            );
            if (!text) return null;
            return {
              title: number && title ? `${number} ${title}` : title,
              text,
            };
          };
          const fetchServiceNowKnowledgeRecordBySysId = async (sysId: string) => {
            if (!sysId || !hasBudget()) return null;
            try {
              const params = new URLSearchParams({
                sysparm_query: `sys_id=${sysId}`,
                sysparm_fields: "sys_id,number,short_description,text",
                sysparm_limit: "1",
                sysparm_display_value: "all",
              });
              const response = await fetchWithTimeout(
                `/api/now/table/kb_knowledge?${params.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (!response.ok) return null;
              const payload = await response.json().catch(() => null);
              const row = Array.isArray(payload?.result)
                ? payload.result[0]
                : null;
              const record = recordFromKnowledgeRow(row);
              if (record) return record;
            } catch {
              // Try the direct record API below.
            }
            try {
              const params = new URLSearchParams({
                sysparm_fields: "sys_id,number,short_description,text",
                sysparm_display_value: "all",
              });
              const response = await fetchWithTimeout(
                `/api/now/table/kb_knowledge/${encodeURIComponent(sysId)}?${params.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (response.ok) {
                const payload = await response.json().catch(() => null);
                const record = recordFromKnowledgeRow(payload?.result);
                if (record) return record;
              }
            } catch {
              // Try legacy HTML article endpoints below.
            }
            const portalText = await fetchServicePortalPageText(
              "kb_article_view",
              { sys_kb_id: sysId },
            );
            if (portalText) {
              return {
                title: `Knowledge article ${sysId}`,
                text: portalText,
              };
            }
            const legacyArticleUrls = [
              `/kb_view.do?sys_kb_id=${encodeURIComponent(sysId)}`,
              `/kb_knowledge.do?sys_id=${encodeURIComponent(sysId)}`,
            ];
            for (const url of legacyArticleUrls) {
              if (!hasBudget()) break;
              try {
                const doc = await fetchDocument(url);
                const text = cleanDocument(doc);
                if (text) {
                  return {
                    title: `Knowledge article ${sysId}`,
                    text,
                  };
                }
              } catch {
                // Keep trying available ServiceNow article shapes.
              }
            }
            return null;
          };
          const fetchServiceNowKnowledgeRecordByNumber = async (
            articleNumber: string,
          ) => {
            const number = normalize(articleNumber).toUpperCase();
            if (!number || !hasBudget()) return null;
            try {
              const params = new URLSearchParams({
                sysparm_query: `number=${number}`,
                sysparm_fields: "sys_id,number,short_description,text",
                sysparm_limit: "1",
                sysparm_display_value: "all",
              });
              const response = await fetchWithTimeout(
                `/api/now/table/kb_knowledge?${params.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (response.ok) {
                const payload = await response.json().catch(() => null);
                const row = Array.isArray(payload?.result)
                  ? payload.result[0]
                  : null;
                const record = recordFromKnowledgeRow(row);
                if (record) return record;
              }
            } catch {
              // Try classic article pages below.
            }
            const portalText = await fetchServicePortalPageText(
              "kb_article_view",
              { sysparm_article: number },
            );
            if (portalText) {
              return {
                title: `Knowledge article ${number}`,
                text: portalText,
              };
            }
            const legacyArticleUrls = [
              `/kb_view.do?sysparm_article=${encodeURIComponent(number)}`,
              `/kb_knowledge.do?sysparm_query=number=${encodeURIComponent(number)}`,
            ];
            for (const url of legacyArticleUrls) {
              if (!hasBudget()) break;
              try {
                const doc = await fetchDocument(url);
                const text = cleanDocument(doc);
                if (text) {
                  return {
                    title: `Knowledge article ${number}`,
                    text,
                  };
                }
              } catch {
                // Keep trying available ServiceNow article shapes.
              }
            }
            return null;
          };
          const fetchServiceNowKnowledgeRecords = async () => {
            const looksLikeServiceNow =
              /service-now\.com$/i.test(location.hostname) ||
              /\/now\/|\/kb(?:\?|\/|$)|\/sp(?:\?|\/|$)/i.test(location.pathname);
            if (!looksLikeServiceNow) return [];
            const records: Array<{ title: string; url: string; snippet: string; text: string }> = [];
            const seenRecordUrls = new Set<string>();
            const appendRecords = async (params: URLSearchParams) => {
              if (!hasBudget()) return;
              const response = await fetchWithTimeout(
                `/api/now/table/kb_knowledge?${params.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (!response.ok) return;
              const payload = await response.json().catch(() => null);
              const result = Array.isArray(payload?.result) ? payload.result : [];
              for (const row of result) {
                const sysId = normalize(row?.sys_id?.value ?? row?.sys_id);
                const number = normalize(row?.number?.display_value ?? row?.number?.value ?? row?.number);
                const title = normalize(
                  row?.short_description?.display_value ??
                    row?.short_description?.value ??
                    row?.short_description ??
                    number,
                );
                const text = textFromHtml(
                  normalize(row?.text?.display_value ?? row?.text?.value ?? row?.text),
                );
                if (!title || !text) continue;
                const url = sysId
                  ? new URL(
                      `/kb?id=kb_article_view&sys_kb_id=${encodeURIComponent(sysId)}`,
                      location.origin,
                    ).href
                  : new URL(`/kb?id=kb_search&query=${encodeURIComponent(queryText)}`, location.origin).href;
                if (seenRecordUrls.has(url)) continue;
                seenRecordUrls.add(url);
                records.push({
                  title: number ? `${number} ${title}` : title,
                  url,
                  snippet: text.slice(0, 800),
                  text,
                });
              }
            };
            for (const variant of queryVariants) {
              if (!hasBudget()) break;
              const params = new URLSearchParams({
                sysparm_query: `short_descriptionLIKE${variant}^ORtextLIKE${variant}`,
                sysparm_fields: "sys_id,number,short_description,text",
                sysparm_limit: String(Math.max(input.maxResults, 5)),
                sysparm_display_value: "all",
              });
              try {
                await appendRecords(params);
              } catch {
                // Some ServiceNow portals do not expose the table API to the current user.
              }
            }
            try {
              await appendRecords(
                new URLSearchParams({
                  sysparm_query: "workflow_state=published^ORDERBYDESCsys_updated_on",
                  sysparm_fields: "sys_id,number,short_description,text",
                  sysparm_limit: "25",
                  sysparm_display_value: "all",
                }),
              );
            } catch {
              try {
                await appendRecords(
                  new URLSearchParams({
                    sysparm_fields: "sys_id,number,short_description,text",
                    sysparm_limit: "25",
                    sysparm_display_value: "all",
                  }),
                );
              } catch {
                // Keep portal results when table scanning is unavailable.
              }
            }
            return records;
          };
          const fetchServicePortalKnowledgeSearchRecords = async () => {
            const records: Array<{
              title: string;
              url: string;
              snippet: string;
              text: string;
            }> = [];
            const addPortalPayloadRecords = (
              payload: unknown,
              fallbackUrl: string,
            ) => {
              const visit = (entry: unknown, depth: number) => {
                if (depth > 8 || records.length >= 25) return;
                if (Array.isArray(entry)) {
                  for (const item of entry) visit(item, depth + 1);
                  return;
                }
                if (!entry || typeof entry !== "object") return;
                const item = entry as Record<string, unknown>;
                const title = normalize(
                  item.title ??
                    item.short_description ??
                    item.label ??
                    item.name ??
                    item.number,
                );
                const snippet = textFromJson(
                  item.snippet ??
                    item.summary ??
                    item.text ??
                    item.description ??
                    item.content ??
                    item,
                );
                const rawUrl = normalize(
                  item.url ?? item.link ?? item.href ?? item.target_url,
                );
                const sysId = normalize(
                  item.sys_id ??
                    item.sys_kb_id ??
                    item.kb_knowledge ??
                    item.id,
                );
                let url = rawUrl ? absoluteUrl(rawUrl) : "";
                if (!url && sysId && /^[0-9a-f]{32}$/i.test(sysId)) {
                  url = new URL(
                    `/kb?id=kb_article_view&sys_kb_id=${encodeURIComponent(sysId)}`,
                    location.origin,
                  ).href;
                }
                if (
                  title &&
                  snippet &&
                  url &&
                  (isKnowledgeArticleUrl(url) || hasQuestionTopicCue(snippet))
                ) {
                  records.push({
                    title,
                    url,
                    snippet: snippet.slice(0, 800),
                    text: snippet,
                  });
                }
                for (const value of Object.values(item)) visit(value, depth + 1);
              };
              visit(payload, 0);
              if (records.length === 0) {
                const text = textFromJson(payload);
                if (text && text !== "null") {
                  records.push({
                    title: "Service Portal knowledge search",
                    url: fallbackUrl,
                    snippet: text.slice(0, 800),
                    text,
                  });
                }
              }
            };
            for (const variant of queryVariants) {
              if (!hasBudget()) break;
              const payload = await fetchServicePortalPagePayload("kb_search", {
                query: variant,
              });
              if (payload == null) continue;
              const text = textFromJson(payload);
              if (!text || text === "null") continue;
              const url = new URL(
                `/kb?id=kb_search&query=${encodeURIComponent(variant)}`,
                location.origin,
              ).href;
              addPortalPayloadRecords(payload, url);
              records.push({
                title: `Service Portal knowledge search: ${variant}`,
                url,
                snippet: text.slice(0, 800),
                text,
              });
            }
            return records;
          };
          const splitSentences = (text: string) =>
            normalize(text)
              .split(/(?<=[.!?])\s+|\n+/)
              .map(normalize)
              .filter((sentence) => sentence.length > 20);
          const extractAnswer = (articleText: string) => {
            const sentences = splitSentences(articleText);
            let best: { sentence: string; answer: string; score: number } | null =
              null;
            const chooseNumber = (sentence: string) => {
              const matches = [
                ...sentence.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g),
              ];
              let bestNumber: { value: string; score: number } | null = null;
              for (const match of matches) {
                const value = normalize(match[0]);
                const index = match.index ?? 0;
                const before = sentence.slice(Math.max(0, index - 80), index);
                const after = sentence.slice(index, index + 80);
                const localContext = `${before} ${after}`;
                if (/\b\d{1,3}(?:,\d{3})*\s+results?\s+for\b/i.test(localContext)) {
                  continue;
                }
                if (
                  hasHiringQuestion &&
                  /[$]|\b(?:budget|spending|costs?|expense|expenses|funding|csr|corporate social responsibility)\b/i.test(
                    localContext,
                  )
                ) {
                  continue;
                }
                let score = 0;
                if (
                  /\b(?:is|are|was|were|has|have|contains?|includes?|makes?|made|typically|usually|annual(?:ly)?|yearly|each year|per year|hires?|employees?|headcount|count|total)\b/i.test(
                    before,
                  )
                ) {
                  score += 10;
                }
                if (/\b(?:hires?|employees?|headcount|count|total|floors?|levels?|stories|storeys)\b/i.test(after)) {
                  score += 4;
                }
                if (/\.\d+$/.test(value)) score -= 4;
                if (/\b(?:article|relevancy|rank|views?|rating|updated|authored|kb)\b/i.test(before.slice(-24))) {
                  score -= 12;
                }
                if (!bestNumber || score > bestNumber.score) {
                  bestNumber = { value, score };
                }
              }
              return bestNumber && bestNumber.score > 0 ? bestNumber.value : "";
            };
            for (const sentence of sentences) {
              const numberMatches = [
                ...sentence.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g),
              ];
              if (wantsNumber && numberMatches.length === 0) continue;
              if (wantsNumber && !hasQuestionTopicCue(sentence)) continue;
              let sentenceScore = scoreText(sentence);
              if (/\b(?:typically|usually|annually|each year|per year|new hires?)\b/i.test(sentence)) {
                sentenceScore += 8;
              }
              if (/\b(?:views?|rating|updated|authored|metadata)\b/i.test(sentence)) {
                sentenceScore -= 20;
              }
              const answer = wantsNumber
                ? chooseNumber(sentence)
                : sentence;
              if (!answer) continue;
              if (!best || sentenceScore > best.score) {
                best = { sentence, answer, score: sentenceScore };
              }
            }
            return best;
          };

          const searchResults: Array<{
            title: string;
            url: string;
            snippet: string;
            text?: string;
          }> = [];
          const articleCandidates: Array<{
            title: string;
            url: string;
            answer: string;
            sentence: string;
            score: number;
          }> = [];
          const seenUrls = new Set<string>();
          const rankSearchResults = (
            results: Array<{
              title: string;
              url: string;
              snippet: string;
              text?: string;
            }>,
          ) =>
            results
              .map((entry) => ({
                ...entry,
                score: scoreText(`${entry.title} ${entry.snippet}`),
              }))
              .sort((a, b) => b.score - a.score)
              .slice(0, Math.max(input.maxResults, 20));
          const addAnswerCandidatesFromResults = async (
            results: ReturnType<typeof rankSearchResults>,
          ) => {
            for (const result of results) {
              if (!hasBudget()) break;
              if (result.text) {
                const extracted = extractAnswer(
                  `${result.title}. ${result.snippet}. ${result.text}`,
                );
                if (!extracted) continue;
                articleCandidates.push({
                  title: result.title,
                  url: result.url,
                  answer: extracted.answer,
                  sentence: extracted.sentence,
                  score: result.score + extracted.score,
                });
                continue;
              }
              const sysKbId = sysKbIdFromUrl(result.url);
              const serviceNowRecord =
                await fetchServiceNowKnowledgeRecordBySysId(sysKbId);
              if (serviceNowRecord) {
                const extracted = extractAnswer(
                  `${serviceNowRecord.title || result.title}. ${result.snippet}. ${serviceNowRecord.text}`,
                );
                if (extracted) {
                  articleCandidates.push({
                    title: serviceNowRecord.title || result.title,
                    url: result.url,
                    answer: extracted.answer,
                    sentence: extracted.sentence,
                    score: result.score + extracted.score + 4,
                  });
                  continue;
                }
              }
              for (const articleNumber of articleNumbersFromText(
                `${result.title} ${result.snippet}`,
              )) {
                if (!hasBudget()) break;
                const record =
                  await fetchServiceNowKnowledgeRecordByNumber(articleNumber);
                if (!record) continue;
                const extracted = extractAnswer(
                  `${record.title || result.title}. ${result.snippet}. ${record.text}`,
                );
                if (extracted) {
                  articleCandidates.push({
                    title: record.title || result.title,
                    url: result.url,
                    answer: extracted.answer,
                    sentence: extracted.sentence,
                    score: result.score + extracted.score + 4,
                  });
                  continue;
                }
              }
              let fetched:
                | {
                    text: string;
                    url: string;
                    extracted: ReturnType<typeof extractAnswer>;
                  }
                | null = null;
              for (const url of articleFetchUrls(result)) {
                if (!hasBudget()) break;
                try {
                  const doc = await fetchDocument(url);
                  const text = cleanDocument(doc);
                  const extracted = extractAnswer(
                    `${result.title}. ${result.snippet}. ${text}`,
                  );
                  if (extracted) {
                    fetched = { text, url, extracted };
                    break;
                  }
                } catch {
                  // Keep trying alternate article URL shapes for the same result.
                }
              }
              const extracted =
                fetched?.extracted ??
                extractAnswer(`${result.title}. ${result.snippet}`);
              if (!extracted) continue;
              articleCandidates.push({
                title: result.title,
                url: fetched?.url ?? result.url,
                answer: extracted.answer,
                sentence: extracted.sentence,
                score: result.score + extracted.score,
              });
            }
          };
          const hasStrongAnswerCandidate = () =>
            articleCandidates.some((candidate) => candidate.score >= 20);
          const currentArticleText = cleanDocument(document);
          const currentUrl = location.href;
          const hasArticleRegion = Boolean(
            collectDeep(
              document,
              "article, [role='article'], .kb-article-content, .kb_view, .kb-article-wrapper",
            ).length,
          );
          if (
            currentArticleText &&
            (isKnowledgeArticleUrl(currentUrl) || hasArticleRegion)
          ) {
            seenUrls.add(currentUrl);
            searchResults.push({
              title: normalize(document.title) || "Current knowledge article",
              url: currentUrl,
              snippet: currentArticleText.slice(0, 800),
              text: currentArticleText,
            });
          }
          const currentResults = resultLinksFromDocument(document);
          for (const entry of currentResults) {
            if (seenUrls.has(entry.url)) continue;
            seenUrls.add(entry.url);
            searchResults.push(entry);
          }
          const queuedSearchUrls = [
            ...scopedKnowledgeSearchUrlsFromDocument(document),
            ...searchUrls(),
          ];
          for (const url of queuedSearchUrls) {
            if (!hasBudget()) break;
            try {
              const doc = await fetchDocument(url);
              for (const entry of resultLinksFromDocument(doc)) {
                if (seenUrls.has(entry.url)) continue;
                seenUrls.add(entry.url);
                searchResults.push(entry);
              }
              for (const scopedUrl of scopedKnowledgeSearchUrlsFromDocument(doc)) {
                if (!hasBudget()) break;
                try {
                  const scopedDoc = await fetchDocument(scopedUrl);
                  for (const entry of resultLinksFromDocument(scopedDoc)) {
                    if (seenUrls.has(entry.url)) continue;
                    seenUrls.add(entry.url);
                    searchResults.push(entry);
                  }
                } catch {
                  // Continue with other scoped knowledge bases.
                }
              }
            } catch {
              // Try the next same-origin portal URL.
            }
          }
          await addAnswerCandidatesFromResults(rankSearchResults(searchResults));
          if (!hasStrongAnswerCandidate() && hasBudget()) {
            for (const entry of await fetchServicePortalKnowledgeSearchRecords()) {
              if (seenUrls.has(entry.url)) continue;
              seenUrls.add(entry.url);
              searchResults.push(entry);
            }
          }
          if (!hasStrongAnswerCandidate() && hasBudget()) {
            for (const entry of await fetchServiceNowKnowledgeRecords()) {
              if (seenUrls.has(entry.url)) continue;
              seenUrls.add(entry.url);
              searchResults.push(entry);
            }
            await addAnswerCandidatesFromResults(rankSearchResults(searchResults));
          }

          const rankedResults = rankSearchResults(searchResults);
          articleCandidates.sort((a, b) => b.score - a.score);
          const lines = [
            "Knowledge base search result.",
            `Question: ${input.question}`,
            `Search query: ${queryText}`,
          ];
          const best = articleCandidates[0];
          if (best) {
            lines.push(`Answer candidate: ${best.answer}`);
            lines.push(`Evidence article: ${best.title}`);
            lines.push(`Evidence sentence: ${best.sentence}`);
            lines.push(`Article URL: ${best.url}`);
            lines.push(
              `Completion hint: call done with summary "${best.answer}" if this answers the question.`,
            );
          } else {
            lines.push("No answer candidate found in the ranked knowledge results.");
            try {
              lines.push(
                `Rendered search URL: ${new URL(
                  `/kb?id=kb_search&query=${encodeURIComponent(
                    renderedSearchQueryText,
                  )}`,
                  location.origin,
                ).href}`,
              );
            } catch {
              // Keep ranked-result URLs as the fallback when URL construction fails.
            }
          }
          if (rankedResults.length > 0) {
            const rankedResultSnippetChars = 520;
            lines.push("Ranked results:");
            for (const result of rankedResults.slice(0, 5)) {
              lines.push(
                `- ${result.title}: ${normalize(result.snippet).slice(0, rankedResultSnippetChars)} (${result.url})`,
              );
            }
          }
          return lines.join("\n");
        },
        [{ question, query, answerType, maxResults }],
        "No readable knowledge base content found.",
      );
    },
  );
}
