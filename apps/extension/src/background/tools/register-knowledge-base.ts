/** Search visible knowledge results and same-origin article pages. */
import type { ToolRegistry } from "./registry";
import { ToolName } from "../../types";
import { SEARCH_KNOWLEDGE_BASE_DEF } from "./definitions";
import { runAsyncReadOnlyPageInspector } from "./page-inspector";

export function registerKnowledgeBaseTool(toolRegistry: ToolRegistry): void {
  toolRegistry.register(
    ToolName.SEARCH_KNOWLEDGE_BASE,
    SEARCH_KNOWLEDGE_BASE_DEF,
    async (args, tabId) => {
      const question = typeof args.question === "string" ? args.question.trim() : "";
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const answerType = args.answerType === "number" || args.answerType === "text" ? args.answerType : "auto";
      const maxResults = Math.min(Math.max(Number(args.maxResults) || 5, 1), 10);
      if (!question) return "Error: search_knowledge_base requires a question.";

      return runAsyncReadOnlyPageInspector(
        tabId,
        async (input: { question: string; query: string; maxResults: number; answerType: string }) => {
          const normalize = (value: unknown) =>
            String(value ?? "").replace(/\s+/g, " ").trim();
          const stopWords = new Set(["the", "and", "what", "where", "when", "which", "how", "does", "for", "with", "from", "about", "knowledge", "article"]);
          const terms = normalize(`${input.question} ${input.query}`)
            .toLowerCase()
            .match(/[a-z0-9]{3,}/g)
            ?.filter((word) => !stopWords.has(word)) ?? [];
          const uniqueTerms = [...new Set(terms)];
          const score = (value: string) => {
            const text = value.toLowerCase();
            return uniqueTerms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
          };
          const searchText = input.query || uniqueTerms.join(" ") || input.question;
          const origin = location.origin;
          const seen = new Set<string>();
          const candidates: Array<{ title: string; url: string; snippet: string; score: number }> = [];
          const addLinks = (doc: Document, base: string) => {
            const roots: Array<Document | ShadowRoot> = [doc];
            for (let index = 0; index < roots.length; index++) {
              for (const element of roots[index].querySelectorAll("*")) {
                if (element.shadowRoot) roots.push(element.shadowRoot);
              }
            }
            for (const anchor of roots.flatMap((root) => [...root.querySelectorAll<HTMLAnchorElement>("a[href]")])) {
              let url: URL;
              try { url = new URL(anchor.getAttribute("href") || "", base); }
              catch { continue; }
              if (url.origin !== origin || !/^https?:$/.test(url.protocol) || seen.has(url.href)) continue;
              const title = normalize(anchor.innerText || anchor.textContent || anchor.getAttribute("aria-label"));
              const snippet = normalize(anchor.closest("article, li, tr, section, [role='listitem']")?.textContent || title).slice(0, 700);
              const relevance = score(`${title} ${snippet}`);
              if (!title || relevance === 0) continue;
              seen.add(url.href);
              candidates.push({ title, url: url.href, snippet, score: relevance });
            }
          };
          addLinks(document, location.href);

          const searchUrls = new Set<string>();
          for (const form of document.querySelectorAll<HTMLFormElement>("form")) {
            if (form.method && form.method.toUpperCase() !== "GET") continue;
            const searchInput = [...form.querySelectorAll<HTMLInputElement>("input[name]")]
              .find((control) => /^(q|query|search|searchterm|keywords)$/i.test(control.name) || control.type === "search");
            if (!searchInput?.name) continue;
            try {
              const url = new URL(form.action || location.href, location.href);
              if (url.origin !== origin) continue;
              url.searchParams.set(searchInput.name, searchText);
              searchUrls.add(url.href);
            } catch { /* Ignore malformed form actions. */ }
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const fetchPage = async (url: string): Promise<Document | null> => {
            try {
              const response = await fetch(url, { credentials: "include", signal: controller.signal });
              if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return null;
              return new DOMParser().parseFromString(await response.text(), "text/html");
            } catch { return null; }
          };
          try {
            for (const url of [...searchUrls].slice(0, 2)) {
              const doc = await fetchPage(url);
              if (doc) addLinks(doc, url);
            }
            candidates.sort((a, b) => b.score - a.score);
            const articles: Array<{ title: string; url: string; body: string; score: number }> = [];
            const current = normalize(document.querySelector("main, article, [role='main']")?.textContent || document.body?.innerText);
            if (current) articles.push({ title: document.title, url: location.href, body: current, score: score(current) });
            for (const candidate of candidates.slice(0, Math.max(input.maxResults, 5))) {
              if (candidate.snippet.length > candidate.title.length + 20) {
                articles.push({ title: candidate.title, url: candidate.url, body: candidate.snippet, score: candidate.score });
              }
              const doc = await fetchPage(candidate.url);
              if (!doc) continue;
              doc.querySelectorAll("script, style, nav, header, footer").forEach((node) => node.remove());
              const body = normalize(doc.querySelector("main, article, [role='main']")?.textContent || doc.body?.textContent);
              if (body) articles.push({ title: candidate.title, url: candidate.url, body, score: candidate.score });
            }
            const sentences = articles.flatMap((article) =>
              article.body.split(/(?<=[.!?])\s+|\n+/).map((sentence) => ({ ...article, sentence: normalize(sentence) }))
            ).filter((entry) => entry.sentence.length > 20 && entry.sentence.length < 800)
              .map((entry) => ({ ...entry, score: entry.score + score(entry.sentence) * 3 }))
              .sort((a, b) => b.score - a.score);
            const lines = ["Knowledge base search result.", `Question: ${input.question}`, `Search query: ${searchText}`];
            const best = sentences.find((entry) =>
              entry.score >= 3 &&
              score(entry.sentence) >= 2 &&
              (input.answerType !== "number" || /\b\d[\d,]*(?:\.\d+)?\b/.test(entry.sentence))
            );
            if (best) {
              const answer = input.answerType === "number"
                ? best.sentence.match(/\b\d[\d,]*(?:\.\d+)?\b/)?.[0] || best.sentence
                : best.sentence;
              lines.push(`Answer candidate: ${answer}`, `Evidence article: ${best.title}`, `Evidence sentence: ${best.sentence}`, `Article URL: ${best.url}`);
              lines.push(`Completion hint: call done with summary "${answer}" if this answers the question.`);
            } else {
              lines.push("No answer candidate found in the visible or linked knowledge results.");
            }
            for (const result of candidates.slice(0, input.maxResults)) {
              lines.push(`Result: ${result.title} | ${result.url} | ${result.snippet}`);
            }
            return lines.join("\n");
          } finally {
            clearTimeout(timeout);
          }
        },
        [{ question, query, maxResults, answerType }],
        "No knowledge results found in the current page.",
      );
    },
  );
}
