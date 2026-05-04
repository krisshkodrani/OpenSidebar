import React, { useMemo, useState } from "react";
import { marked, type Tokens } from "marked";
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
import {
  ChatEntry,
  Citation,
  SessionMetrics,
  TaskCompletionMessage,
  ToolCallSummary,
} from "../../types";
import { formatStepLabel } from "../../background/agent/step-labels";
import { clsx } from "clsx";
import { sanitizeHtml } from "../../utils/sanitize-html";
import { useStore } from "../store";
import { ToolCallBadge } from "./ToolCallBadge";
import { StepTimeline } from "./StepTimeline";
import { Volume2, VolumeX } from "lucide-react";
import { useTextToSpeech } from "../hooks/useTextToSpeech";
import { PlanStepIcon } from "./PlanStepIcon";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageCircle,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

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

function escapeHtml(value: string): string {
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
  if (typeof obj !== "object" || obj === null || Array.isArray(obj))
    return null;
  const record = obj as Record<string, unknown>;
  for (const key of JSON_TEXT_KEYS) {
    if (typeof record[key] === "string" && record[key])
      return record[key] as string;
  }
  // Fallback: collect all string values (depth-limited)
  const strings: string[] = [];
  const collect = (val: unknown, depth: number) => {
    if (depth > 3) return;
    if (typeof val === "string" && val) strings.push(val);
    else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      for (const v of Object.values(val)) collect(v, depth + 1);
    }
  };
  collect(record, 0);
  return strings.length > 0 ? strings.join("\n\n") : null;
}

