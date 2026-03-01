import React, { useEffect, useMemo, useState } from "react";
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
import { useStore } from "../store";
import { ToolCallBadge } from "./ToolCallBadge";
import { StepTimeline } from "./StepTimeline";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageCircle,
  ExternalLink,
  StickyNote,
  Terminal,
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
  const statusIcon =
    data.status === "completed" ? (
      <CheckCircle2 size={14} className="text-green-500" />
    ) : data.status === "partial" ? (
      <AlertTriangle size={14} className="text-yellow-500" />
    ) : (
      <XCircle size={14} className="text-red-500" />
    );

  const statusLabel =
    data.status === "completed"
      ? "Task completed"
      : data.status === "partial"
        ? "Partially completed"
        : "Task failed";

  return (
    <div className="bg-warm-100/50 dark:bg-warm-800/50 rounded-lg border border-warm-200 dark:border-warm-700 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        {statusIcon}
        <span className="font-medium">{statusLabel}</span>
        {data.totalTurnsUsed > 0 && (
          <span className="text-warm-400 text-xs ml-auto">
            {data.totalTurnsUsed} turns
          </span>
        )}
      </div>
      {data.metrics && (
        <div className="mb-2">
          <MetricsSummary metrics={data.metrics} />
        </div>
      )}
      {data.summary && (
        <p className="text-warm-600 dark:text-warm-300 text-xs mb-2">
          {data.summary}
        </p>
      )}
      {data.subtaskResults && data.subtaskResults.length > 0 && (
        <div className="space-y-1 mt-2 border-t border-warm-200 dark:border-warm-700 pt-2">
          {data.subtaskResults.map((sr, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              {sr.status === "completed" ? (
                <CheckCircle2 size={10} className="text-green-500 shrink-0" />
              ) : sr.status === "failed" ? (
                <XCircle size={10} className="text-red-500 shrink-0" />
              ) : (
                <AlertTriangle size={10} className="text-yellow-500 shrink-0" />
              )}
              <span className="truncate text-warm-600 dark:text-warm-400">
                {sr.description}
              </span>
            </div>
          ))}
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
    <div className="flex flex-wrap gap-1.5 max-w-[85%] mt-1">
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
  const hasDetails =
    !isUser &&
    ((message.steps?.length ?? 0) > 0 || message.toolCalls.length > 0);
  const [showDetails, setShowDetails] = useState(
    message.isStreaming || showDetailsByDefault,
  );
  useEffect(() => {
    if (message.isStreaming) setShowDetails(true);
  }, [message.isStreaming]);

  const renderedHtml = useMemo(() => {
    if (isUser || !message.content) return "";
    let cleaned = message.content
      .replace(
        /\*\*(?:Think|Observe|Verify)\*\*[\s\S]*?(?=\*\*Act\*\*|$)/gi,
        "",
      )
      .replace(/\*\*Act\*\*:?[ \t]*/gi, "")
      .trim();
    if (!cleaned) return "";
    const extracted = extractJsonText(cleaned);
    if (extracted) cleaned = extracted;
    return marked.parse(cleaned) as string;
  }, [message.content, isUser]);

  const stepCount = message.steps?.length ?? 0;

  // Human-readable summary for tool-only turns (no LLM text output)
  // Prefer pre-resolved step labels (with element names) over raw tool call labels
  const toolOnlyLabel = useMemo(() => {
    if (isUser || renderedHtml || message.thinking || message.completionData)
      return null;
    // Steps already have resolved labels from the background (with element names)
    const toolSteps = message.steps?.filter((s) => s.type === "tool");
    if (toolSteps && toolSteps.length > 0) {
      return toolSteps.map((s) => s.label).join(" → ");
    }
    // Fallback: raw tool calls without element resolution
    if (message.toolCalls.length === 0) return null;
    return message.toolCalls
      .map((tc: ToolCallSummary) => formatStepLabel(tc.toolName, tc.args))
      .join(" → ");
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
        "group flex flex-col gap-1 mb-5 message-enter",
        isUser ? "items-end" : "items-start",
      )}
    >
      {showBubble && (
        <div
          className={clsx(
            "max-w-[85%] px-3 py-2 rounded-xl text-sm shadow-soft",
            isUser
              ? isManualCommand
                ? "bg-indigo-500 text-white font-mono whitespace-pre-wrap"
                : isAnnotation
                  ? "bg-violet-500 text-white italic whitespace-pre-wrap"
                  : isFeedback
                    ? "bg-amber-500 text-white whitespace-pre-wrap"
                    : "bg-primary-600 text-white whitespace-pre-wrap"
              : isManualCommand
                ? "bg-warm-50 dark:bg-warm-800 text-warm-800 dark:text-warm-100 border border-indigo-200/60 dark:border-indigo-700/60"
                : "bg-warm-50 dark:bg-warm-800 text-warm-800 dark:text-warm-100 border border-warm-200/60 dark:border-warm-700/60",
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

      {hasDetails && (
        <div className="w-full max-w-[85%] mt-0.5">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="text-[11px] text-warm-400 dark:text-warm-500 hover:text-warm-600 dark:hover:text-warm-300 transition-colors"
          >
            {showDetails
              ? stepCount > 0
                ? "Hide steps"
                : "Hide tools"
              : stepCount > 0
                ? `${stepCount} ${stepCount === 1 ? "step" : "steps"}`
                : `${message.toolCalls.length} ${message.toolCalls.length === 1 ? "tool" : "tools"}`}
          </button>
        </div>
      )}

      {showDetails && !isUser && message.steps && message.steps.length > 0 && (
        <StepTimeline
          steps={message.steps}
          defaultCollapsed={!message.isStreaming}
        />
      )}

      {showDetails && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-2 w-full max-w-[85%] mt-1">
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
