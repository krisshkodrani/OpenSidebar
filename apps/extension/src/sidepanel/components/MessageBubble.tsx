import React, { useMemo } from "react";
import { clsx } from "clsx";
import { Eye, MessageCircle } from "lucide-react";
import type { ChatEntry, ToolCallSummary } from "../../types";
import { formatStepLabel } from "../../utils/step-labels";
import {
  cleanAssistantContent,
  normalizeCompletionMarkdown,
  renderAssistantMarkdown,
} from "../message-formatting";
import { useStore } from "../store";
import { ToolCallBadge } from "./ToolCallBadge";
import { StepTimeline } from "./StepTimeline";
import { CitationList } from "./message/CitationList";
import {
  CompletionDetails,
  CompletionFrame,
  CompletionStatusHeader,
  PartialHandoffPanel,
} from "./message/CompletionSummary";

export { normalizeCompletionMarkdown };

function buildToolOnlyLabel(message: ChatEntry): string | null {
  let labels: string[];
  const toolSteps = message.steps?.filter((step) => step.type === "tool");
  if (toolSteps && toolSteps.length > 0) {
    labels = toolSteps.map((step) => step.label);
  } else if (message.toolCalls.length > 0) {
    labels = message.toolCalls.map((toolCall: ToolCallSummary) =>
      formatStepLabel(toolCall.toolName, toolCall.args),
    );
  } else {
    return null;
  }

  const maxVisible = 3;
  if (labels.length > maxVisible) {
    const tail = labels.slice(-maxVisible);
    return `... +${labels.length - maxVisible} -> ${tail.join(" -> ")}`;
  }
  return labels.join(" -> ");
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
}: {
  message: ChatEntry;
}) {
  const showDetailsByDefault = useStore(
    (state) => state.settings.showMessageDetailsByDefault ?? false,
  );
  const isUser = message.role === "user";
  const isFeedback = isUser && message.isFeedback;
  const isGuidance = isFeedback;
  const isPassive = !isUser && message.isPassive;
  const assistantContentSource = !isUser
    ? message.content?.trim()
      ? message.content
      : message.completionData?.summary || ""
    : "";
  const cleanedAssistantText = useMemo(() => {
    if (isUser || !assistantContentSource) return "";
    return cleanAssistantContent(assistantContentSource);
  }, [assistantContentSource, isUser]);

  const renderedHtml = useMemo(() => {
    if (isUser || !cleanedAssistantText || message.isStreaming) return "";
    return renderAssistantMarkdown(cleanedAssistantText, {
      enhanceKeyValueBlocks: Boolean(message.completionData),
    });
  }, [
    cleanedAssistantText,
    message.completionData,
    message.isStreaming,
    isUser,
  ]);

  const toolOnlyLabel = useMemo(() => {
    if (isUser || renderedHtml || message.completionData) {
      return null;
    }
    return buildToolOnlyLabel(message);
  }, [isUser, renderedHtml, message]);

  const streamingContent = message.isStreaming ? message.content.trim() : "";
  const showBubble =
    isUser ||
    Boolean(message.completionData) ||
    Boolean(renderedHtml) ||
    Boolean(toolOnlyLabel) ||
    Boolean(streamingContent) ||
    (message.toolCalls.length > 0 && message.isStreaming);

  const handleCopyFinalAnswer = () => {
    if (!cleanedAssistantText) return;
    void navigator.clipboard.writeText(cleanedAssistantText);
  };

  const assistantBody = !isUser ? (
    <>
      {message.isStreaming && streamingContent ? (
        <span className="inline-block min-h-[1.5em] whitespace-pre-wrap break-words">
          {message.content}
        </span>
      ) : renderedHtml ? (
        <div
          className={clsx(
            "prose-chat",
            message.completionData &&
              "completion-summary text-fg",
          )}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : toolOnlyLabel ? (
        <span className="text-ui-control italic text-fg-tertiary">
          {toolOnlyLabel}
        </span>
      ) : null}
      {message.completionData ? (
        <CompletionStatusHeader
          canCopy={Boolean(cleanedAssistantText)}
          data={message.completionData}
          onCopy={handleCopyFinalAnswer}
        />
      ) : null}
      {message.completionData ? (
        <CompletionDetails data={message.completionData} />
      ) : null}
      {message.completionData?.partialHandoff ? (
        <PartialHandoffPanel handoff={message.completionData.partialHandoff} />
      ) : null}
    </>
  ) : null;

  return (
    <div
      className={clsx(
        "group mb-4 flex flex-col gap-1 message-enter",
        isUser ? "items-end" : "items-start",
      )}
    >
      {!isUser && message.steps && message.steps.length > 0 ? (
        <StepTimeline steps={message.steps} />
      ) : null}

      {!isUser &&
      message.steps &&
      message.steps.length > 0 &&
      showBubble &&
      !message.isStreaming ? (
        <div className="my-0.5 h-px w-[60%] bg-surface-hover" />
      ) : null}

      {showBubble ? (
        <div
          className={clsx(
            "max-w-[92%] text-ui-body",
            isUser
              ? clsx(
                  "rounded-2xl px-3 py-2 whitespace-pre-wrap break-words",
                  isGuidance
                    ? "border border-accent/30 bg-accent-subtle text-accent-text"
                    : "bg-accent text-accent-fg",
                )
              : clsx(
                  "text-fg",
                  isPassive &&
                    "rounded-lg border border-accent/30 bg-accent-subtle px-3 py-2",
                ),
            !isUser && message.isStreaming && "streaming-cursor",
          )}
        >
          {isGuidance ? (
            <div className="mb-1 flex items-center gap-1 text-ui-caption font-medium text-accent-text">
              <MessageCircle size={11} />
              <span>Guidance</span>
            </div>
          ) : null}
          {isPassive ? (
            <div className="mb-1 flex items-center gap-1 text-ui-caption font-medium text-accent-text">
              <Eye size={11} />
              <span>Watching</span>
            </div>
          ) : null}
          {isUser ? (
            message.content
          ) : message.completionData ? (
            <CompletionFrame status={message.completionData.status}>
              {assistantBody}
            </CompletionFrame>
          ) : message.isStreaming ? (
            assistantBody
          ) : renderedHtml ? (
            assistantBody
          ) : toolOnlyLabel ? (
            assistantBody
          ) : null}
        </div>
      ) : null}

      {showDetailsByDefault && message.toolCalls.length > 0 ? (
        <div className="mt-1 flex w-full max-w-[92%] flex-col gap-2">
          {message.toolCalls.map((tool, index) => (
            <ToolCallBadge key={index} tool={tool} />
          ))}
        </div>
      ) : null}

      {!isUser &&
      !message.isStreaming &&
      message.citations &&
      message.citations.length > 0 ? (
        <CitationList citations={message.citations} />
      ) : null}

      <span
        className={clsx(
          "message-ts px-1 text-ui-caption text-fg-tertiary",
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
