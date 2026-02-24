import React, { useCallback, useRef, useState } from "react";
import { marked } from "marked";
import { useStore } from "../../store";
import { formatDuration, formatCost, formatTokens, truncate } from "../../utils";

marked.setOptions({ breaks: true, gfm: true });

declare const __OPENROUTER_API_KEY__: string;

const STORAGE_KEY = "openrouter_api_key";
const MODEL = "x-ai/grok-4.1-fast";

function getApiKey(): string {
  const buildKey = typeof __OPENROUTER_API_KEY__ !== "undefined" ? __OPENROUTER_API_KEY__ : "";
  if (buildKey) return buildKey;
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

/** Pack session + entries + logs into a single prompt. */
function buildPrompt(
  session: Record<string, unknown>,
  entries: Record<string, unknown>[],
  logs: { lvl: string; msg: string; cat?: string; ts?: string }[],
): string {
  const metrics = session.metrics as Record<string, unknown> | undefined;
  const durationMs = ((session.endTime as number) || 0) - ((session.startTime as number) || 0);

  let cost = "";
  let tokens = "";
  if (metrics) {
    if (metrics.totalCost) cost = formatCost(metrics.totalCost as number);
    if (metrics.totalTokens) tokens = formatTokens(metrics.totalTokens as number);
  } else {
    if (session.totalCost) cost = formatCost(session.totalCost as number);
    if (session.totalTokens) tokens = formatTokens(session.totalTokens as number);
  }

  const lines: string[] = [];
  lines.push("# Session Data");
  lines.push(`Query: ${(session.query as string) || "(none)"}`);
  lines.push(`Outcome: ${session.outcome || "unknown"}`);
  lines.push(`Duration: ${formatDuration(durationMs)}`);
  if (tokens) lines.push(`Tokens: ${tokens}`);
  if (cost) lines.push(`Cost: ${cost}`);
  if (session.startUrl) lines.push(`Start URL: ${session.startUrl}`);
  lines.push(`Turns: ${(session.turnCount as number) || entries.length}`);
  lines.push("");

  // Each turn
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Record<string, unknown>;
    lines.push(`## Turn ${i + 1}`);
    const snap = e.snapshot as Record<string, unknown> | undefined;
    if (snap) {
      if (snap.url) lines.push(`URL: ${snap.url}`);
      if (snap.title) lines.push(`Title: ${snap.title}`);
    }
    // LLM content
    const llmContent = (e.llmContent as string) || (e.content as string) || "";
    if (llmContent) {
      const trimmed = llmContent.length > 2000 ? llmContent.slice(0, 2000) + "..." : llmContent;
      lines.push(`LLM: ${trimmed}`);
    }
    // Tool calls
    const tools = (e.toolCalls as Record<string, unknown>[]) || (e.tools as Record<string, unknown>[]) || [];
    for (const t of tools) {
      const name = t.name || t.toolName || "unknown";
      const args = t.args || t.arguments || {};
      const result = t.result ?? t.output ?? "";
      const success = t.success !== undefined ? t.success : t.error ? false : true;
      lines.push(`  Tool: ${name}(${typeof args === "string" ? args : JSON.stringify(args)})`);
      const resStr = typeof result === "string" ? result : JSON.stringify(result);
      lines.push(`  Result [${success ? "OK" : "ERROR"}]: ${truncate(resStr, 500)}`);
    }
    // Events
    const events = (e.events as Record<string, unknown>[]) || [];
    for (const ev of events) {
      lines.push(`  Event: ${ev.type || ev.name} ${ev.detail || ""}`);
    }
    lines.push("");
  }

  // Warn/error logs only
  const importantLogs = logs.filter((l) => l.lvl === "WARN" || l.lvl === "ERROR" || l.lvl === "warn" || l.lvl === "error");
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
  "You are a session analyst for a browser automation agent. " +
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
  "## Result\n" +
  "Final outcome with evidence from the trace data.";

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
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef("");

  const session = sessions.find((s) => (s.sessionId as string) === currentSessionId);
  const cachedStory = currentSessionId ? storyCache[currentSessionId] : undefined;

  const generate = useCallback(async () => {
    if (!currentSessionId || !session) return;
    const apiKey = getApiKey();
    if (!apiKey) return;

    setStoryLoading(true);
    setStoryError(null);
    setStreamText("");
    streamRef.current = "";

    const prompt = buildPrompt(
      session as Record<string, unknown>,
      currentEntries,
      sessionLogs as { lvl: string; msg: string; cat?: string; ts?: string }[],
    );

    abortRef.current = new AbortController();

    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          max_tokens: 4096,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
        signal: abortRef.current.signal,
      });

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
  }, [currentSessionId, session, currentEntries, sessionLogs, setStoryCache, setStoryLoading, setStoryError]);

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem(STORAGE_KEY, apiKeyInput.trim());
      setApiKeyInput("");
    }
  };

  // No API key available — show input
  if (!getApiKey()) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="text-trace-muted text-sm">OpenRouter API key required to generate stories</div>
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
    const html = marked.parse(cachedStory) as string;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
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
    const html = streamText ? (marked.parse(streamText) as string) : "";
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
        <button
          onClick={generate}
          className="px-4 py-2 text-sm font-medium rounded bg-trace-accent text-white hover:bg-trace-accent-light transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty — generate button
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="text-trace-muted text-sm">
        Generate an AI narrative of this session using {MODEL}
      </div>
      <button
        onClick={generate}
        className="px-5 py-2 text-sm font-medium rounded bg-trace-accent text-white hover:bg-trace-accent-light transition-colors cursor-pointer"
      >
        Generate Story
      </button>
    </div>
  );
}
