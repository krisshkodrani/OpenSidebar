import React, { useEffect, useMemo, useState } from "react";
import type {
  TraceEntry,
  TraceLLMMessage,
  TraceSession,
} from "../../../types/traces";
import type { ViewerModelIOSection } from "@observability-schema";
import { buildViewerUrl } from "@observability-schema";
import { useStore } from "../../store";
import {
  formatCost,
  formatDuration,
  formatTime,
  formatTokens,
  shortModel,
  truncate,
} from "../../utils";
import Badge from "../Badge";
import CollapsibleSection from "../CollapsibleSection";

interface PromptsTabProps {
  session: TraceSession;
  entries: TraceEntry[];
}

type CaptureStatus = "recorded" | "truncated" | "redacted" | "unavailable";
type TurnFilter = "all" | "changes" | "tools" | "incomplete";

const TURN_FILTERS: Array<{ value: TurnFilter; label: string }> = [
  { value: "all", label: "All turns" },
  { value: "changes", label: "Prompt changes" },
  { value: "tools", label: "Tool calls" },
  { value: "incomplete", label: "Incomplete" },
];

const REDACTION_MARKER = /\[REDACTED(?:_[A-Z_]+)?\]/i;
const TRUNCATION_MARKER = /\[(?:CONTENT )?TRUNCATED[^\]]*\]|content truncated/i;

interface ModelIOTurn {
  entry: TraceEntry;
  requestStatus: CaptureStatus;
  responseStatus: CaptureStatus;
  systemPromptChanged: boolean;
  searchable: string;
}

interface SystemPromptVersion {
  content: string;
  turns: number[];
  status: CaptureStatus;
}

function captureStatus(
  values: Array<string | null | undefined>,
  available: boolean,
): CaptureStatus {
  if (!available) return "unavailable";
  const text = values.filter(Boolean).join("\n");
  if (REDACTION_MARKER.test(text)) return "redacted";
  if (TRUNCATION_MARKER.test(text)) return "truncated";
  return "recorded";
}

function requestStatus(entry: TraceEntry): CaptureStatus {
  const messages = entry.llmRequest?.messages;
  return captureStatus(
    messages?.flatMap((message) => [
      message.content,
      ...(message.tool_calls ?? []).map((call) => call.function.arguments),
    ]) ?? [],
    Boolean(messages?.length),
  );
}

function responseStatus(entry: TraceEntry): CaptureStatus {
  const response = entry.llmResponse;
  return captureStatus(
    [response?.content, ...(response?.toolCalls ?? []).map((call) => call.function.arguments)],
    Boolean(response),
  );
}

function statusClass(status: CaptureStatus): string {
  if (status === "recorded") {
    return "border-state-success/25 bg-state-success/10 text-state-success";
  }
  if (status === "unavailable") {
    return "border-state-error/25 bg-state-error/10 text-state-error";
  }
  return "border-state-warning/25 bg-state-warning/10 text-state-warning";
}

