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

const ROLE_FILTERS: Array<"all" | PromptMessageRole> = [
  "all",
  "system",
  "user",
  "assistant",
  "tool",
];

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
            ? "No trace entries are loaded for this session."
            : "Prompt data was not recorded for this trace."}
        </div>
        <div className="text-[12px] text-trace-dim mt-2">
          This session can still be inspected through turns, logs, tools, and
          snapshots.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PromptAvailabilitySummary extraction={extraction} />
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

function SystemPromptEvolution({
  messages,
}: {
  messages: PromptMessageView[];
}) {
  const systemMessages = messages.filter((message) => message.role === "system");

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide">
          System Prompt Evolution
        </div>
        <Badge variant="role-system">{systemMessages.length}</Badge>
      </div>

      {systemMessages.length === 0 ? (
        <div className="text-sm text-trace-muted">
          No system messages were recorded in this trace.
        </div>
      ) : (
        <div className="space-y-2">
          {systemMessages.map((message) => (
            <PromptMessageRow key={message.id} message={message} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageFlow({ messages }: { messages: PromptMessageView[] }) {
  const [filter, setFilter] = useState<"all" | PromptMessageRole>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredMessages = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return messages.filter((message) => {
      if (filter !== "all" && message.role !== filter) return false;
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
              {role === "all" ? "All" : role.charAt(0).toUpperCase() + role.slice(1)}
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
}: {
  message: PromptMessageView;
  compact?: boolean;
}) {
  const content = message.content ?? "";
  const toolCallSummary = message.toolCalls
    ?.map((toolCall) => toolCall.name)
    .join(", ");
  const preview =
    content.length > 0
      ? truncate(content, compact ? 120 : 180)
      : toolCallSummary
        ? `Tool calls: ${toolCallSummary}`
        : message.toolCallId
          ? `Tool result for ${message.toolCallId}`
          : "Metadata-only message";

  return (
    <div className="border border-trace-border/60 rounded bg-trace-bg">
      <div className="flex items-center gap-2 px-3 py-2">
        <Badge variant={`role-${message.role}` as `role-${string}`}>
          {message.role}
        </Badge>
        <span className="text-[11px] text-trace-muted shrink-0">
          T{message.turnNumber}
          {message.timestamp ? ` ${formatTime(message.timestamp)}` : ""}
        </span>
        {message.source && <Badge variant="type">{message.source}</Badge>}
        {message.model && (
          <span className="text-[10px] text-trace-dim font-mono truncate">
            {message.model}
          </span>
        )}
      </div>
      <div className="px-3 pb-2 text-[12px] text-trace-subtle whitespace-pre-wrap break-words">
        {preview}
      </div>
      {!compact && (content.length > 180 || message.toolCalls?.length) && (
        <CollapsibleSection
          label={<span className="text-[10px]">Full message data</span>}
          className="px-3 pb-2"
        >
          <pre className="mt-1 p-2 text-[11px] font-mono text-trace-subtle whitespace-pre-wrap break-words bg-trace-panel-muted rounded border border-trace-border/60 max-h-[360px] overflow-y-auto scrollbar-thin">
            {content || "(no text content)"}
            {message.toolCalls?.length
              ? `\n\n[Tool Calls]\n${JSON.stringify(message.toolCalls, null, 2)}`
              : ""}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  );
}
