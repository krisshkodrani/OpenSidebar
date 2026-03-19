import React, { useMemo, useState } from "react";
import { marked } from "marked";
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
import { PlanStepIcon } from "./PlanStepIcon";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageCircle,
  ExternalLink,
  StickyNote,
  Terminal,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

marked.setOptions({ breaks: true, gfm: true });

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

  return (
    <div className="text-xs text-warm-500 dark:text-warm-400 tabular-nums space-y-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>{formatTokensCompact(metrics.totalTokens)} tokens</span>
        <span className="text-warm-300 dark:text-warm-600">·</span>
        <span>
          {metrics.totalCost > 0 ? formatCostCompact(metrics.totalCost) : "--"}
          {metrics.totalCost > 0 && costMode === "estimated" ? " (est.)" : ""}
          {metrics.totalCost > 0 && costMode === "mixed" ? " (mixed)" : ""}
        </span>
        <span className="text-warm-300 dark:text-warm-600">·</span>
        <span>LLM {formatTimeCompact(metrics.totalLlmTimeMs)}</span>
        <span className="text-warm-300 dark:text-warm-600">·</span>
        <span>Total {formatTimeCompact(metrics.totalSessionTimeMs)}</span>
      </div>
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
                  <span className="text-warm-300 dark:text-warm-600">·</span>
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
  const [metricsOpen, setMetricsOpen] = useState(false);

  const statusIcon =
    data.status === "completed" ? (
      <CheckCircle2 size={13} className="text-green-500 shrink-0" />
    ) : data.status === "partial" ? (
      <AlertTriangle size={13} className="text-yellow-500 shrink-0" />
    ) : (
      <XCircle size={13} className="text-red-500 shrink-0" />
    );

  const summaryHtml = useMemo(
    () => (data.summary ? sanitizeHtml(marked.parse(data.summary) as string) : ""),
    [data.summary],
  );

  const handleCopy = () => {
    if (!data.summary) return;
    navigator.clipboard.writeText(data.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="text-sm">
      {/* Status line */}
      <div className="flex items-center gap-1.5 mb-1.5">
        {statusIcon}
        <span className="text-xs font-medium text-warm-500 dark:text-warm-400">
          {data.status === "completed" ? "Done" : data.status === "partial" ? "Partially done" : "Failed"}
        </span>
      </div>

      {/* Summary — markdown rendered, conversational */}
      {data.summary && (
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

      {/* Subtask results — compact list */}
      {data.subtaskResults && data.subtaskResults.length > 1 && (
        <div className="mt-2 ml-1 border-l border-warm-200/60 dark:border-warm-700/40 pl-2 space-y-0.5">
          {data.subtaskResults.map((sr, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <PlanStepIcon status={sr.status === "completed" ? "completed" : sr.status === "failed" ? "failed" : sr.status === "skipped" ? "skipped" : "pending"} size={10} />
              <span className="text-warm-500 dark:text-warm-400 truncate">
                {sr.description}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Session metrics — collapsible */}
      {data.metrics && (
        <div className="mt-2 pt-1">
          <button
            onClick={() => setMetricsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-warm-400 dark:text-warm-500 hover:text-warm-600 dark:hover:text-warm-300 transition-colors"
          >
            {metricsOpen ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            <span>Session metrics</span>
          </button>
          {metricsOpen && (
            <div className="mt-1">
              <MetricsSummary metrics={data.metrics} />
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
  const isUser = message.role === "user";
  const isFeedback = isUser && message.isFeedback;
  const isAnnotation = isUser && message.isAnnotation;
  const isManualCommand = !!message.isManualCommand;

  const renderedHtml = useMemo(() => {
    if (isUser || !message.content) return "";
    let cleaned = message.content
      // Strip ReAct-style reasoning blocks
      .replace(
        /\*\*(?:Think|Observe|Verify)\*\*[\s\S]*?(?=\*\*Act\*\*|$)/gi,
        "",
      )
      .replace(/\*\*Act\*\*:?[ \t]*/gi, "")
      // Normalize literal \n escape sequences to real newlines
      .replace(/\\n/g, "\n")
      .trim();
    if (!cleaned) return "";
    const extracted = extractJsonText(cleaned);
    if (extracted) cleaned = extracted;
    return sanitizeHtml(marked.parse(cleaned) as string);
  }, [message.content, isUser]);

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
      return `... +${labels.length - MAX_VISIBLE} → ${tail.join(" → ")}`;
    }
    return labels.join(" → ");
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
      {!isUser && message.steps && message.steps.length > 0 && showBubble && !message.isStreaming && (
        <div className="w-[60%] h-px bg-warm-200/50 dark:bg-warm-700/30 my-0.5" />
      )}

      {showBubble && (
        <div
          className={clsx(
            "max-w-[92%] text-sm",
            isUser
              ? clsx(
                  "px-3 py-2 rounded-2xl whitespace-pre-wrap",
                  isManualCommand
                    ? "bg-warm-600 dark:bg-warm-500 text-white font-mono"
                    : isAnnotation
                      ? "bg-primary-600 dark:bg-primary-700 text-white italic"
                      : isFeedback
                        ? "bg-amber-500/80 text-white"
                        : "bg-warm-200 text-warm-800 dark:bg-warm-700 dark:text-warm-100",
                )
              : clsx(
                  "text-warm-800 dark:text-warm-100",
                  isManualCommand && "px-3 py-2 rounded-2xl border border-warm-300/40 dark:border-warm-600/40",
                ),
            !isUser && message.isStreaming && "streaming-cursor",
          )}
        >
          {isUser && isManualCommand && (
            <div className="flex items-center gap-1 text-xs opacity-75 mb-1">
              <Terminal size={10} />
              <span>manual</span>
            </div>
          )}
          {isAnnotation && !isManualCommand && (
            <div className="flex items-center gap-1 text-xs opacity-75 mb-1">
              <StickyNote size={10} />
              <span>annotation</span>
            </div>
          )}
          {isFeedback && !isAnnotation && !isManualCommand && (
            <div className="flex items-center gap-1 text-xs opacity-75 mb-1">
              <MessageCircle size={10} />
              <span>feedback</span>
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
          ) : renderedHtml ? (
            <div
              className="prose-chat"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : toolOnlyLabel ? (
            <span className="text-warm-400 dark:text-warm-500 italic text-xs">
              {toolOnlyLabel}
            </span>
          ) : message.isStreaming ? (
            <span className="text-warm-500 italic">Thinking...</span>
          ) : message.thinking ? null : (
            ""
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
