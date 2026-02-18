import React, { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import {
  AgentStep,
  ChatEntry,
  SessionMetrics,
  TaskCompletionMessage,
  ToolName,
} from "../../types";
import { clsx } from "clsx";
import { useStore } from "../store";
import { ToolCallBadge } from "./ToolCallBadge";
import { StepTimeline } from "./StepTimeline";
import { ScreenshotLightbox } from "./ScreenshotLightbox";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageCircle,
} from "lucide-react";

marked.setOptions({ breaks: true, gfm: true });

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCostCompact(cost: number): string {
  if (cost === 0) return "$0";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
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

export const MessageBubble = React.memo(function MessageBubble({
  message,
}: {
  message: ChatEntry;
}) {
  const showDetailsByDefault = useStore(
    (s) => s.settings.showMessageDetailsByDefault ?? false,
  );
  const isUser = message.role === "user";
  const isHint = isUser && message.isHint;
  const hasDetails =
    !isUser &&
    ((message.steps?.length ?? 0) > 0 || message.toolCalls.length > 0);
  const [showDetails, setShowDetails] = useState(
    message.isStreaming || showDetailsByDefault,
  );
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    if (message.isStreaming) setShowDetails(true);
  }, [message.isStreaming]);

  const renderedHtml = useMemo(() => {
    if (isUser || !message.content) return "";
    const cleaned = message.content
      .replace(
        /\*\*(?:Think|Observe|Verify)\*\*[\s\S]*?(?=\*\*Act\*\*|$)/gi,
        "",
      )
      .replace(/\*\*Act\*\*:?[ \t]*/gi, "")
      .trim();
    if (!cleaned) return "";
    return marked.parse(cleaned) as string;
  }, [message.content, isUser]);

  const screenshotSteps = useMemo(() => {
    if (!message.steps) return [];
    return message.steps.filter(
      (step): step is AgentStep & { screenshotUrl: string } =>
        step.toolName === ToolName.TAKE_SCREENSHOT && !!step.screenshotUrl,
    );
  }, [message.steps]);

  return (
    <div
      className={clsx(
        "flex flex-col gap-1 mb-5 message-enter",
        isUser ? "items-end" : "items-start",
      )}
    >
      {!isUser && screenshotSteps.length > 0 && (
        <div className="flex flex-col gap-2 max-w-[85%]">
          {screenshotSteps.map((step, idx) => (
            <img
              key={step.id}
              src={step.screenshotUrl}
              alt={`Page screenshot ${idx + 1}`}
              className="max-h-[200px] rounded border border-warm-200 dark:border-warm-700 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLightboxSrc(step.screenshotUrl)}
            />
          ))}
        </div>
      )}
      {lightboxSrc && (
        <ScreenshotLightbox
          src={lightboxSrc}
          onClose={() => setLightboxSrc(null)}
        />
      )}

      <div
        className={clsx(
          "max-w-[85%] px-3 py-2 rounded-xl text-sm shadow-soft",
          isUser
            ? isHint
              ? "bg-gradient-to-br from-amber-400 to-amber-500 text-white whitespace-pre-wrap"
              : "bg-gradient-to-br from-primary-500 to-primary-600 text-white whitespace-pre-wrap"
            : "bg-warm-50 dark:bg-warm-800 text-warm-800 dark:text-warm-100 border border-warm-200/60 dark:border-warm-700/60 border-l-2 border-l-primary-400/70 dark:border-l-primary-500/70",
          !isUser && message.isStreaming && "streaming-cursor",
        )}
      >
        {isHint && (
          <div className="flex items-center gap-1 text-xs opacity-75 mb-1">
            <MessageCircle size={10} />
            <span>Hint</span>
          </div>
        )}
        {isUser ? (
          message.content
        ) : message.completionData ? (
          <CompletionSummary data={message.completionData} />
        ) : message.content ? (
          <div
            className="prose-chat"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        ) : message.toolCalls.length > 0 ? (
          <span className="text-warm-500 italic">Thinking...</span>
        ) : (
          ""
        )}
      </div>

      {hasDetails && (
        <div className="w-full max-w-[85%] mt-1">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="text-[11px] text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-200 transition-colors"
          >
            {showDetails ? "Hide details" : "Show details"}
            {message.steps && message.steps.length > 0
              ? ` · ${message.steps.length} steps`
              : ""}
            {message.toolCalls.length > 0
              ? ` · ${message.toolCalls.length} tools`
              : ""}
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

      <span
        className={clsx(
          "text-[10px] text-warm-400 px-1 opacity-70",
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
