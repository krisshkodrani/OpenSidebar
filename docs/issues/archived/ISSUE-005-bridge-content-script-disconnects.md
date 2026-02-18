# ISSUE-005: Bridge/Content-Script Disconnects Cause Action Failures

Severity: High
Status: Open
Date identified: 2026-02-17
Updated: 2026-02-17 (corrected failure count from logs)
Area: Tool bridge messaging, tab/content-script readiness, workspace transitions

## Summary

The tool bridge intermittently fails with `Receiving end does not exist`, causing tool execution failures and retry cascades. No auto-reinject mechanism exists for content scripts that unload during long sessions.

## Evidence

- `logs/opensidebar.jsonl`:
  - `Bridge execution failed`: **36** (corrected from initial count of 12 — full log grep shows 36 distinct failures)
  - Repeated error: `Could not establish connection. Receiving end does not exist.`
  - `dismiss_overlays` error with missing tab ID in same time windows
- Failures cluster during:
  - Session transitions and tab focus changes
  - Heavy action loops (rapid tool dispatch sequences)
  - After long idle periods where the service worker may have cycled
- No content script re-injection was observed after any disconnect — once the bridge breaks, it stays broken until the page is manually reloaded

## User-visible impact

- Actions fail unexpectedly mid-task.
- Agent enters recovery loops or stalls.
- Increases derailment risk during long challenge runs.
- 36 wasted turns across sessions where the agent couldn't reach the page.

## Root cause hypothesis

1. **Content script unloads during long sessions.** Chrome may garbage-collect content scripts on inactive tabs or after service worker restarts. No mechanism exists to detect this and re-inject.
2. **Tool dispatch races against tab state.** `chrome.tabs.sendMessage` is called before the content script has finished initializing after a navigation.
3. **No retry with re-injection.** On bridge failure, the code retries the same `sendMessage` — but if the content script is gone, retries will always fail. Need to re-inject first.

## Recommended fix direction

1. **Add content-script health probe.** Before dispatching tools, send a lightweight ping and wait for pong. If no response within 500ms, re-inject the content script.
2. **Auto-reinject on bridge failure.** On `Receiving end does not exist`, call `chrome.scripting.executeScript()` to re-inject the content script, wait for ready signal, then retry.
3. **Distinguish failure types.** Classify errors as: (a) tab doesn't exist → abort, (b) content script not ready → re-inject + retry, (c) transient → bounded retry with jitter.
4. **Add dedicated trace event** for bridge readiness failures.

## Acceptance criteria

1. Bridge failures reduce to < 5 per long benchmark session (down from 36).
2. Transient disconnects auto-recover via re-injection without user-visible stalls.
3. Tool failure logs clearly classify root cause (readiness vs tab gone vs permission).
