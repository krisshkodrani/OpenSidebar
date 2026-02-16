# RFC: Sidepanel UX Overhaul for Multi-Agent Orchestration

## Status
Proposed

## Owner
OpenSidebar core

## Context
OpenSidebar has strong orchestration internals (planner/executor/verifier, retry policy, handoffs, budgets, approval policy), but the sidepanel still presents most activity as chat-first output. This creates a mismatch:

- system behavior is graph/task-oriented
- user surface is linear conversation-oriented

The result is weak operator awareness during long or risky runs.

## Goal
Redesign the sidepanel to make autonomous execution legible, controllable, and auditable without removing chat convenience.

## Non-goals
- Replacing current orchestration logic
- Introducing new backend protocol types before UI integration
- Full visual redesign of every component in one release

## Design Principles
1. Task-first, chat-second.
2. Role visibility: planner/executor/verifier always visible.
3. Safety visibility: approval mode and risk posture always visible.
4. Evidence over narration: show what changed and what was verified.
5. Progressive disclosure: simple by default, deep diagnostics on demand.

## Proposed Information Architecture
Three persistent zones in the sidepanel:

1. Intent
- user objective
- constraints (budget, risk mode, approvals)
- success criteria (what counts as done)

2. Execution
- orchestrator console (current node, role activity, retries, reroutes, handoffs)
- step timeline tied to nodes, not only chat bubbles

3. Evidence
- verifier results (confidence, failure type, rationale)
- artifacts (screenshots, tool outcomes, memory writes)
- unresolved assumptions/drift signals

## Component Plan

### A. Header Layer (always visible)
Keep `StatusBar` and add:

- `ArchitectureStrip` (already added)
  - Planner lane
  - Executor lane
  - Verifier lane
  - Policy lane

- `PolicyPill`
  - `Guarded` | `Bypass ON` | `Awaiting approval`
  - click opens policy drawer

### B. Orchestrator Console (new primary panel)
New component: `OrchestratorConsole`

Sections:
- `Current Node`
  - node id
  - objective
  - retries used / budget
  - role currently active
- `Dependency State`
  - dependency satisfied/blocked indicators
- `Recent Decisions`
  - verifier decisions
  - retry policy decisions
  - reroute node creation

Data mapping from existing messages/state:
- `TASK_PROGRESS` -> active node/subtask list
- `AGENT_STEP` -> step events
- `AGENT_STATUS` -> role activity inference
- orchestrator reason strings from streamed messages / step labels

### C. Plan & Checkpoints Panel
New component: `PlanBoard`

Each plan item:
- status: planned/running/verified/blocked/rerouted
- evidence count
- last update time
- “resume from here” action (future interactive control)

Data mapping:
- existing `TASK_PROGRESS` + `TASK_COMPLETION`
- checkpoint metadata from task recovery messages

### D. Evidence Panel
New component: `EvidencePanel`

Tabs:
- `Verified`
- `Assumptions`
- `Failures`
- `Artifacts` (screenshots, key tool outputs, memory ops)

Data mapping:
- `AGENT_STEP` entries (including approval steps)
- verifier metadata (confidence/failureType)
- screenshot step artifacts

### E. Approval UX (in progress, expand)
Current `ApprovalBanner` now includes countdown + result feedback.
Next:
- inline “why this action” explanation (tool + context + impact)
- optional one-click policy exception: allow once / always this run

## UX Flows

### 1) Normal autonomous run
1. User submits intent.
2. Console shows planner decomposition.
3. Executor lane activates per node.
4. Verifier emits accept/retry/reroute with confidence.
5. Completion report links evidence to each node.

### 2) High-risk step requiring approval
1. Policy lane changes to `Awaiting approval`.
2. Approval panel shows countdown + action context.
3. User approves/rejects.
4. Step timeline records decision outcome.

### 3) Drift/replan
1. Drift warning appears in Execution + Evidence.
2. Node marked `blocked` or `rerouted`.
3. New node appears with handoff marker.

## Visual Language
- Planner: sky
- Executor: emerald
- Verifier: violet
- Policy: amber

Rules:
- color indicates responsibility, not severity
- severity uses iconography and status styling
- use stable type scale for dense operational data

## Progressive Disclosure Levels
1. Basic: only current status + chat + simple approvals.
2. Advanced: console + plan board + evidence summary.
3. Debug: raw tactical logs, retry policy details, model/provider switches.

## Phased Implementation

### Phase 1 (now)
- Architecture strip (done)
- Approval banner countdown/outcomes (done)
- Keep compatibility with existing store and message bridge

### Phase 2
- Implement `OrchestratorConsole` (read-only)
- Reuse existing `TASK_PROGRESS`, `AGENT_STEP`, `AGENT_STATUS`
- Add compact decision feed

### Phase 3
- Implement `PlanBoard` + checkpoint visibility
- Add richer completion/evidence linking

### Phase 4
- Add user controls:
  - resume node
  - skip node
  - replan node
  - temporary policy exceptions

## Telemetry and Debugging Requirements
Must log and surface:
- role transitions
- approval lifecycle
- retry policy decisions
- verifier decisions (confidence/failureType)
- reroute and drift events

## Acceptance Criteria
1. User can identify current role and node in < 2 seconds.
2. User can identify why a step is blocked/retried/rerouted.
3. User can see approval mode and latest approval outcome at all times during high-risk flow.
4. Completion view links claims to evidence and verifier status.

## Risks
- Higher information density can overwhelm novice users.
- Role inference from current message set can be imperfect before explicit role events are emitted.

Mitigation:
- progressive disclosure
- fallback heuristics
- explicit role event protocol in later phase

## Open Questions
1. Should plan editing be enabled before run start or only after initial decomposition? After initial decomposition
2. Should bypass policy be globally sticky or scoped per run by default? Scoped by run
3. Do we expose raw verifier rationale text by default, or behind an expand action? Your reccomandation

