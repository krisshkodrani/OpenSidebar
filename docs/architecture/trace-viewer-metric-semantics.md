# Trace Viewer Metric Semantics

Date: 2026-05-30

This dictionary pins the meaning of trace-viewer investigation metrics. A code
change that changes one of these definitions should update this document and the
matching unit tests in `apps/extension/tests/trace-viewer/analysis.test.ts`.

## Investigation Summary Metrics

- `productiveTurns`: turns with at least one successful tool execution, or turns
  where the assistant produced a text response without tool calls or tool
  executions.
- `toolFailureTurns`: turns with at least one tool execution whose `success`
  field is `false`.
- `perceptionTurns`: turns with a `perception` object.
- `degradedPerceptionTurns`: perception turns where mode is `element_only`,
  source is `fallback`, a `fallbackReason` is present, or screenshot status is
  `missing`, `capture_failed`, `pruned`, or `load_failed`.
- `contextHotTurns`: turns where LLM context utilization is at least `0.85`, or
  where `droppedMessageCount` is greater than zero.

## Repeat Action Metrics

Loop findings come from `findRepeatedActionPatterns`:

- Window: compare each turn to the previous 5 turns by default.
- Snapshot equality: same URL, title, and element count.
- Exact repeat: same tool-name sequence and same normalized arguments.
- Near repeat: same tool-name sequence and same arguments after volatile element
  IDs are normalized.
- Default cap: return at most 3 repeat findings per analysis.