function CaptureBadge({ status }: { status: CaptureStatus }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${statusClass(status)}`}
    >
      {status}
    </span>
  );
}

function systemPrompt(messages: TraceLLMMessage[] | undefined): string {
  return (messages ?? [])
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "")
    .join("\n\n");
}

function buildTurns(entries: TraceEntry[]): ModelIOTurn[] {
  let previousSystemPrompt: string | null = null;
  return entries.map((entry) => {
    const currentSystemPrompt = systemPrompt(entry.llmRequest?.messages);
    const systemPromptChanged =
      Boolean(currentSystemPrompt) &&
      previousSystemPrompt != null &&
      currentSystemPrompt !== previousSystemPrompt;
    if (currentSystemPrompt) previousSystemPrompt = currentSystemPrompt;
    const searchable = [
      entry.turnNumber,
      entry.llmRequest?.model,
      entry.llmRequest?.modelTier,
      ...(entry.llmRequest?.messages ?? []).flatMap((message) => [
        message.role,
        message.content,
        ...(message.tool_calls ?? []).map((call) => call.function.name),
      ]),
      entry.llmResponse?.content,
      entry.llmResponse?.finishReason,
      ...(entry.llmResponse?.toolCalls ?? []).flatMap((call) => [
        call.function.name,
        call.function.arguments,
      ]),
      ...(entry.toolExecutions ?? []).flatMap((execution) => [
        execution.toolName,
        JSON.stringify(execution.args),
        execution.result,
        execution.error,
      ]),
    ]
      .filter((value) => value != null)
      .join(" ")
      .toLowerCase();
    return {
      entry,
      requestStatus: requestStatus(entry),
      responseStatus: responseStatus(entry),
      systemPromptChanged,
      searchable,
    };
  });
}

function buildSystemVersions(entries: TraceEntry[]): SystemPromptVersion[] {
  const versions = new Map<string, SystemPromptVersion>();
  for (const entry of entries) {
    const content = systemPrompt(entry.llmRequest?.messages);
    if (!content) continue;
    const existing = versions.get(content);
    if (existing) existing.turns.push(entry.turnNumber);
    else {
      versions.set(content, {
        content,
        turns: [entry.turnNumber],
        status: captureStatus([content], true),
      });
    }
  }
  return [...versions.values()];
}

function formatTurnRange(turns: number[]): string {
  if (turns.length === 1) return `T${turns[0]}`;
  const contiguous = turns.every(
    (turn, index) => index === 0 || turn === turns[index - 1] + 1,
  );
  return contiguous
    ? `T${turns[0]}–T${turns[turns.length - 1]}`
    : turns.map((turn) => `T${turn}`).join(", ");
}

export default function PromptsTab({ session, entries }: PromptsTabProps) {
  const modelIOFocus = useStore((state) => state.modelIOFocus);
  const [filter, setFilter] = useState<TurnFilter>("all");
  const [query, setQuery] = useState("");
  const turns = useMemo(() => buildTurns(entries), [entries]);
  const systemVersions = useMemo(() => buildSystemVersions(entries), [entries]);
  const filteredTurns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return turns.filter((turn) => {
      if (filter === "changes" && !turn.systemPromptChanged) return false;
      if (
        filter === "tools" &&
        (turn.entry.llmResponse?.toolCalls?.length ?? 0) === 0
      ) {
        return false;
      }
      if (
        filter === "incomplete" &&
        turn.requestStatus === "recorded" &&
        turn.responseStatus === "recorded"
      ) {
        return false;
      }
      return !normalizedQuery || turn.searchable.includes(normalizedQuery);
    });
  }, [filter, query, turns]);

  useEffect(() => {
    if (!modelIOFocus) return;
    const suffix = modelIOFocus.section ? `-${modelIOFocus.section}` : "";
    const target = document.getElementById(
      `model-io-turn-${modelIOFocus.turnNumber}${suffix}`,
    );
    if (!target || typeof target.scrollIntoView !== "function") return;
    requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
  }, [modelIOFocus, turns]);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-trace-border bg-trace-panel p-4">
        <div className="text-sm font-medium text-trace-text">Model I/O unavailable</div>
        <div className="mt-1 text-xs text-trace-muted">
          No trace turns are loaded for this session.
        </div>
      </div>
    );
  }

  const recordedRequests = turns.filter(
    (turn) => turn.requestStatus !== "unavailable",
  ).length;
  const recordedResponses = turns.filter(
    (turn) => turn.responseStatus !== "unavailable",
  ).length;
  const partialCount = turns.filter(
    (turn) =>
      turn.requestStatus !== "recorded" || turn.responseStatus !== "recorded",
  ).length;

  return (
    <div className="space-y-3" data-testid="model-io-view">
      <section className="rounded-lg border border-trace-border bg-trace-panel p-3">
        <div className="flex flex-wrap items-start gap-2">
          <div>
            <h2 className="text-sm font-semibold text-trace-text">Model I/O</h2>
            <p className="mt-0.5 text-[11px] text-trace-muted">
              Recorded effective messages, model responses, tool calls, and outcomes.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded border border-trace-border px-2 py-1 text-trace-subtle">
              {recordedRequests}/{turns.length} requests
            </span>
            <span className="rounded border border-trace-border px-2 py-1 text-trace-subtle">
              {recordedResponses}/{turns.length} responses
            </span>
            {partialCount > 0 && (
              <span className="rounded border border-state-warning/25 bg-state-warning/10 px-2 py-1 text-state-warning">
                {partialCount} incomplete
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 text-[10px] text-trace-dim">
          “Recorded” means retained by the trace. Provider envelopes and tool schemas
          are not reconstructed when they were not captured.
        </div>
      </section>

      <SystemPromptEvolution versions={systemVersions} totalTurns={turns.length} />

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-trace-border bg-trace-bg/95 p-2 shadow-sm backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search prompts, responses, tools, or results…"
          aria-label="Search model input and output"
          className="min-w-[240px] flex-1 rounded border border-trace-border bg-trace-panel px-3 py-1.5 text-xs text-trace-text outline-none placeholder:text-trace-dim focus:border-trace-accent"
        />
        <div className="flex flex-wrap gap-1">
          {TURN_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={`rounded border px-2 py-1 text-[10px] font-medium transition-colors ${
                filter === option.value
                  ? "border-trace-accent/40 bg-trace-accent/15 text-trace-accent-light"
                  : "border-trace-border text-trace-muted hover:text-trace-text"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {filteredTurns.length === 0 ? (
        <div className="rounded-lg border border-trace-border bg-trace-panel p-6 text-center text-sm text-trace-muted">
          No turns match the current Model I/O filters.
        </div>
      ) : (
        filteredTurns.map((turn) => (
          <ModelIOTurnCard
            key={turn.entry.turnNumber}
            sessionId={session.sessionId}
            turn={turn}
            focused={modelIOFocus?.turnNumber === turn.entry.turnNumber}
          />
        ))
      )}
    </div>
  );
}

