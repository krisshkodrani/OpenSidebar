# Trace Viewer And Lab Roadmap

Date: 2026-04-21

Scope: Product roadmap for the trace viewer and the lab as complementary surfaces in OpenSidebar

## Product Thesis

OpenSidebar now has two valid trace-adjacent products:

- the **Trace Viewer** for operational debugging and session replay
- the **Lab** for cross-session retrieval, research, and reusable memory

The right direction is not to merge them into one oversized tool.

The right direction is to make their roles explicit and build a strong bridge between them.

Working product framing:

- **Viewer = microscope**
- **Lab = analyst + memory**

## Problem

Today the split is technically sound but not product-legible.

The viewer is strong at:

- raw session browsing
- turn-by-turn debugging
- screenshots and perception review
- run/session comparison
- quick operational triage

The lab is now strong at:

- indexed trace retrieval
- similar-failure search
- pathology summaries
- durable knowledge capture
- Hermes-accessible trace evidence

But the user experience still has three problems:

1. the viewer does not naturally hand off to the lab when the question becomes analytical
2. the lab does not naturally point back to raw evidence when screenshots and full replay matter
3. the viewer is trying to serve too many audiences at once, which dilutes its primary job

## Product Roles

### Trace Viewer

Primary role:

- operational observability for agent runs and sessions

Jobs to be done:

- inspect what happened in a specific session
- understand what the agent saw, said, and did
- spot regressions in recent runs
- compare runs or sessions
- triage failures quickly enough to decide the next action

The viewer should optimize for:

- fast failure triage
- deep raw evidence
- confidence in session-level diagnosis

The viewer should not be the primary place for:

- long-form research
- durable knowledge synthesis
- cross-session evidence preservation

### Lab

Primary role:

- research, synthesis, and reusable memory for trace-driven improvement

Jobs to be done:

- answer questions across many traces
- identify recurring pathologies
- preserve conclusions and evidence levels
- support Hermes with structured prior evidence
- convert findings into notes, RFCs, tests, or prompt changes

The lab should optimize for:

- retrieval
- synthesis
- durability
- agent reuse

The lab should not try to replace:

- screenshot-heavy debugging
- high-fidelity turn replay
- raw session navigation ergonomics

## User Personas

### 1. Runtime Debugger

Needs:

- the failing session
- nearby comparable runs
- screenshots, logs, and turns

Best surface:

- Trace Viewer

### 2. Harness / Reliability Engineer

Needs:

- failure cohorts
- regressions
- repeated tool or perception pathologies
- evidence that supports tests or harness changes

Best surface:

- Viewer first, Lab second

### 3. Research / Prompt / Skill Designer

Needs:

- recurring patterns across sessions
- reusable summaries
- trace-informed design inputs

Best surface:

- Lab first, with links back to Viewer evidence

### 4. Hermes Agent

Needs:

- compact structured retrieval
- not giant JSONL blobs

Best surface:

- Lab / GBrain only

## UX Principles

1. Raw evidence and distilled knowledge should remain separate.
2. The user should never wonder which surface to use next.
3. Every failure workflow should have a clear escalation path:
   viewer session -> viewer cohort -> lab synthesis -> artifact
4. The highest-value actions should be one click away from failure inspection.
5. Summary views must lead to action, not just display numbers.

## Current State

### Viewer Strengths

- rich session detail
- turn-by-turn cards
- perception screenshots and element summaries
- runs vs sessions views
- compare workflows
- fleet overview and regression signals

### Viewer Weaknesses

- weak cross-session diagnosis workflow
- no direct use of lab trace retrieval
- backend memory/tasks mixed into the same shell without strong narrative fit
- analytics are informative but not strongly action-oriented

### Lab Strengths

- durable research model
- local GBrain persistence
- imported trace pages, raw sidecars, and refreshable timeline entries
- trace retrieval tools:
  - `search_traces`
  - `get_trace_session`
  - `list_trace_pathologies`
  - `find_similar_failures`

### Lab Weaknesses

- no lightweight trace dashboard
- weak direct raw-evidence handoff
- retrieval is available, but not yet shaped into an opinionated diagnosis brief

## Roadmap Goals

### Goal 1

Make the viewer the fastest way to understand one failing run.

### Goal 2

Make the lab the fastest way to understand a repeated failure pattern.

### Goal 3

Make the bridge between the two products explicit and low-friction.

### Goal 4

Reduce the feeling that the trace viewer is a mixed-purpose admin console.

## Roadmap

