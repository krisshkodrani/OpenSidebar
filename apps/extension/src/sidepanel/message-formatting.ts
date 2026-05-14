import { marked } from "marked";
import type { Tokens } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { SessionMetrics } from "../types";
import { sanitizeHtml } from "../utils/sanitize-html";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const LANGUAGE_ALIASES: Record<string, string> = {
  html: "xml",
  js: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
};

const JSON_TEXT_KEYS = [
  "summary",
  "text",
  "content",
  "answer",
  "response",
  "result",
  "message",
  "description",
];

interface KeyValueLine {
  label: string;
  value: string;
  source: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeHighlightLanguage(lang?: string): string | null {
  const candidate = lang?.trim().toLowerCase().split(/\s+/)[0];
  if (!candidate) return null;
  const normalized = LANGUAGE_ALIASES[candidate] ?? candidate;
  return hljs.getLanguage(normalized) ? normalized : null;
}

const markdownRenderer = new marked.Renderer();
markdownRenderer.code = ({ text, lang }: Tokens.Code): string => {
  const language = normalizeHighlightLanguage(lang);
  const highlighted = language
    ? hljs.highlight(text, { language, ignoreIllegals: true }).value
    : escapeHtml(text);
  const className = language ? ` class="hljs language-${language}"` : "";
  return `<pre><code${className}>${highlighted}</code></pre>`;
};

marked.setOptions({ breaks: true, gfm: true, renderer: markdownRenderer });

function extractJsonText(raw: string): string | null {
  let text = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  text = text.trim();
  if (!text.startsWith("{")) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return null;
  }

  const record = obj as Record<string, unknown>;
  for (const key of JSON_TEXT_KEYS) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key] as string;
    }
  }

  const strings: string[] = [];
  const collect = (val: unknown, depth: number) => {
    if (depth > 3) return;
    if (typeof val === "string" && val) {
      strings.push(val);
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      for (const child of Object.values(val)) collect(child, depth + 1);
    }
  };
  collect(record, 0);
  return strings.length > 0 ? strings.join("\n\n") : null;
}

export function cleanAssistantContent(content: string): string {
  const cleaned = content
    .replace(/\*\*(?:Think|Observe|Verify)\*\*[\s\S]*?(?=\*\*Act\*\*|$)/gi, "")
    .replace(/\*\*Act\*\*:?[ \t]*/gi, "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!cleaned) return "";
  return extractJsonText(cleaned) ?? cleaned;
}

function matchKeyValueLine(line: string): KeyValueLine | null {
  const source = line.replace(/[ \t]+$/, "");
  const match =
    /^\s*(?:[-*]\s+)?\*\*([^*\n:][^*\n:]{0,80}):\*\*\s*(.+?)\s*$/.exec(
      source,
    );
  if (!match) return null;
  return {
    label: match[1].trim(),
    value: match[2].trim(),
    source,
  };
}

export function normalizeCompletionMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/([^\n])\s+(#{1,6}\s+)/g, "$1\n\n$2")
    .replace(/\s+-\s+(?=\*\*[^*\n:][^*\n:]{0,80}:\*\*)/g, "\n- ")
    .replace(/([^\n*-])\s+(?=\*\*[^*\n:][^*\n:]{0,80}:\*\*)/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatKeyValueRun(run: KeyValueLine[]): string[] {
  if (run.length < 2) return run.map((item) => item.source);
  const rows = run.map((item) => {
    const valueHtml = marked.parseInline(item.value) as string;
    return `<div><dt>${escapeHtml(item.label)}</dt><dd>${valueHtml}</dd></div>`;
  });
  return [`<dl class="completion-kv">${rows.join("")}</dl>`];
}

function enhanceCompletionMarkdown(markdown: string): string {
  const lines = normalizeCompletionMarkdown(markdown).split("\n");
  const output: string[] = [];
  let keyValueRun: KeyValueLine[] = [];

  const flushKeyValueRun = () => {
    if (keyValueRun.length === 0) return;
    output.push(...formatKeyValueRun(keyValueRun));
    keyValueRun = [];
  };

  for (const line of lines) {
    const keyValueLine = matchKeyValueLine(line);
    if (keyValueLine) {
      keyValueRun.push(keyValueLine);
      continue;
    }
    flushKeyValueRun();
    output.push(line);
  }
  flushKeyValueRun();

  return output.join("\n");
}

export function renderAssistantMarkdown(
  content: string,
  options: { enhanceKeyValueBlocks?: boolean } = {},
): string {
  const markdown = options.enhanceKeyValueBlocks
    ? enhanceCompletionMarkdown(content)
    : content;
  return sanitizeHtml(marked.parse(markdown) as string);
}

export function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCostCompact(cost: number): string {
  if (cost === 0) return "$0";
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

export function formatTimeCompact(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

export function resolveCostMode(
  metrics: SessionMetrics,
): "none" | "actual" | "estimated" | "mixed" {
  if (metrics.costMode) return metrics.costMode;
  const actual = metrics.totalCostActual ?? 0;
  const estimated = metrics.totalCostEstimated ?? 0;
  if (actual <= 0 && estimated <= 0) return "none";
  if (actual > 0 && estimated > 0) return "mixed";
  if (actual > 0) return "actual";
  return "estimated";
}
