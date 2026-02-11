# Phase 5 — Kimi k2.5 Swarm (Deep Thought Engine)

> **Goal:** Implement the `activate_swarm` tool that delegates complex research tasks to Kimi k2.5 via OpenRouter, receives a comprehensive report, and feeds it back to the Reflex Engine.

---

## Background

The Reflex Engine (Cerebras GPT-OSS-120b) is fast but shallow — it handles one page at a time. For tasks requiring multi-page research, deep analysis, or synthesis (e.g., "Compare the top 5 project management tools"), the agent delegates to the Deep Thought Engine.

Kimi k2.5 is chosen because:
1. **Native agent swarm** — Kimi can spawn internal sub-agents that browse the web independently.
2. **Large context** — 128K context window handles extensive research.
3. **Available via OpenRouter** — single API key, unified billing.

---

## Design

### Flow

```
Reflex Engine (Cerebras)
    │
    │ LLM outputs: activate_swarm({ task: "...", urls: [...] })
    │
    ▼
Agent Loop (background.ts)
    │
    │ 1. Set status: WAITING_FOR_SWARM
    │ 2. Build swarm prompt
    │ 3. Call OpenRouter API (Kimi k2.5)
    │ 4. Stream response
    │ 5. Parse final report
    │ 6. Set status: THINKING
    │ 7. Feed report as tool result to Cerebras
    │
    ▼
Reflex Engine (Cerebras)
    │
    │ Processes report, responds to user
```

### File: `src/background/swarm.ts`

Single file, ~150 lines.

---

## Implementation Details

### OpenRouter Client Setup

```typescript
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KIMI_MODEL = "moonshotai/kimi-k2.5";

interface SwarmRequest {
  task: string;
  urls?: string[];
}

async function callKimiSwarm(args: ActivateSwarmArgs): Promise<string> {
  const apiKey = await getApiKey("openRouter");

  if (!apiKey) {
    return "Error: OpenRouter API key not configured. Please add it in Settings.";
  }

  const systemPrompt = buildSwarmSystemPrompt(args);
  const userPrompt = buildSwarmUserPrompt(args);

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "chrome-extension://qsidebar",
      "X-Title": "QSidebar",
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.3,
      stream: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body}`);
  }

  // Parse SSE stream — same format as Cerebras (OpenAI-compatible)
  const result = await parseSSEStream(response.body!, (delta) => {
    // Forward stream chunks to side panel for transparency
    chrome.runtime.sendMessage({
      type: "STREAM_CHUNK",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { delta, done: false },
    });
  });

  return result.content ?? "Swarm returned no results.";
}
```

### Swarm System Prompt

```typescript
function buildSwarmSystemPrompt(args: ActivateSwarmArgs): string {
  return `You are a research agent. Your job is to thoroughly investigate a topic and produce a comprehensive, well-structured report.

## Instructions
1. Analyze the user's research task carefully.
2. If URLs are provided, incorporate information from those sources.
3. Use your browsing capabilities to find additional relevant information.
4. Synthesize all findings into a clear, structured report.
5. Include specific facts, data points, and comparisons where relevant.
6. Cite sources when possible.

## Output Format
Produce a report with:
- **Summary**: 2-3 sentence overview
- **Key Findings**: Numbered list of main discoveries
- **Details**: In-depth analysis organized by subtopic
- **Conclusion**: Actionable recommendations or takeaways

Keep the total response under 3000 words.`;
}
```

### Swarm User Prompt

```typescript
function buildSwarmUserPrompt(args: ActivateSwarmArgs): string {
  let prompt = `Research task: ${args.task}`;

  if (args.urls && args.urls.length > 0) {
    prompt += `\n\nRelevant URLs to investigate:\n${args.urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
  }

  return prompt;
}
```

### Timeout & Retry Strategy

```typescript
const SWARM_TIMEOUT_MS = 120_000; // 2 minutes
const SWARM_MAX_RETRIES = 1;

async function callKimiSwarmWithRetry(args: ActivateSwarmArgs): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= SWARM_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SWARM_TIMEOUT_MS);

      const result = await callKimiSwarmInternal(args, controller.signal);
      clearTimeout(timeoutId);
      return result;

    } catch (err) {
      lastError = err as Error;

      if ((err as Error).name === "AbortError") {
        // Timeout — retry once
        if (attempt < SWARM_MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        return `Swarm timed out after ${SWARM_TIMEOUT_MS / 1000}s. The research task may be too complex. Try breaking it into smaller questions.`;
      }

      // API error — retry on 5xx
      const message = (err as Error).message;
      if (message.includes("5") && attempt < SWARM_MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      return `Swarm error: ${message}`;
    }
  }

  return `Swarm failed after ${SWARM_MAX_RETRIES + 1} attempts: ${lastError?.message}`;
}
```

### Response Parsing

The swarm response is plain text (Kimi's report). No special parsing is needed — the raw text is returned as the tool result and fed back to Cerebras.

```typescript
// The tool result is simply the text content from Kimi
state.messages.push({
  role: "tool",
  tool_call_id: toolCall.id,
  content: report, // Plain text from Kimi
});
```

If the report exceeds 8000 characters, it is truncated to prevent context window overflow in the Reflex Engine:

```typescript
function truncateReport(report: string, maxChars = 8000): string {
  if (report.length <= maxChars) return report;
  return report.slice(0, maxChars) + "\n\n[Report truncated — original was " + report.length + " characters]";
}
```

---

## Error Handling

| Error | Response |
|---|---|
| Missing API key | Return error string as tool result: "OpenRouter API key not configured" |
| 401 Unauthorized | Return: "Invalid OpenRouter API key. Check Settings." |
| 429 Rate Limited | Wait 5s, retry once, then return error |
| 500+ Server Error | Wait 2s, retry once, then return error |
| Timeout (120s) | Return: "Swarm timed out. Try a simpler task." |
| Empty response | Return: "Swarm returned no results." |
| Network error | Return: "Network error. Check your connection." |

All errors are returned as tool result strings, NOT thrown. This lets the Reflex Engine (Cerebras) decide how to communicate the failure to the user.

---

## File Paths

| File | Purpose |
|---|---|
| `src/background/swarm.ts` | OpenRouter client, swarm prompts, retry logic |
| `src/background/background.ts` | Calls `callKimiSwarm()` from the agent loop |
| `src/types/index.ts` | `ActivateSwarmArgs` type |

---

## Testing

- `tests/background/swarm.test.ts` — mock fetch, test prompt construction, timeout handling, retry logic, response truncation
- Manual testing: trigger `activate_swarm` with a research query and verify the report quality

---

## Open Questions

None — all decisions are final.
