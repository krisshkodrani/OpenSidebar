import React, { useCallback, useEffect, useRef, useState } from "react";
import type { TraceSession, TraceEntry } from "../../../types/traces";
import type { SessionLogEntry } from "../../store/types";
import { marked } from "marked";
import { useStore } from "../../store";
import {
  formatDuration,
  formatCost,
  formatTokens,
  truncate,
} from "../../utils";
import { sanitizeHtml } from "../../../utils/sanitize-html";

marked.setOptions({ breaks: true, gfm: true });

const STORAGE_KEY = "openrouter_api_key";
const MODEL_STORAGE_KEY = "story_model";

const STORY_MODELS = [
  "minimax/minimax-m2.5",
  "x-ai/grok-4.1-fast",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-flash",
  "google/gemini-3-flash-preview",
];

function getApiKey(): string {
  return sessionStorage.getItem(STORAGE_KEY) ?? "";
}

function getModel(): string {
  return localStorage.getItem(MODEL_STORAGE_KEY) || STORY_MODELS[0];
}

/** Pack session + entries + logs into a single prompt. */
function buildPrompt(
  session: TraceSession,
  entries: TraceEntry[],
  logs: SessionLogEntry[],
): string {
  const metrics = session.metrics;
  const durationMs = (session.endTime || 0) - (session.startTime || 0);

  let cost = "";
  let tokens = "";
  if (metrics) {
    if (metrics.totalCost) cost = formatCost(metrics.totalCost);
    if (metrics.totalTokens)
      tokens = formatTokens(metrics.totalTokens);
  }

  const lines: string[] = [];
  lines.push("# Session Data");
  lines.push(`Query: ${session.query || "(none)"}`);
  lines.push(`Outcome: ${session.outcome || "unknown"}`);
  lines.push(`Duration: ${formatDuration(durationMs)}`);
  if (tokens) lines.push(`Tokens: ${tokens}`);
  if (cost) lines.push(`Cost: ${cost}`);
  if (session.startUrl) lines.push(`Start URL: ${session.startUrl}`);
  lines.push(`Turns: ${session.turnCount || entries.length}`);
  lines.push("");

  // Each turn
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    lines.push(`## Turn ${i + 1}`);
    if (e.snapshot) {
      if (e.snapshot.url) lines.push(`URL: ${e.snapshot.url}`);
      if (e.snapshot.title) lines.push(`Title: ${e.snapshot.title}`);
      lines.push(`Elements: ${e.snapshot.elementCount}`);
    }
    // Model & context info
    if (e.llmRequest) {
      const req = e.llmRequest;
      const tierLabel = req.modelTier === "planner" ? " [PLANNER]" : " [EXECUTOR]";
      lines.push(`Model: ${req.model}${tierLabel}`);
      lines.push(`Compression: ${req.compressionLevel}, Messages: ${req.messageCount}`);
      if (req.contextMetrics) {
        const cm = req.contextMetrics;
        lines.push(`Context: ${cm.totalTokens}/${cm.maxTokens} tokens (${Math.round(cm.utilization * 100)}%), dropped: ${cm.droppedMessageCount}`);
      }
    }
    // LLM response
    if (e.llmResponse) {
      const resp = e.llmResponse;
      const llmContent = resp.content || "";
      if (llmContent) {
        const trimmed =
          llmContent.length > 2000
            ? llmContent.slice(0, 2000) + "..."
            : llmContent;
        lines.push(`LLM: ${trimmed}`);
      }
      if (resp.actualModel && resp.actualModel !== e.llmRequest?.model) {
        lines.push(`Actual model (failover): ${resp.actualModel}`);
      }
      if (resp.usage) {
        lines.push(`Tokens: ${resp.usage.prompt_tokens} in / ${resp.usage.completion_tokens} out${resp.usage.cost ? ` ($${resp.usage.cost.toFixed(4)})` : ""}`);
      }
      lines.push(`LLM latency: ${resp.durationMs}ms`);
    }
    // Perception
    if (e.perception) {
      const p = e.perception;
      lines.push(`Perception [${p.model}]: ${p.cached ? "CACHED" : `${p.durationMs}ms`}`);
      if (p.interpretation) {
        lines.push(`  Vision: ${truncate(p.interpretation, 500)}`);
      }
    }
    // Stagnation
    if (e.progressState) {
      const ps = e.progressState;
      if (ps.stagnantTurns > 0 || ps.signal) {
        lines.push(`Stagnation: ${ps.stagnantTurns} stagnant turns${ps.signal ? `, signal: ${ps.signal}` : ""}`);
      }
    }
    // Tool executions
    const toolExecs = e.toolExecutions || [];
    for (const t of toolExecs) {
      lines.push(
        `  Tool: ${t.toolName}(${JSON.stringify(t.args)})`,
      );
      lines.push(
        `  Result [${t.success ? "OK" : "ERROR"}]: ${truncate(t.result, 500)}`,
      );
    }
    // Events
    const events = e.events || [];
    for (const ev of events) {
      lines.push(`  Event: ${ev.type}`);
    }
    lines.push("");
  }

  // Warn/error logs only
  const importantLogs = logs.filter(
    (l) =>
      l.lvl === "WARN" ||
      l.lvl === "ERROR" ||
      l.lvl === "warn" ||
      l.lvl === "error",
  );
  if (importantLogs.length > 0) {
    lines.push("## Logs (WARN/ERROR only)");
    for (const l of importantLogs.slice(0, 100)) {
      lines.push(`[${l.lvl}] ${l.cat ? `[${l.cat}] ` : ""}${l.msg}`);
    }
  }

  return lines.join("\n");
}

