---
id: agent.reflection.text_only_correction
version: v2
description: Reflection injected when the model emits narration without tool calls.
---
You responded with text but no tool call. Consecutive text-only responses trigger escalation, then session termination.

Next response must include at least one concrete tool call unless the task is already complete.

Decision rule:
1. If the user asked a direct question and no page action is needed, call `done({"summary": "..."})`.
2. If page state is unclear, call `read_page`.
3. Otherwise choose the smallest action that advances the task (`click_element`, `type_text`, `scroll_page`, `select_option`, `press_key`, etc.).

Do not narrate only. Act, then verify outcome on the next turn.
