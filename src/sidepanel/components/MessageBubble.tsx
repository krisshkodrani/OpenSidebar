import React, { useMemo } from "react";
import { marked } from "marked";
import { ChatEntry, TaskCompletionMessage } from "../../types";
import { clsx } from "clsx";
import { ToolCallBadge } from "./ToolCallBadge";
import { StepTimeline } from "./StepTimeline";
import { CheckCircle2, XCircle, AlertTriangle, MessageCircle } from "lucide-react";

marked.setOptions({ breaks: true, gfm: true });

function CompletionSummary({ data }: { data: TaskCompletionMessage["payload"] }) {
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
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        {statusIcon}
        <span className="font-medium">{statusLabel}</span>
        {data.totalTurnsUsed > 0 && (
          <span className="text-gray-400 text-xs ml-auto">
            {data.totalTurnsUsed} turns
          </span>
        )}
      </div>
      {data.summary && (
        <p className="text-gray-600 dark:text-gray-300 text-xs mb-2">
          {data.summary}
        </p>
      )}
      {data.subtaskResults && data.subtaskResults.length > 0 && (
        <div className="space-y-1 mt-2 border-t border-gray-200 dark:border-gray-700 pt-2">
          {data.subtaskResults.map((sr, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              {sr.outcome === "completed" ? (
                <CheckCircle2 size={10} className="text-green-500 shrink-0" />
              ) : sr.outcome === "failed" ? (
                <XCircle size={10} className="text-red-500 shrink-0" />
              ) : (
                <AlertTriangle size={10} className="text-yellow-500 shrink-0" />
              )}
              <span className="truncate text-gray-600 dark:text-gray-400">
                {sr.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message }: { message: ChatEntry }) {
  const isUser = message.role === "user";
  const isHint = isUser && message.isHint;

  const renderedHtml = useMemo(() => {
    if (isUser || !message.content) return "";
    return marked.parse(message.content) as string;
  }, [message.content, isUser]);

  return (
    <div
      className={clsx(
        "flex flex-col gap-1 mb-4",
        isUser ? "items-end" : "items-start",
      )}
    >
      {!isUser && message.steps && message.steps.length > 0 && (
        <StepTimeline
          steps={message.steps}
          defaultCollapsed={!message.isStreaming}
        />
      )}
      <div
        className={clsx(
          "max-w-[85%] px-3 py-2 rounded-lg text-sm shadow-sm",
          isUser
            ? isHint
              ? "bg-amber-500 text-white rounded-br-none whitespace-pre-wrap"
              : "bg-primary-600 text-white rounded-br-none whitespace-pre-wrap"
            : "bg-surface-light dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-gray-700",
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
          <span className="text-gray-500 italic">Thinking...</span>
        ) : (
          ""
        )}
      </div>

      {/* Tool Calls */}
      {message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-2 w-full max-w-[85%] mt-1">
          {message.toolCalls.map((tool, idx) => (
            <ToolCallBadge key={idx} tool={tool} />
          ))}
        </div>
      )}

      <span
        className={clsx(
          "text-[10px] text-gray-400 px-1 opacity-70",
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
}
