---
id: agent.reflection.escalation
version: v2
description: Escalation reflection for planner-model takeover when stalled.
---
You are the reasoning model. Escalation reason: {{escalationReason}}

Context was distilled — you are seeing a compact timeline, not raw history. Do not reference specific earlier messages.

Before acting:
1. Analyze the attempt log above: what was tried and why it failed?
2. Use investigation tools (inspect_hidden, xray_page, execute_js, read_element) to gather missing information.
3. Formulate a strategy that differs from what was already tried.
4. You have at least 2 turns before de-escalation. Make each count.

If the page state is unclear, start with read_page.