function SystemPromptEvolution({
  versions,
  totalTurns,
}: {
  versions: SystemPromptVersion[];
  totalTurns: number;
}) {
  if (versions.length === 0) return null;
  return (
    <CollapsibleSection
      label="System prompt evolution"
      preview={`${versions.length} version${versions.length === 1 ? "" : "s"} across ${totalTurns} turns`}
    >
      <div className="space-y-2 pt-2">
        {versions.map((version, index) => (
          <div
            key={`${version.turns[0]}-${index}`}
            className="rounded border border-trace-border bg-trace-panel p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="role-system">system</Badge>
              <span className="text-[10px] text-trace-muted">
                {formatTurnRange(version.turns)}
              </span>
              <CaptureBadge status={version.status} />
              {index > 0 && <Badge variant="dynamic">changed</Badge>}
            </div>
            <div className="whitespace-pre-wrap break-words text-xs text-trace-subtle">
              {truncate(readablePromptContent(version.content), 320)}
            </div>
            {version.content.length > 320 && (
              <LazyDisclosure label="Full system prompt" className="mt-2">
                <pre className="mt-2 max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words rounded border border-trace-border bg-trace-bg p-3 text-[11px] text-trace-subtle">
                  {version.content}
                </pre>
              </LazyDisclosure>
            )}
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}

function ModelIOTurnCard({
  sessionId,
  turn,
  focused,
}: {
  sessionId: string;
  turn: ModelIOTurn;
  focused: boolean;
}) {
  const { entry } = turn;
  const response = entry.llmResponse;
  const usage = response?.usage;
  const contextUtilization = entry.llmRequest?.contextMetrics?.utilization;

  return (
    <article
      id={`model-io-turn-${entry.turnNumber}`}
      className={`scroll-mt-14 overflow-hidden rounded-lg border bg-trace-panel ${
        focused
          ? "border-trace-accent/60 ring-1 ring-trace-accent/25"
          : "border-trace-border"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-trace-border bg-trace-accent/[0.06] px-3 py-2">
        <span className="text-xs font-bold text-trace-accent-light">
          Turn {entry.turnNumber}
        </span>
        <span className="text-[10px] text-trace-muted">
          {formatTime(entry.timestamp)}
        </span>
        {entry.llmRequest?.model && (
          <Badge variant="model">{shortModel(entry.llmRequest.model)}</Badge>
        )}
        {response?.actualProviderId && (
          <span className="text-[10px] text-state-warning">
            via {response.actualProviderId}
          </span>
        )}
        {response?.actualModel &&
          response.actualModel !== entry.llmRequest?.model && (
            <span className="text-[10px] text-state-warning">
              → {shortModel(response.actualModel)}
            </span>
          )}
        {turn.systemPromptChanged && <Badge variant="dynamic">prompt changed</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[10px] text-trace-muted">
          {response?.durationMs != null && (
            <span>{formatDuration(response.durationMs)}</span>
          )}
          {usage?.total_tokens != null && (
            <span>{formatTokens(usage.total_tokens)} tokens</span>
          )}
          {usage?.cost != null && <span>{formatCost(usage.cost)}</span>}
        </div>
      </header>

      <div className="grid md:grid-cols-2">
        <ModelIOPanel
          id={`model-io-turn-${entry.turnNumber}-request`}
          title="Request"
          status={turn.requestStatus}
          copyLabel="Copy request link"
          onCopyLink={() => copySectionLink(sessionId, entry.turnNumber, "request")}
          className="border-b border-trace-border md:border-b-0 md:border-r"
        >
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-trace-muted">
            <span>{entry.llmRequest?.messages?.length ?? 0} messages</span>
            <span>{entry.llmRequest?.toolCount ?? 0} tools offered</span>
            {contextUtilization != null && (
              <span>{Math.round(contextUtilization * 100)}% context</span>
            )}
            {entry.llmRequest?.compressionLevel && (
              <span>compression: {entry.llmRequest.compressionLevel}</span>
            )}
          </div>
          <RequestPreview messages={entry.llmRequest?.messages ?? []} />
        </ModelIOPanel>

        <ModelIOPanel
          id={`model-io-turn-${entry.turnNumber}-response`}
          title="Response"
          status={turn.responseStatus}
          copyLabel="Copy response link"
          onCopyLink={() => copySectionLink(sessionId, entry.turnNumber, "response")}
        >
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-trace-muted">
            <span>finish: {response?.finishReason ?? "unavailable"}</span>
            {usage && <span>{formatTokens(usage.prompt_tokens)} in</span>}
            {usage && <span>{formatTokens(usage.completion_tokens)} out</span>}
          </div>
          <ResponsePreview entry={entry} />
        </ModelIOPanel>
      </div>

      {(entry.toolExecutions ?? []).length > 0 && (
        <ToolOutcomeStrip entry={entry} />
      )}
    </article>
  );
}

function ModelIOPanel({
  id,
  title,
  status,
  copyLabel,
  onCopyLink,
  className = "",
  children,
}: {
  id: string;
  title: string;
  status: CaptureStatus;
  copyLabel: string;
  onCopyLink: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-14 min-w-0 p-3 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
          {title}
        </span>
        <CaptureBadge status={status} />
        <button
          type="button"
          onClick={onCopyLink}
          className="ml-auto text-[9px] text-trace-muted hover:text-trace-accent-light"
        >
          {copyLabel}
        </button>
      </div>
      {children}
    </section>
  );
}

function previewMessages(messages: TraceLLMMessage[]): TraceLLMMessage[] {
  const selected = new Set<TraceLLMMessage>();
  const firstSystem = messages.find((message) => message.role === "system");
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const lastTool = [...messages].reverse().find((message) => message.role === "tool");
  const lastAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (firstSystem) selected.add(firstSystem);
  if (lastUser) selected.add(lastUser);
  if (lastTool) selected.add(lastTool);
  if (lastAssistant) selected.add(lastAssistant);
  return messages.filter((message) => selected.has(message));
}

function RequestPreview({ messages }: { messages: TraceLLMMessage[] }) {
  if (messages.length === 0) {
    return <div className="text-xs text-state-error">Request messages unavailable.</div>;
  }
  const preview = previewMessages(messages);
  return (
    <>
      <div className="space-y-2">
        {preview.map((message, index) => (
          <MessagePreview key={`${message.role}-${index}`} message={message} />
        ))}
      </div>
      <LazyDisclosure
        label={`Full request (${messages.length} message${messages.length === 1 ? "" : "s"})`}
        className="mt-2"
      >
        <div className="mt-2 space-y-2">
          {messages.map((message, index) => (
            <FullMessage key={`${message.role}-${index}`} message={message} />
          ))}
        </div>
      </LazyDisclosure>
    </>
  );
}

function MessagePreview({ message }: { message: TraceLLMMessage }) {
  const toolNames = (message.tool_calls ?? [])
    .map((call) => call.function.name)
    .join(", ");
  const text = message.content
    ? readablePromptContent(message.content)
    : toolNames
      ? `Tool calls: ${toolNames}`
      : message.tool_call_id
        ? `Tool result for ${message.tool_call_id}`
        : "Metadata-only message";
  return (
    <div className="rounded border border-trace-border/70 bg-trace-bg p-2">
      <Badge variant={`role-${message.role}` as `role-${string}`}>
        {message.role}
      </Badge>
      <div className="mt-1 whitespace-pre-wrap break-words text-[11px] text-trace-subtle">
        {truncate(text, 240)}
      </div>
    </div>
  );
}

function FullMessage({ message }: { message: TraceLLMMessage }) {
  return (
    <div className="rounded border border-trace-border bg-trace-bg p-2">
      <Badge variant={`role-${message.role}` as `role-${string}`}>
        {message.role}
      </Badge>
      <div className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-trace-subtle">
        <PromptContent text={message.content || "(no text content)"} />
        {message.tool_calls?.length ? (
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {JSON.stringify(message.tool_calls, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function ResponsePreview({ entry }: { entry: TraceEntry }) {
  const response = entry.llmResponse;
  if (!response) {
    return <div className="text-xs text-state-error">Response unavailable.</div>;
  }
  const content = response.content ?? "";
  return (
    <>
      {content ? (
        <div className="whitespace-pre-wrap break-words text-xs text-trace-subtle">
          {content.length > 600 ? (
            truncate(readablePromptContent(content), 600)
          ) : (
            <PromptContent text={content} />
          )}
        </div>
      ) : (
        <div className="text-xs text-trace-muted">
          No assistant text; the response contains tool calls or metadata only.
        </div>
      )}
      {(response.toolCalls ?? []).length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
            Tool calls
          </div>
          {response.toolCalls.map((call, index) => (
            <div
              key={call.id || `${call.function.name}-${index}`}
              className="rounded border border-brand-live/25 bg-brand-live/5 p-2"
            >
              <div className="font-mono text-[11px] font-semibold text-brand-live">
                {call.function.name}
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-trace-subtle">
                {truncate(call.function.arguments, 320)}
              </pre>
            </div>
          ))}
        </div>
      )}
      {(content.length > 600 || (response.toolCalls ?? []).length > 0) && (
        <LazyDisclosure label="Full recorded response" className="mt-2">
          <pre className="mt-2 max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words rounded border border-trace-border bg-trace-bg p-3 text-[11px] text-trace-subtle">
            {content || "(no assistant text)"}
            {(response.toolCalls ?? []).length > 0
              ? `\n\n[Tool Calls]\n${JSON.stringify(response.toolCalls, null, 2)}`
              : ""}
          </pre>
        </LazyDisclosure>
      )}
    </>
  );
}

function ToolOutcomeStrip({ entry }: { entry: TraceEntry }) {
  return (
    <section className="border-t border-trace-border bg-trace-bg/40 p-3">
      <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
        Recorded tool outcomes
      </div>
      <div className="grid gap-2 xl:grid-cols-2">
        {(entry.toolExecutions ?? []).map((execution, index) => (
          <div
            key={execution.executionId || execution.toolCallId || index}
            className={`rounded border p-2 ${
              execution.success
                ? "border-state-success/20 bg-state-success/5"
                : "border-state-error/25 bg-state-error/5"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-trace-text">
                {execution.toolName}
              </span>
              <CaptureBadge
                status={captureStatus(
                  [
                    JSON.stringify(execution.args),
                    execution.result,
                    execution.error,
                  ],
                  true,
                )}
              />
              <span
                className={`text-[10px] ${execution.success ? "text-state-success" : "text-state-error"}`}
              >
                {execution.success ? "success" : "failed"}
              </span>
              <span className="ml-auto text-[10px] text-trace-muted">
                {formatDuration(execution.durationMs)}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-trace-muted">
              input: {truncate(JSON.stringify(execution.args), 220)}
            </div>
            <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] text-trace-subtle">
              result: {truncate(execution.error || execution.result || "(empty result)", 320)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function copySectionLink(
  sessionId: string,
  turnNumber: number,
  section: ViewerModelIOSection,
) {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const url = buildViewerUrl(
    { sessionId, view: "prompts", turn: turnNumber, section },
    baseUrl,
  );
  void navigator.clipboard?.writeText(url);
}

function LazyDisclosure({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded bg-trace-accent/[0.05] px-2 py-1.5 text-left text-xs text-trace-subtle transition-colors hover:bg-trace-accent/[0.08]"
      >
        <span
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
        {label}
      </button>
      {open ? children : null}
    </div>
  );
}

type PromptContentPart = { type: "text" | "think"; content: string };

function parsePromptContent(text: string): PromptContentPart[] {
  const parts: PromptContentPart[] = [];
  const pattern = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    const previous = parts.at(-1);
    if (previous?.type === "think") previous.content += match[1];
    else parts.push({ type: "think", content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: "text", content: text }];
}

function readablePromptContent(text: string): string {
  return parsePromptContent(text)
    .map((part) =>
      part.type === "think" ? `Thinking: ${part.content}` : part.content,
    )
    .join("");
}

function PromptContent({ text }: { text: string }) {
  const parts = parsePromptContent(text);
  if (parts.every((part) => part.type === "text")) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.type === "think" ? (
          <div
            key={index}
            className="my-1 rounded-r border-l-2 border-brand-live/60 bg-brand-live/10 py-1.5 pl-2.5"
          >
            <span className="text-[9px] font-semibold uppercase tracking-wider text-brand-live">
              Recorded reasoning
            </span>
            <div className="mt-0.5 italic text-brand-live/80">{part.content}</div>
          </div>
        ) : (
          <span key={index}>{part.content}</span>
        ),
      )}
    </>
  );
}