/* eslint-disable prefer-template */
const SYSTEM_PROMPT =
  "You are a senior session analyst for a browser automation agent. " +
  "Given the full trace data of an agent session, produce a structured Markdown report. " +
  "Be specific — reference turn numbers, tool names, and URLs. Be concise but thorough.\n\n" +
  "Use this structure:\n\n" +
  "## Session Overview\n" +
  "Goal, outcome, duration, key stats.\n\n" +
  "## Timeline\n" +
  "Chronological narrative — what happened each turn and why the agent made that choice.\n\n" +
  "## Key Decisions\n" +
  "Escalations, strategy pivots, model switches, planning steps.\n\n" +
  "## Issues & Failures\n" +
  "Tool failures, stagnation, unexpected states, retries.\n\n" +
  "## Efficiency Analysis\n" +
  "Turn economy: how many turns were productive vs wasted (retries, empty responses, rejected done() calls, unnecessary reads). " +
  "Tool selection: were the right tools used? Could fewer calls have achieved the same result? " +
  "Identify the optimal path — the minimum number of tool calls that would complete the task.\n\n" +
  "## Model & Provider Insights\n" +
  "Analyze model behavior: did the model use native tool calling or was text-based recovery needed? " +
  "Note any model switches (executor/planner), escalation triggers, and their effectiveness. " +
  "Flag empty responses, hallucinated tool arguments, or format issues.\n\n" +
  "## Perception & Context\n" +
  "How well did perception (screenshot interpretation) contribute? Was it cached, stale, or failing? " +
  "Context window usage: compression levels, token utilization, history management.\n\n" +
  "## Result\n" +
  "Final outcome with evidence from the trace data. " +
  "Score the session 1-10 on: task completion, efficiency, error recovery. Justify each score.";

