# Speed Mode

Speed mode is a throughput-optimized operating mode for OpenSidebar that trades conversational flexibility for faster task completion. It uses a tool-only system prompt, parallel tool execution, and aggressive context compression to minimize latency and token usage.

## How to Enable

Open the **Settings** drawer in the side panel and toggle **Speed Mode** on. The toggle persists across sessions via `UserSettings.speedMode`.

## Normal Mode vs Speed Mode

| Feature | Normal Mode | Speed Mode |
|---------|-------------|------------|
| LLM model | Cerebras (gpt-oss-120b) | Cerebras → escalates to Gemini 3 Flash |
| System prompt | Conversational, allows text replies | Tool-only — text replies trigger nudges |
| Tool set | 21 tools (full) | 14 tools (excludes swarm, memory, wait, tab mgmt) |
| Tool execution | Sequential | Parallel (unless navigate/done present) |
| Streaming | Token-by-token deltas to side panel | No-op stream callback (batched) |
| Output token cap | 4096 | 2048 |
| Viewport text | Up to 5000 chars (varies by compression) | Truncated to 1500 chars |
| SPA wait after DOM action | 200ms | 50ms |
| Workspace check | Per-tool | Skipped |
| Agent activity border | Sent to content script | Skipped |
| Text-only response | Stops loop (final answer) | Nudge → escalate → give up |
| Modal auto-dismiss | Off | Runs before first LLM turn |
| History compression | preserveRecent=2, truncation at 150 chars | preserveRecent=1, truncation at 80 chars |

### Excluded Tools in Speed Mode

The following 7 tools are filtered out to reduce prompt size and prevent slow operations:

- `activate_swarm` — external research delegation (high latency)
- `memory_add` / `memory_search` — long-term memory (unnecessary for speed tasks)
- `wait` — explicit delays (counterproductive)
- `create_tab` / `close_tab` / `switch_tab` — tab management (single-tab focus)

The remaining 14 tools cover all DOM interaction, navigation, screenshots, and task completion.

## Model Escalation

When the LLM emits plain text instead of tool calls (which violates the speed-mode system prompt), the agent nudges it to retry. If the LLM continues to emit text, the agent escalates to a smarter model:

### Escalation Flow

1. **Nudge 1** — Refresh DOM snapshot, inject nudge message, continue loop
2. **Nudge 2** — Escalation gate: replace `LLMClient` with Gemini 3 Flash (`google/gemini-3-flash-preview`) via OpenRouter. Reset nudge counter. An "info" step appears in the side panel: *"Switching to smarter model"*
3. **Post-escalation nudges** — If the escalated model also emits text 3 times consecutively, the agent gives up and shows the last text response

### Requirements

- **OpenRouter API key** must be configured in Settings. Without it, escalation is skipped and the agent falls back to the standard nudge/give-up logic.
- Conversation history is preserved across the escalation — the new model picks up exactly where Cerebras left off.

## Recommended Settings

| Setting | Recommended Value |
|---------|-------------------|
| Speed Mode | ON |
| Max Turns | 500 |
| Show Element Tags | OFF (reduces visual clutter) |

Higher max turns are recommended because speed mode tasks (especially multi-page SPAs) can require many turns within a single session.

## Key Files

| File | Purpose |
|------|---------|
| `src/background/agent/loop.ts` | Speed mode branching: parallel execution, nudge handler, model escalation |
| `src/background/agent/context.ts` | `SPEED_PROMPT_TEMPLATE`, speed-mode compression settings |
| `src/background/tools/registry.ts` | `SPEED_MODE_EXCLUDED_TOOLS` set, `getDefinitions(exclude?)` |
| `src/background/llm/client.ts` | `LLMClient` — replaced on escalation |
| `src/background/vision.ts` | `describeScreenshot()` — vision bridge for `take_screenshot` |
| `src/content/content.ts` | `autoDismissModals()` — pre-agent modal cleanup |
| `src/sidepanel/components/SettingsDrawer.tsx` | Speed Mode toggle UI |

## See Also

- [Browser Automation](./browser-automation.md) — Tool capabilities
- [Agent Loop Architecture](../architecture/agent-loop.md) — Loop internals
