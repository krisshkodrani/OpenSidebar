# Streaming UI

OpenSidebar streams model output into the side panel in real time.

## What Users See

- partial assistant text as it arrives
- tool execution indicators
- current agent status
- plan and approval state changes
- final summaries with token and cost metadata when available

## Current Model Routing

- executor turns default to `accounts/fireworks/routers/kimi-k2p5-turbo`
- planner turns default to `accounts/fireworks/routers/kimi-k2p5-turbo`
- runtime can temporarily fall back to the configured executor fallback model

## Technical Flow

```text
provider stream -> service worker stream parser -> side panel store -> React UI
```

The service worker accumulates text deltas and tool calls, then emits structured updates to the side panel.

## Controls

- stop current task
- pause and resume
- approve or reject risky steps
- send follow-up guidance while the task is active
