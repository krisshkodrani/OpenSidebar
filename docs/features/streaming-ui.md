# Streaming UI

OpenSidebar streams model output into the side panel in real time.

## What Users See

- partial assistant text as it arrives
- tool execution indicators
- current agent status
- plan and approval state changes
- final summaries with token and cost metadata when available

## Current Model Routing

- executor turns default to `openai/gpt-4.1-mini`
- planner turns default to `minimax/minimax-m2.5`
- runtime can temporarily fall back to `google/gemini-2.5-flash-lite`

## Technical Flow

```text
OpenRouter stream -> service worker SSE parser -> side panel store -> React UI
```

The service worker accumulates text deltas and tool calls, then emits structured updates to the side panel.

## Controls

- stop current task
- pause and resume
- approve or reject risky steps
- send follow-up guidance while the task is active