export default function StoryPanel() {
  const currentSessionId = useStore((s) => s.currentSessionId);
  const sessions = useStore((s) => s.sessions);
  const currentEntries = useStore((s) => s.currentEntries);
  const sessionLogs = useStore((s) => s.sessionLogs);
  const storyCache = useStore((s) => s.storyCache);
  const storyLoading = useStore((s) => s.storyLoading);
  const storyError = useStore((s) => s.storyError);
  const setStoryCache = useStore((s) => s.setStoryCache);
  const setStoryLoading = useStore((s) => s.setStoryLoading);
  const setStoryError = useStore((s) => s.setStoryError);

  const [streamText, setStreamText] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [model, setModel] = useState(getModel);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef("");

  const session = sessions.find(
    (s) => s.sessionId === currentSessionId,
  );
  const cachedStory = currentSessionId
    ? storyCache[currentSessionId]
    : undefined;

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    localStorage.setItem(MODEL_STORAGE_KEY, newModel);
  };

  const generate = useCallback(async () => {
    if (!currentSessionId || !session) return;
    const apiKey = getApiKey();
    if (!apiKey) return;

    setStoryLoading(true);
    setStoryError(null);
    setStreamText("");
    streamRef.current = "";

    const prompt = buildPrompt(session, currentEntries, sessionLogs);

    abortRef.current = new AbortController();

    try {
      const resp = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            stream: true,
            max_tokens: 4096,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
          }),
          signal: abortRef.current.signal,
        },
      );

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`OpenRouter ${resp.status}: ${body.slice(0, 200)}`);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buf = "";
      let rafPending = false;

      const flushToState = () => {
        rafPending = false;
        setStreamText(streamRef.current);
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;

          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              streamRef.current += delta;
              if (!rafPending) {
                rafPending = true;
                requestAnimationFrame(flushToState);
              }
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      // Final flush
      setStreamText(streamRef.current);
      setStoryCache(currentSessionId, streamRef.current);
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setStoryError((err as Error).message || String(err));
      }
    } finally {
      setStoryLoading(false);
      abortRef.current = null;
    }
  }, [
    currentSessionId,
    session,
    currentEntries,
    sessionLogs,
    model,
    setStoryCache,
    setStoryLoading,
    setStoryError,
  ]);

  // Auto-generate when Story tab is opened with API key + entries + no cached story
  const autoTriggered = useRef(false);
  useEffect(() => {
    if (autoTriggered.current) return;
    if (!currentSessionId || !session || !getApiKey()) return;
    if (cachedStory || storyLoading || storyError) return;
    if (currentEntries.length === 0) return;
    autoTriggered.current = true;
    generate();
  }, [currentSessionId, session, cachedStory, storyLoading, storyError, currentEntries, generate]);

  // Reset auto-trigger when session changes
  useEffect(() => {
    autoTriggered.current = false;
  }, [currentSessionId]);

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      sessionStorage.setItem(STORAGE_KEY, apiKeyInput.trim());
      setApiKeyInput("");
    }
  };

  const modelSelector = (
    <select
      value={model}
      onChange={(e) => handleModelChange(e.target.value)}
      className="px-2 py-1 text-xs rounded bg-trace-bg border border-trace-border text-trace-text focus:outline-none focus:border-trace-accent cursor-pointer"
    >
      {STORY_MODELS.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );

  // No API key available — show input
  if (!getApiKey()) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="text-trace-muted text-sm">
          OpenRouter API key required to generate stories
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
            placeholder="sk-or-..."
            className="px-3 py-1.5 text-sm rounded bg-trace-bg border border-trace-border text-trace-text placeholder:text-trace-dim focus:outline-none focus:border-trace-accent w-72"
          />
          <button
            onClick={handleSaveKey}
            className="px-4 py-1.5 text-sm font-medium rounded bg-trace-accent text-white hover:bg-trace-accent-light transition-colors cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  // Cached story — render Markdown
  if (cachedStory && !storyLoading) {
    const html = sanitizeHtml(marked.parse(cachedStory) as string);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {modelSelector}
          <button
            onClick={generate}
            className="px-3 py-1 text-xs font-medium rounded border border-trace-border text-trace-muted hover:text-trace-text hover:border-trace-accent transition-colors cursor-pointer"
          >
            Regenerate
          </button>
        </div>
        <div
          className="story-prose text-sm text-trace-text leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  // Loading / streaming
  if (storyLoading) {
    const html = streamText ? sanitizeHtml(marked.parse(streamText) as string) : "";
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-trace-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-trace-muted">Generating story...</span>
          <button
            onClick={() => abortRef.current?.abort()}
            className="ml-2 px-2 py-0.5 text-xs rounded border border-trace-border text-trace-muted hover:text-trace-text cursor-pointer"
          >
            Cancel
          </button>
        </div>
        {html && (
          <div
            className="story-prose text-sm text-trace-text leading-relaxed"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    );
  }

  // Error state
  if (storyError) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="text-red-400 text-sm">{storyError}</div>
        <div className="flex items-center gap-3">
          {modelSelector}
          <button
            onClick={generate}
            className="px-4 py-2 text-sm font-medium rounded bg-trace-accent text-white hover:bg-trace-accent-light transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty — generate button
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="text-trace-muted text-sm">
        Generate an AI narrative of this session
      </div>
      <div className="flex items-center gap-3">
        {modelSelector}
        <button
          onClick={generate}
          className="px-5 py-2 text-sm font-medium rounded bg-trace-accent text-white hover:bg-trace-accent-light transition-colors cursor-pointer"
        >
          Generate Story
        </button>
      </div>
    </div>
  );
}
