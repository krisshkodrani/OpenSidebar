import React, { useMemo, useState } from "react";
import type { TraceEntry, TraceSession } from "../../../types/traces";
import {
  extractPromptMessages,
  type PromptMessageRole,
  type PromptMessageView,
} from "../../analysis/prompt-messages";
import { formatTime, truncate } from "../../utils";
import Badge from "../Badge";
import CollapsibleSection from "../CollapsibleSection";

interface PromptsTabProps {
  session: TraceSession;
  entries: TraceEntry[];
}

type MessageFilter = "input" | "all" | PromptMessageRole;

const ROLE_FILTERS: MessageFilter[] = [
  "input",
  "all",
  "system",
  "user",
  "assistant",
  "tool",
];

type PromptContentPart = {
  type: "text" | "think";
  content: string;
};

interface SystemPromptGroup {
  id: string;
  message: PromptMessageView;
  turnNumbers: number[];
}

function formatTurnRange(turnNumbers: number[]): string {
  const sorted = Array.from(new Set(turnNumbers)).sort((a, b) => a - b);
  if (sorted.length === 0) return "T?";
  if (sorted.length === 1) return `T${sorted[0]}`;

  const contiguous = sorted.every(
    (turn, index) => index === 0 || turn === sorted[index - 1] + 1,
  );
  if (contiguous) return `T${sorted[0]}-T${sorted[sorted.length - 1]}`;
  return sorted.map((turn) => `T${turn}`).join(", ");
}

function groupSystemMessages(
  messages: PromptMessageView[],
): SystemPromptGroup[] {
  const groups = new Map<string, SystemPromptGroup>();

  messages
    .filter((message) => message.role === "system")
    .forEach((message) => {
      const key = [
        message.content ?? "",
        message.model ?? "",
        message.source ?? "",
      ].join("\0");
      const existing = groups.get(key);
      if (existing) {
        existing.turnNumbers.push(message.turnNumber);
      } else {
        groups.set(key, {
          id: message.id,
          message,
          turnNumbers: [message.turnNumber],
        });
      }
    });

  return Array.from(groups.values());
}