function cleanAssistantContent(content: string): string {
  const cleaned = content
    .replace(
      /\*\*(?:Think|Observe|Verify)\*\*[\s\S]*?(?=\*\*Act\*\*|$)/gi,
      "",
    )
    .replace(/\*\*Act\*\*:?[ \t]*/gi, "")
    .replace(/\\n/g, "\n")
    .trim();
  if (!cleaned) return "";
  return extractJsonText(cleaned) ?? cleaned;
}

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCostCompact(cost: number): string {
  if (cost === 0) return "$0";
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(4)}`;
}

function formatTimeCompact(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function resolveCostMode(
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

function MetricsSummary({ metrics }: { metrics: SessionMetrics }) {
  const models = Object.entries(metrics.modelBreakdown);
  const showBreakdown = models.length > 1;
  const costMode = resolveCostMode(metrics);
  const perceptionDecision = metrics.perceptionModeDecision;

  return (
    <div className="text-xs text-warm-500 dark:text-warm-400 tabular-nums space-y-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>{formatTokensCompact(metrics.totalTokens)} tokens</span>
        <span className="text-warm-300 dark:text-warm-600">Â·</span>
        <span>
          {metrics.totalCost > 0 ? formatCostCompact(metrics.totalCost) : "--"}
          {metrics.totalCost > 0 && costMode === "estimated" ? " (est.)" : ""}
          {metrics.totalCost > 0 && costMode === "mixed" ? " (mixed)" : ""}
        </span>
        <span className="text-warm-300 dark:text-warm-600">Â·</span>
        <span>LLM {formatTimeCompact(metrics.totalLlmTimeMs)}</span>
        {(metrics.visionCallCount ?? 0) +
          (metrics.cachedVisionCallCount ?? 0) >
          0 && (
          <>
            <span className="text-warm-300 dark:text-warm-600">Â·</span>
            <span>
              Vision {metrics.visionCallCount ?? 0}
              {(metrics.cachedVisionCallCount ?? 0) > 0
                ? ` +${metrics.cachedVisionCallCount} cached`
                : ""}
            </span>
          </>
        )}
        <span className="text-warm-300 dark:text-warm-600">Â·</span>
        <span>
          Total {formatTimeCompact(metrics.totalSessionTimeMs)}
          {(metrics.imagePromptCount ?? 0) > 0
            ? `, Images ${metrics.imagePromptCount}${
                (metrics.totalImagePromptTokenEstimate ?? 0) > 0
                  ? ` (~${formatTokensCompact(metrics.totalImagePromptTokenEstimate ?? 0)} tok)`
                  : ""
              }`
            : ""}
        </span>
      </div>
      {perceptionDecision && (
        <div>
          Perception {perceptionDecision.mode} Â· {perceptionDecision.reason}
        </div>
      )}
      {showBreakdown && (
        <div className="pl-2 space-y-0.5">
          {models.map(([model, data]) => (
            <div key={model} className="flex items-center gap-1.5">
              <span className="text-warm-400 dark:text-warm-500">
                {model.split("/").pop()}:
              </span>
              <span>
                {formatTokensCompact(data.promptTokens + data.completionTokens)}{" "}
                tok
              </span>
              {data.cost > 0 && (
                <>
                  <span className="text-warm-300 dark:text-warm-600">Â·</span>
                  <span>{formatCostCompact(data.cost)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompletionSummary({
  data,
}: {
  data: TaskCompletionMessage["payload"];
}) {
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cleanedSummary = useMemo(
    () => (data.summary ? cleanAssistantContent(data.summary) : ""),
    [data.summary],
  );

  const statusIcon =
    data.status === "completed" ? (
      <CheckCircle2 size={13} className="text-green-500 shrink-0" />
    ) : data.status === "partial" ? (
      <AlertTriangle size={13} className="text-yellow-500 shrink-0" />
    ) : (
      <XCircle size={13} className="text-red-500 shrink-0" />
    );

  const accentClass =
    data.status === "completed"
      ? "border-green-400"
      : data.status === "partial"
        ? "border-yellow-400"
        : "border-red-400";
  const detailParts = [
    data.subtaskResults?.length
      ? `${data.subtaskResults.length} ${data.subtaskResults.length === 1 ? "step" : "steps"}`
      : null,
    data.metrics ? `${formatTokensCompact(data.metrics.totalTokens)} tokens` : null,
  ].filter(Boolean);
  const hasDetails = Boolean(
    (data.subtaskResults && data.subtaskResults.length > 0) || data.metrics,
  );

  const summaryHtml = useMemo(
    () =>
      cleanedSummary
        ? sanitizeHtml(marked.parse(cleanedSummary) as string)
        : "",
    [cleanedSummary],
  );

  const handleCopy = () => {
    if (!cleanedSummary) return;
    navigator.clipboard.writeText(cleanedSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={clsx("border-l-2 pl-3 text-sm", accentClass)}>
      {/* Status line */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {statusIcon}
        <span className="text-xs font-medium text-warm-500 dark:text-warm-400">
          {data.status === "completed"
            ? "Done"
            : data.status === "partial"
              ? "Partially done"
              : "Failed"}
        </span>
      </div>

      {/* Summary â€” markdown rendered, conversational */}
      {cleanedSummary && (
        <div className="relative group/summary">
          <div
            className="prose-chat text-warm-700 dark:text-warm-200"
            dangerouslySetInnerHTML={{ __html: summaryHtml }}
          />
          <button
            onClick={handleCopy}
            className="absolute top-0 right-0 p-1 rounded text-warm-400 hover:text-warm-600 dark:hover:text-warm-200 opacity-0 group-hover/summary:opacity-100 transition-opacity"
            title="Copy summary"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      )}

      {hasDetails && (
        <div className="mt-2 pt-1">
          <button
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-warm-400 dark:text-warm-500 hover:text-warm-600 dark:hover:text-warm-300 transition-colors"
          >
            {detailsOpen ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            <span>
              Details
              {detailParts.length > 0 ? ` (${detailParts.join(", ")})` : ""}
            </span>
          </button>
          {detailsOpen && (
            <div className="mt-2 space-y-2">
              {data.subtaskResults && data.subtaskResults.length > 0 && (
                <div className="ml-1 border-l border-warm-200/60 dark:border-warm-700/40 pl-2 space-y-0.5">
                  {data.subtaskResults.map((sr, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <PlanStepIcon
                        status={
                          sr.status === "completed"
                            ? "completed"
                            : sr.status === "failed"
                              ? "failed"
                              : sr.status === "skipped"
                                ? "skipped"
                                : "pending"
                        }
                        size={10}
                      />
                      <span className="text-warm-500 dark:text-warm-400 truncate">
                        {sr.description}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {data.metrics && <MetricsSummary metrics={data.metrics} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  // Truncate display name from URL
  const displayName = (c: Citation) => {
    if (c.title && c.title !== c.url) {
      return c.title.length > 50 ? c.title.slice(0, 47) + "..." : c.title;
    }
    try {
      const u = new URL(c.url);
      const path = u.pathname === "/" ? "" : u.pathname;
      const short = u.hostname + path;
      return short.length > 50 ? short.slice(0, 47) + "..." : short;
    } catch {
      return c.url.slice(0, 50);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 max-w-[92%] mt-1">
      {citations.map((c, i) => (
        <a
          key={i}
          href={c.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-warm-100 dark:bg-warm-800 border border-warm-200 dark:border-warm-700 text-warm-600 dark:text-warm-300 hover:bg-primary-50 hover:border-primary-300 dark:hover:bg-primary-900/30 dark:hover:border-primary-600 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          title={c.url}
        >
          <ExternalLink size={9} className="shrink-0" />
          <span className="truncate">{displayName(c)}</span>
        </a>
      ))}
    </div>
  );
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
}: {
  message: ChatEntry;
}) {
  const showDetailsByDefault = useStore(
    (s) => s.settings.showMessageDetailsByDefault ?? false,
  );
  const voiceOutputEnabled = useStore((s) => s.settings.enableVoiceOutput ?? false);
  const groqApiKey = useStore((s) => s.settings.groqApiKey);
  const openaiApiKey = useStore((s) => s.settings.openaiApiKey);
  const geminiApiKey = useStore((s) => s.settings.geminiApiKey);
  const ttsProvider = useStore((s) => s.settings.ttsProvider);
  const ttsVoice = useStore((s) => s.settings.ttsVoice);
  const ttsStylePreset = useStore((s) => s.settings.ttsStylePreset);
  const tts = useTextToSpeech(
    { groqApiKey, openaiApiKey, geminiApiKey },
    ttsProvider,
    ttsVoice,
    ttsStylePreset,
  );
  const isUser = message.role === "user";
  const isFeedback = isUser && message.isFeedback;
  const isGuidance = isFeedback;

  const renderedHtml = useMemo(() => {
    if (isUser || !message.content) return "";
    if (message.isStreaming) return "";
    const cleaned = cleanAssistantContent(message.content);
    if (!cleaned) return "";
    return sanitizeHtml(marked.parse(cleaned) as string);
  }, [message.content, message.isStreaming, isUser]);

  // Human-readable summary for tool-only turns (no LLM text output)
  // Prefer pre-resolved step labels (with element names) over raw tool call labels
  const toolOnlyLabel = useMemo(() => {
    if (isUser || renderedHtml || message.thinking || message.completionData)
      return null;
    // Steps already have resolved labels from the background (with element names)
    let labels: string[];
    const toolSteps = message.steps?.filter((s) => s.type === "tool");
    if (toolSteps && toolSteps.length > 0) {
      labels = toolSteps.map((s) => s.label);
    } else if (message.toolCalls.length > 0) {
      // Fallback: raw tool calls without element resolution
      labels = message.toolCalls.map((tc: ToolCallSummary) =>
        formatStepLabel(tc.toolName, tc.args),
      );
    } else {
      return null;
    }
    // Truncate long chains so they stay readable
    const MAX_VISIBLE = 3;
    if (labels.length > MAX_VISIBLE) {
      const tail = labels.slice(-MAX_VISIBLE);
      return `... +${labels.length - MAX_VISIBLE} â†’ ${tail.join(" â†’ ")}`;
    }
    return labels.join(" â†’ ");
  }, [
    isUser,
    renderedHtml,
    message.thinking,
    message.completionData,
    message.steps,
    message.toolCalls,
  ]);

  const showBubble =
    isUser ||
    message.completionData ||
    message.isStreaming ||
    renderedHtml ||
    message.thinking ||
    toolOnlyLabel ||
    (message.toolCalls.length > 0 && message.isStreaming);

  return (
    <div
      className={clsx(
        "group flex flex-col gap-1 mb-4 message-enter",
        isUser ? "items-end" : "items-start",
      )}
    >
      {/* Steps render above the content bubble so the final summary is at the bottom (closest to input) */}
      {!isUser && message.steps && message.steps.length > 0 && (
        <StepTimeline steps={message.steps} />
      )}

      {/* Separator between steps and summary content */}
      {!isUser &&
        message.steps &&
        message.steps.length > 0 &&
        showBubble &&
        !message.isStreaming && (
          <div className="w-[60%] h-px bg-warm-200/50 dark:bg-warm-700/30 my-0.5" />
        )}

      {showBubble && (
        <div
          className={clsx(
            "max-w-[92%] text-sm",
            isUser
              ? clsx(
                  "px-3 py-2 rounded-2xl whitespace-pre-wrap",
                  isGuidance
                    ? "border border-primary-200 bg-primary-50/90 text-primary-900 dark:border-primary-800 dark:bg-primary-950/20 dark:text-primary-100"
                    : "bg-warm-200 text-warm-800 dark:bg-warm-700 dark:text-warm-100",
                )
              : "text-warm-800 dark:text-warm-100",
            !isUser && message.isStreaming && "streaming-cursor",
          )}
        >
          {isGuidance && (
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-primary-600 dark:text-primary-300">
              <MessageCircle size={11} />
              <span>Guidance</span>
            </div>
          )}
          {!isUser && message.thinking && (
            <div className="text-warm-400 dark:text-warm-500 italic text-xs leading-relaxed whitespace-pre-wrap">
              {message.thinking}
            </div>
          )}
          {isUser ? (
            message.content
          ) : message.completionData ? (
            <CompletionSummary data={message.completionData} />
          ) : message.isStreaming ? (
            <span className="inline-block min-h-[1.5em] whitespace-pre-wrap">
              {message.content || "Thinking..."}
            </span>
          ) : renderedHtml ? (
            <div
              className="prose-chat"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : toolOnlyLabel ? (
            <span className="text-warm-400 dark:text-warm-500 italic text-xs">
              {toolOnlyLabel}
            </span>
          ) : message.thinking ? null : (
            ""
          )}
        </div>
      )}

      {/* TTS speaker icon â€” assistant messages with content */}
      {voiceOutputEnabled && (groqApiKey || openaiApiKey || geminiApiKey) && !isUser && renderedHtml && !message.isStreaming && (
        <div className="flex items-center gap-1.5 mt-1">
          <button
            onClick={() => tts.isSpeaking ? tts.stop() : tts.speak(message.content || "")}
            className="p-1 rounded-md text-warm-400 hover:text-warm-600 dark:hover:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-800 transition-colors"
            aria-label={tts.isSpeaking ? "Stop speaking" : "Read aloud"}
            title={tts.isSpeaking ? "Stop" : "Read aloud"}
          >
            {tts.isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          {tts.error && (
            <span className="text-[10px] text-red-500 dark:text-red-400">{tts.error}</span>
          )}
        </div>
      )}

      {showDetailsByDefault && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-2 w-full max-w-[92%] mt-1">
          {message.toolCalls.map((tool, idx) => (
            <ToolCallBadge key={idx} tool={tool} />
          ))}
        </div>
      )}

      {!isUser &&
        !message.isStreaming &&
        message.citations &&
        message.citations.length > 0 && (
          <CitationList citations={message.citations} />
        )}

      {/* Timestamp: hidden by default, visible on hover */}
      <span
        className={clsx(
          "message-ts text-[10px] text-warm-400 px-1",
          isUser ? "text-right" : "text-left",
        )}
      >
        {new Date(message.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
});
