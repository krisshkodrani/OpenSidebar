# OpenSidebar — Shared Types Orientation

> The **source of truth for all shared types is the code**, not this page:
> `packages/shared-types/src/`. The modules there carry richer JSDoc than any
> mirrored catalog could. An earlier revision of this file hand-mirrored every
> interface and drifted badly (missing ~40 message variants and ~20 tools); per
> the [docs policy](../docs-policy.md) it was replaced with this orientation
> page, which describes only the stable layout and conventions.

## Package layout

Everything is re-exported from the barrel `packages/shared-types/src/index.ts`.

| Module | Contents |
| --- | --- |
| `enums.ts` | `AgentStatus`, `MessageSource` (incl. `UI` for the overlay harness), `ToolName` (52 tools), `RiskLevel`, `ScrollDirection` |
| `messages.ts` + `messages/` | `RuntimeMessage` — a union of seven per-domain sub-unions (65 variants); see below |
| `agent.ts` | Agent-loop contracts: `ChatMessage` family, `ToolCall`, `AgentLoopState`, `AgentStep`, `SidePanelState`, the `Pending*` sidepanel-store types, `Citation` |
| `tools.ts` | `ToolDefinition`, `JsonSchema`, per-tool `*Args` types, `ToolRouter`/`ToolArgsMap`, `ToolExecutionResult`, `EvidenceEvent`, form-state capture types |
| `dom.ts` | `DomSnapshot`, `TaggedElement`, `ElementRect`, `PageSkeletonNode` |
| `progress.ts` | `SubtaskSummary`, `SessionMetrics`, `PartialProgressHandoff`, lane telemetry |
| `settings.ts` | `UserSettings`, `Workspace`, `NavigationState`, `Result<T,E>` |
| `traces.ts` | `TraceEntry`, `TraceSession`, `TraceEvent` (a discriminated union of ~18 typed event kinds plus a generic fallback) |
| `browser-bridge.ts` | Browser-bridge contracts |

## The message union

`RuntimeMessage` is composed of seven domain sub-unions, one module each under
`packages/shared-types/src/messages/`:

- **session** — chat lifecycle and session control (`USER_CHAT`, `AGENT_RESPONSE`, `STREAM_CHUNK`, …)
- **progress** — service-worker → UI progress reporting (`TASK_PROGRESS`, `SESSION_METRICS`, …)
- **interaction** — user-blocking request/response pairs (approvals, escalation, plan confirmation, clarification)
- **content-protocol** — service worker ↔ content script (`DOM_SNAPSHOT_REQUEST`, `TOOL_EXECUTE`, presence suspend/resume, …)
- **skills** — website-skill recording and CRUD
- **watch-mode** — passive monitoring
- **e2e** — test-only hooks

Conventions:

- **Add a new message to its domain module, never the barrel.** Domain-scoped
  consumers should type against the sub-union (e.g. `ContentProtocolMessage`),
  not `RuntimeMessage`.
- Every message extends `BaseMessage` (`messages/base.ts`): `type`,
  `requestId`, `source`, `payload`, discriminated on the `type` string literal.
- UI-originated messages use `UiMessageSource` (`SIDEPANEL | UI`) so the same
  payloads work from the production sidepanel and the overlay harness.
- The offscreen `TAB_AUDIO_*` protocol is intentionally excluded from the
  union (see the note at the top of `messages.ts`).

## Related conventions

- Tool param names must match across three layers: the `ToolDefinition`
  schema, the TypeScript args type in `tools.ts`, and the implementation in
  `apps/extension/src/content/actions/`. Use `id` (integer) for element tag
  IDs — never `tag`.
- Trajectory/trace entries must be environment-agnostic (no `tabId` or
  `chrome.storage` keys) so they replay identically across adapters.

## See also

- [Message Protocol](./message-protocol.md) — transports, request-ID
  correlation, sequence diagrams, and the per-domain message catalog.
- [Tools](./tools.md) — the tool registry and metadata system.