function parsePromptContent(text: string): PromptContentPart[] {
  const parts: PromptContentPart[] = [];
  const re = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }

    const previous = parts[parts.length - 1];
    if (previous?.type === "think") {
      previous.content += match[1];
    } else {
      parts.push({ type: "think", content: match[1] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", content: text }];
}

function hasThinkBlocks(text: string): boolean {
  return /<think>[\s\S]*?<\/think>/.test(text);
}

function readablePromptContent(text: string): string {
  return parsePromptContent(text)
    .map((part) =>
      part.type === "think" ? `Thinking: ${part.content}` : part.content,
    )
    .join("");
}

function PromptContent({ text }: { text: string }) {
  if (!hasThinkBlocks(text)) return <>{text}</>;

  return (
    <>
      {parsePromptContent(text).map((part, index) =>
        part.type === "think" ? (
          <div
            key={index}
            className="border-l-2 border-brand-live/60 bg-brand-live/10 pl-2.5 py-1.5 my-1 rounded-r"
          >
            <span className="text-[10px] font-semibold text-brand-live uppercase tracking-wider">
              Thinking
            </span>
            <div className="mt-0.5 text-brand-live/80 italic">
              {part.content}
            </div>
          </div>
        ) : (
          <span key={index}>{part.content}</span>
        ),
      )}
    </>
  );
}

export default function PromptsTab({ session, entries }: PromptsTabProps) {
  const extraction = useMemo(
    () => extractPromptMessages(session, entries),
    [session, entries],
  );

  if (extraction.messages.length === 0) {
    return (
      <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide mb-2">
          Prompt Data
        </div>
        <div className="text-sm text-trace-muted">
          {extraction.unavailableReason === "no_entries"
            ? "No trace entries are loaded for this trace."
            : "Prompt data was not recorded for this trace."}
        </div>
        <div className="text-[12px] text-trace-dim mt-2">
          This trace can still be inspected through turns, logs, tools, and
          snapshots.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PromptAvailabilitySummary extraction={extraction} />
      <InitialRequest messages={extraction.messages} />
      <SystemPromptEvolution messages={extraction.messages} />
      <MessageFlow messages={extraction.messages} />
    </div>
  );
}

function PromptAvailabilitySummary({
  extraction,
}: {
  extraction: ReturnType<typeof extractPromptMessages>;
}) {
  if (extraction.unavailableTurnNumbers.length === 0) return null;

  return (
    <div className="bg-state-warning/10 border border-state-warning/25 rounded-lg p-3 text-[12px] text-state-warning">
      {extraction.turnsWithMessages} of {extraction.totalTurns} turns include
      prompt messages. Missing turns:{" "}
      {extraction.unavailableTurnNumbers.map((turn) => `T${turn}`).join(", ")}.
    </div>
  );
}

function InitialRequest({ messages }: { messages: PromptMessageView[] }) {
  const firstTurnNumber = Math.min(
    ...messages.map((message) => message.turnNumber),
  );
  const initialMessages = messages.filter(
    (message) =>
      message.turnNumber === firstTurnNumber &&
      (message.role === "system" || message.role === "user"),
  );

  if (initialMessages.length === 0) return null;

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide">
          Initial Request
        </div>
        <Badge variant="type">{initialMessages.length}</Badge>
      </div>

      <div className="space-y-2">
        {initialMessages.map((message) => (
          <PromptMessageRow key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}

function SystemPromptEvolution({
  messages,
}: {
  messages: PromptMessageView[];
}) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const systemGroups = groupSystemMessages(messages);

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide">
          System Prompt Evolution
        </div>
        <Badge variant="role-system">
          {systemGroups.length === systemMessages.length
            ? systemMessages.length
            : `${systemGroups.length}/${systemMessages.length}`}
        </Badge>
      </div>

      {systemMessages.length === 0 ? (
        <div className="text-sm text-trace-muted">
          No system messages were recorded in this trace.
        </div>
      ) : (
        <div className="space-y-2">
          {systemGroups.map((group) => (
            <PromptMessageRow
              key={group.id}
              message={group.message}
              compact
              turnLabel={formatTurnRange(group.turnNumbers)}
              headerBadges={
                group.turnNumbers.length > 1 ? (
                  <Badge variant="type">{group.turnNumbers.length} turns</Badge>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageFlow({ messages }: { messages: PromptMessageView[] }) {
  const [filter, setFilter] = useState<MessageFilter>("input");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredMessages = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return messages.filter((message) => {
      if (
        filter === "input" &&
        message.role !== "system" &&
        message.role !== "user"
      ) {
        return false;
      } else if (
        filter !== "input" &&
        filter !== "all" &&
        message.role !== filter
      ) {
        return false;
      }
      if (!query) return true;
      const searchable = [
        message.role,
        message.source,
        message.model,
        message.content,
        message.toolCallId,
        ...(message.toolCalls ?? []).map((toolCall) => toolCall.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [filter, messages, searchTerm]);

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide">
          Message Flow
        </div>
        <div className="flex gap-1">
          {ROLE_FILTERS.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => setFilter(role)}
              className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                filter === role
                  ? "bg-trace-accent text-white border-trace-accent"
                  : "bg-transparent text-trace-muted border-trace-border hover:text-trace-text"
              }`}
            >
              {role === "input"
                ? "Input"
                : role === "all"
                  ? "All"
                  : role.charAt(0).toUpperCase() + role.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <input
          type="text"
          aria-label="Search prompt messages"
          placeholder="Search messages..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-1.5 text-[12px] bg-trace-bg border border-trace-border rounded focus:outline-none focus:border-trace-accent"
        />
      </div>

      {filteredMessages.length === 0 ? (
        <div className="text-sm text-trace-muted">
          No prompt messages match the current filter.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredMessages.map((message) => (
            <PromptMessageRow key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}

function PromptMessageRow({
  message,
  compact = false,
  turnLabel,
  headerBadges,
}: {
  message: PromptMessageView;
  compact?: boolean;
  turnLabel?: string;
  headerBadges?: React.ReactNode;
}) {
  const content = message.content ?? "";
  const toolCallSummary = message.toolCalls
    ?.map((toolCall) => toolCall.name)
    .join(", ");
  const previewLength = compact ? 120 : 180;
  const preview =
    content.length > 0
      ? truncate(readablePromptContent(content), previewLength)
      : toolCallSummary
        ? `Tool calls: ${toolCallSummary}`
        : message.toolCallId
          ? `Tool result for ${message.toolCallId}`
          : "Metadata-only message";
  const hasFullData =
    content.length > previewLength || Boolean(message.toolCalls?.length);

  return (
    <div className="border border-trace-border/60 rounded bg-trace-bg">
      <div className="flex items-center gap-2 px-3 py-2">
        <Badge variant={`role-${message.role}` as `role-${string}`}>
          {message.role}
        </Badge>
        <span className="text-[11px] text-trace-muted shrink-0">
          {turnLabel ??
            `T${message.turnNumber}${message.timestamp ? ` ${formatTime(message.timestamp)}` : ""}`}
        </span>
        {message.source && <Badge variant="type">{message.source}</Badge>}
        {message.model && (
          <span className="text-[10px] text-trace-dim font-mono truncate">
            {message.model}
          </span>
        )}
        {headerBadges}
      </div>
      <div className="px-3 pb-2 text-[12px] text-trace-subtle whitespace-pre-wrap break-words">
        {preview}
      </div>
      {hasFullData && (
        <CollapsibleSection
          label={<span className="text-[10px]">Full message data</span>}
          className="px-3 pb-2"
        >
          <div className="mt-1 p-2 text-[11px] font-mono text-trace-subtle whitespace-pre-wrap break-words bg-trace-panel-muted rounded border border-trace-border/60 max-h-[70vh] overflow-y-auto scrollbar-thin">
            <PromptContent text={content || "(no text content)"} />
            {message.toolCalls?.length ? (
              <pre className="mt-2 whitespace-pre-wrap break-words">
                {`[Tool Calls]\n${JSON.stringify(message.toolCalls, null, 2)}`}
              </pre>
            ) : null}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