## Milestone 1: Clarify The Viewer

Target outcome:

- the viewer feels like one coherent operational tool

Priority work:

1. Reframe viewer navigation around three modes:
   - `Triage`
   - `Replay`
   - `Compare`
2. Add a session-level `Diagnosis` rail on detail pages.
3. Surface explicit next actions from a failed session:
   - `Find similar failures`
   - `Open pathology summary`
   - `Create bug brief`
   - `Create research note`
4. Reduce prominence of `Memory & Tasks` in the trace viewer shell unless tightly connected to the selected session.

Success signals:

- lower time-to-first-diagnosis for a failed session
- more consistent use of compare/cohort workflows
- fewer "where do I go next?" moments after a failure

## Milestone 2: Build The Viewer-Lab Bridge

Target outcome:

- users can move naturally from raw trace evidence to cross-session reasoning

Priority work:

1. Add viewer actions that call lab/GBrain trace tools.
2. Add a compact "Related Evidence" module in the viewer:
   - similar failures count
   - same failure code cohort
   - same domain cohort
   - recent matching sessions
3. Add deep links from lab trace results back into raw viewer sessions.
4. Add "send to lab" actions that create:
   - a research seed
   - a pathology note seed
   - an RFC seed

Success signals:

- repeated use of lab actions from the viewer
- reduced manual copying of session IDs between tools
- more durable artifacts linked to concrete evidence

## Milestone 3: Productize The Lab Trace Surface

Target outcome:

- the lab becomes an analyst's console for recurring failures

Priority work:

1. Add a lightweight lab trace dashboard:
   - top failure codes
   - recurring domains/fixtures
   - repeated tool/event pathologies
   - recent imported sessions
2. Add an agent-facing `trace_debug_brief` tool.
3. Add a `trace_recommendations` tool that proposes:
   - candidate harness tests
   - prompt or skill changes
   - follow-up research questions
4. Attach evidence grading to trace-derived findings:
   - A replicated
   - B single-run with trace evidence
   - C anecdotal
   - D theoretical

Success signals:

- higher reuse of prior trace findings in Hermes research
- more RFCs and research notes grounded in imported trace evidence
- less repeated manual analysis of the same pathology

## Milestone 4: Cohort-Centric Reliability Workflows

Target outcome:

- failures are managed as cohorts, not just isolated sessions

Priority work:

1. Define first-class pathology cohorts:
   - `turn_limit_reached`
   - repeated no-effect actions
   - multi-turn pathology loops
   - perception-mode mismatch
   - domain-specific repeated failures
2. Add saved cohort views in the viewer.
3. Add cohort summaries in the lab with durable naming and evidence levels.
4. Use cohorts to drive harness and regression work.

Success signals:

- fewer one-off debugging loops
- clearer prioritization of reliability work
- stronger relationship between traces and test creation

## Prioritization

### P0

- viewer-to-lab bridge from session detail
- session `Diagnosis` rail
- similar-failure and pathology handoff actions

### P1

- lab trace dashboard
- trace diagnosis brief for Hermes
- cohort-centric saved views

### P2

- stronger memory/tasks integration story
- product polish for multi-surface navigation and shared deep links

## What Not To Do

Do not:

- turn the viewer into a second lab
- turn the lab into a screenshot replay tool
- merge every trace-adjacent feature into one shell
- commit raw telemetry just to make UX easier

These would increase complexity while weakening role clarity.

## Recommended Ownership Boundaries

Viewer owns:

- raw traces
- screenshots and perception replay
- logs
- run/session compare
- fast triage UX

Lab owns:

- imported trace knowledge
- cross-session retrieval
- similar-failure search
- pathology summarization
- Hermes retrieval and durable research outputs

Bridge owns:

- deep links
- session-to-cohort handoffs
- research seed creation
- shared IDs and navigation semantics

## Success Definition

This roadmap is successful when:

1. a single failure can be triaged in the viewer in under a few minutes
2. repeated failures can be understood through the lab without manual JSONL reading
3. Hermes can retrieve useful trace evidence without touching raw files
4. trace analysis more often turns into durable artifacts than ephemeral chat conclusions

## Immediate Next Step

The next implementation milestone should be:

1. deepen the viewer-side `Diagnosis` panel with task-creation and artifact links
2. add a lab-side `trace_debug_brief` tool for researcher and Hermes use
3. preserve shared deep links between bug briefs, research notes, and raw replay

That is the next highest-leverage move because the first bridge now exists and the remaining work is about turning diagnosis into durable action.
