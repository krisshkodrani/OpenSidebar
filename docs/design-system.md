# Design System

OpenSidebar uses an Azure-inspired product palette: neutral work surfaces, clear blue trust/action colors, and teal only for live agent activity.

This page is the stable repo record for implemented design decisions. Long-form color research belongs in Notion.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| `brand.surface` | `#F8FAFC` | App canvas and quiet backgrounds |
| `brand.panel` | `#FFFFFF` | Cards, panels, input surfaces |
| `brand.text` | `#0F172A` | Primary text |
| `brand.muted` | `#475569` | Secondary text |
| `brand.subtle` | `#334155` | Strong secondary labels and dark UI accents |
| `brand.accent` | `#2563EB` | Primary actions, active navigation, key links |
| `brand.accent-strong` | `#1D4ED8` | Hovered or pressed primary actions |
| `brand.live` | `#14B8A6` | Agent running, streaming, live orchestration |
| `brand.live-soft` | `#99F6E4` | Soft live backgrounds and glows |
| `state.success` | `#15803D` | Completed states and positive confirmation |
| `state.warning` | `#D97706` | Attention, feedback mode, recoverable risk |
| `state.error` | `#DC2626` | Errors, blocked state, destructive risk |
| `state.info` | `#2563EB` | Informational state |

## Usage Rules

- Use blue for user action, selection, trust, and primary product identity.
- Use teal for live agent behavior only: running, streaming, processing, orchestration activity.
- Use amber for user attention or feedback mode, not as a general accent.
- Use red only for errors, blockers, destructive actions, or hard failure states.
- Keep surfaces neutral. The product should feel like a workbench, not a campaign page.
- Prefer semantic tokens over raw hex values in UI code.

## Focus Treatment

Interactive controls should use the wider two-layer focus treatment:

| Mode | Shadow |
| --- | --- |
| Light | `0 0 0 2px #ffffff, 0 0 0 5px rgba(37, 99, 235, 0.22)` |
| Dark | `0 0 0 2px #0f172a, 0 0 0 5px rgba(96, 165, 250, 0.28)` |

This makes keyboard and active-composer focus visible without turning the whole surface blue.

## Implementation

- Tailwind tokens live in `tailwind.config.cjs`.
- Side panel global styles live in `apps/extension/src/sidepanel/index.css`.
- Trace viewer global styles live in `apps/extension/src/trace-viewer/index.css`.
- The main composer focus glow is applied through `.input-glow`.


## Cloud workspace

The Cloud web app uses the same compact work-tool principles as aifindme.work,
while retaining OpenSidebar's blue identity and Nunito Sans typography. Its shared
shell, tokens, responsive navigation, and local light/dark preference live in
`apps/sandbox/src/app/`. Icons accompany meaningful labels; status never depends
on color alone. The website appearance preference is separate from synced
extension preferences.

All workspace routes use `/app`: overview, `/app/sessions`, `/app/playground`,
`/app/viewer`, and `/app/settings`. Settings have General, Connections, Providers,
and Security routes. `/app/sign-in` preserves an allowlisted return destination.
Legacy dashboard, account, settings, sessions, viewer, and playground bookmarks
normalize through `routes.ts`, preserving other query parameters and fragments.
Cloud pages require a verified browser session; the operator activation page
remains at `/app/internal/activation` with its existing server authorization.

Keep results stable with explicit Refresh. Distinguish loading, failed requests,
empty data, and unavailable capabilities. Sessions open in a modal drawer without
resizing their list. Dirty settings warn before navigation or logout; successful
logout clears the private query cache. Account actions retain CSRF and revision
checks. Browser pairing codes and provider drafts remain transient.

The static workspace is deployed on the shared host; the historical CloudFront
sandbox deployment script is not the production release path. Publish an isolated
build against the deployed runtime contracts, retain hashed assets for open tabs,
and replace the control HTML only after browser checks. This visual release does
not enable additional Cloud scenarios or background processing.

The 2026-10-07 Cloud workspace release is deployed as
`opensidebar-workspace-20261007-r1`. Local evidence lives in
`.artifacts/cloud-workspace/2026-10-07/`: 14 fixture-driven browser checks, four
route tests, type checking, repository verification, accessibility results,
screenshots, live anonymous route/asset checks, and rollback/backup identity.
Signed-in behavior was checked with fictional local fixtures; the user's fresh
branded-email check remains deferred. The deployed Cloud playground currently
supports Restock Alert; other catalog entries explicitly show “Not enabled”.

The login gate is a standalone surface (`AuthFrame`) with original SVG browser
artwork, a compact mobile illustration, and light/dark appearance. Workspace
navigation mounts only after session verification, including unknown workspace
URLs. Session loading and errors use a neutral branded `SessionFrame`, without the
sign-in illustration or private navigation. The login frame appears only after
the session is confirmed unauthenticated. Signed-in users
visiting sign-in return to an allowlisted workspace destination; successful
verification uses a full-page replacement to that destination. Evidence for the
2026-10-07 follow-up is under `.artifacts/cloud-login/2026-10-07/`.

## Extension task feedback

The sidepanel uses one task card with a readable goal, current activity, last
completed action when available, and labeled Pause/Resume/Stop controls. Keep
execution budgets, provider names, and optional token/cost metrics inside Run
details. The plan is collapsed during execution; show completed-step counts
rather than interpreting turn budgets as task progress. Plan confirmation opens
the steps because it requires a decision. Completed and partial outcomes remain
visible until a new task or workspace replaces them.

Connection health is distinct from task state. A disconnected runtime port puts
the panel in Reconnecting and preserves the last task state and pending gates.
An authoritative agent status or task completion reconciles it. Reconnecting,
page waits, pauses, and user decisions do not animate as active work. Verification
copy requires an explicit verifying worker status. Last-task-update age reflects
accepted task events, not connectivity heartbeats; a completed action does not
claim the entire user objective has been verified.

Use one restrained working indicator, opaque neutral card surfaces, and wrapped
14px primary status text. Use amber for decisions and recovery, with red reserved
for failures and high-risk approval actions. Approval buttons name the proposed
action; failed decision delivery retains the prompt so the user can retry.
