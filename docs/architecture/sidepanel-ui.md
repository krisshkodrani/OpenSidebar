# Side Panel UI

The side panel is OpenSidebar's user-facing interface built with React 18,
TypeScript, Zustand + Immer, and Tailwind CSS. It provides the chat surface,
real-time streaming, task/plan status, approvals and escalations, watch mode,
website skills, personal profile, and settings.

## Architecture

**Location:** `apps/extension/src/sidepanel/`

- `App.tsx` — main component; composes the render tree and delegates behavior
  to hooks (`useSidepanelBootstrap`, `useWorkspaceSync`, `useSidepanelBridge`,
  `useComposerActions`, `useTranscriptAutoScroll`, `useTaskUiState`)
- `store.ts` — slice combiner only; state lives in eight slices under
  `store/` (`chat`, `agent`, `settings`, `saved-prompts`, `website-skills`,
  `personal-profile`, `ui`, `passive-monitor`; types in `store/types.ts`)
- `runtime.ts` — the `UiRuntimePort` contract plus the Chrome-backed
  production adapter (`chromeUiRuntimePort`)
- `bridge.ts` — centralized message router: subscribes to
  `uiRuntime.subscribeMessages()`, filters `source === BACKGROUND`, and maps
  every `RuntimeMessage` to store actions
- `components/` — see the render tree below; `components/index.ts` is the
  authoritative export list

## Render tree

`App.tsx` mounts (see the source for the exact conditions):

```
App
├── Header
├── SettingsDrawer | PersonalProfileDrawer | SavedPromptsDrawer | WebsiteSkillsDrawer  (conditional)
├── TaskStatusRegion          (plan/run status; includes PlanStrip, RunCard)
├── PrimaryTaskRail / StepTimeline surfaces
├── MessageBubble[]           (chat transcript)
├── ApprovalOverlay | EscalationOverlay | ClarificationOverlay   (blocking interactions)
├── StalledRecoveryCard       (stagnation recovery)
├── WatchModeControl          (idle composer only)
├── InputArea                 (Send / amber Send Feedback / Stop)
└── TaskActivityHud           (React portal; also used by the overlay host)
```

Notable: approvals/escalations are **overlays**, not banners; plan state is
surfaced via `PlanStrip` + `TaskStatusRegion` (there is no
OrchestratorConsole/PlanBoard). Pause/resume/stop controls live in the primary
task rail.

## State

`SidePanelState` is composed from the slices (`store/types.ts`). Beyond chat,
status, settings, metrics, and task progress, it carries the pending
interaction state (`pendingApproval`, `pendingEscalation`,
`pendingPlanConfirmation`, `pendingClarification`), `taskRecovery`,
`durableRunStatus`, `laneTelemetry`, `latestStepLabel`, personal-profile and
website-skills state, and the passive-monitor group. Stream chunks are
applied in a single store transaction (`applyStreamChunk`), not a
delta/finalize pair.

## Runtime boundary

The React app is shared by two hosts:

- Chrome side panel (production), backed by `chromeUiRuntimePort`
- In-page overlay harness, backed by an in-memory `UiRuntimePort`
  (entry: `src/overlay/index.tsx`; `App` accepts `themeRoot` /
  `activityHudRoot` props so theming and the HUD portal work in both hosts)

Shared components and hooks must use `uiRuntime` from `runtime.ts` for
messaging, tab/window lookup, permissions, and storage. Direct `chrome.*`
access belongs only in `runtime.ts` / production shell code. Tests swap the
port via `setUiRuntimePortForTesting(createOverlayUiRuntimeHarness(...).port)`.

## Message flow

- **Outgoing**: `useComposerActions` builds `USER_CHAT` (with optional
  `isFeedback`) and sends through the runtime port; while the agent runs, the
  input stays enabled in amber feedback mode.
- **Incoming**: `bridge.ts` routes everything — status/stream/response,
  task progress and completion, session metrics, step labels, stagnation,
  approval/escalation/plan-confirmation/clarification requests, watch-mode
  status and suggestions (with dedupe), skill-recording status, and
  `USER_SKILL_*` responses.

Message payload shapes live in `packages/shared-types/src/messages/` — see
[Message Protocol](./message-protocol.md); this doc intentionally doesn't
mirror them.

## Feature surfaces

- **Watch mode** — `WatchModeControl` + `passive-monitor-slice`; passive
  suggestions render as non-blocking messages.
- **Website skills** — one header entry opens `WebsiteSkillsDrawer`; recording
  starts from that drawer via `useSkillRecordingActions`. An active-site-skill
  chip appears above the transcript.
- **Saved prompts and personal profile** — contextual composer actions open
  `SavedPromptsDrawer` and `PersonalProfileDrawer`.
- **Presence (LP-24)** — the visible agent cursor on the page is configured
  here: "Presence cursor" selector in settings (`PRESENCE_MODE_OPTIONS`).
- **Settings** — `SettingsDrawer` is split into **General** and **Models**
  tabs (`components/settings/`). General keeps theme, execution mode, site
  access, and notifications visible; runtime tuning, presence cursor, skill
  packs, and diagnostics are grouped under Advanced settings. Models covers
  release providers, credentials, and optional per-seat model selection.

## Dark mode

Tailwind `dark:` classes, driven by `settings.theme`
(light/dark/system + `prefers-color-scheme`), applied to the theme root —
`document.documentElement` in the side panel, the `themeRoot` prop in the
overlay host.

## Testing

`apps/extension/tests/sidepanel/` — store, app rendering, bridge routing, and
the RFC-012 boundary test (`rfc012-boundary.test.ts`) that enforces the
no-`chrome.*` rule. Overlay parity is covered in `tests/overlay/`.

## Key implementation notes

1. Use the runtime port — UI components never touch `chrome.*`.
2. Filter incoming messages by `source === MessageSource.BACKGROUND`.
3. Keep message→store mapping in `bridge.ts`, not in components.
4. Add the user message and streaming assistant placeholder optimistically
   before sending.

## See also

- [Runtime Boundaries](./runtime-boundaries.md)
- [Message Protocol](./message-protocol.md)
- [Agent Loop](./agent-loop.md)
- [Project Setup](./project-setup.md)
