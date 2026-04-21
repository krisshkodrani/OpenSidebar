# Trace Viewer Developer Workflow

Date: 2026-04-21

Scope: Recommended workflow for engineers debugging agent behavior with the Trace Viewer and the Lab

## Goal

This workflow is for developers who need to move from:

- a failing run
- to a clear diagnosis
- to an engineering action

The intended product split is:

- **Viewer = raw evidence and fast triage**
- **Lab = pattern lookup and durable research**

The developer should start in the viewer and only use the lab when the question becomes cross-session.

## Primary Developer Flow

### 1. Start In The Viewer

Open the Trace Viewer and begin with the recent sessions or runs list.

Use the top-level viewer surface to answer:

- what failed recently
- what regressed
- whether the issue looks isolated or repeated

Useful first moves:

- filter by outcome
- filter by website / domain
- filter by day or recent window
- switch between `runs` and `sessions`

## 2. Triage The Failure

Before reading every turn, decide what kind of issue you are looking at.

Use:

- the fleet overview for hotspots and regressions
- the sessions table for quick scanning
- the compare queue if two sessions already look related

At this step, the developer should try to classify the problem as one of:

- isolated bad run
- likely repeated pathology
- likely regression
- likely domain-specific failure

## 3. Open One Session And Inspect Raw Evidence

When a candidate session is selected, use the raw viewer detail first.

Read in this order:

1. `TraceDetailHeader`
2. `Diagnosis`
3. `Turns`
4. `Perception`
5. `Logs`

Use the raw trace surface to answer:

- what was the user trying to do
- what the agent believed was happening
- what tools it used
- where it stalled, looped, or failed
- whether perception, planning, or execution was the first break

The viewer is the source of truth for:

- screenshots
- perception payloads
- turn-by-turn execution
- logs
- exact replay context

## 4. Use The Diagnosis Panel

The diagnosis panel is the bridge from one session to broader context.

For each failed session, check:

- failure code
- related failures count
- similar failures
- cohort signals
- pathology summary

Use the actions directly from the panel:

- `Create bug brief`
- `Open pathology summary`
- `Open cohort`
- `Open` on a similar failure
- `Compare` on a similar failure
- `Create research seed`

The diagnosis panel should answer:

- have we seen this failure before
- does this belong to a known cohort
- which other session is best to compare against
- whether the issue deserves durable research capture

## 5. Compare Before Guessing

When at least one similar session is available, prefer compare view over intuition.

Compare is especially useful for:

- working vs failing runs
- old vs new behavior
- same domain with different outcomes
- repeated failures with the same code

Use compare to find:

- first divergence turn
- tool-order differences
- perception differences
- longer loops or wasted turns
- changes in outcome, duration, or productive turns

As a rule:

- if the issue smells like regression, compare first
- if the issue smells novel, inspect raw turns first

## 6. Escalate To The Lab Only When Needed

The lab is not the first stop for a developer. It becomes useful when the question changes from:

- "what happened in this run?"

to:

- "how often does this happen?"
- "what pattern does this belong to?"
- "what should we capture for later reuse?"

Use the lab for:

- similar-failure retrieval
- pathology summaries
- cross-session pattern checks
- research seeds and notes

Do not use the lab as a replacement for screenshots or raw replay.

## 7. End With An Engineering Action

Every debugging session should terminate in a concrete next step.

Preferred outputs:

- bug brief for engineering handoff
- code fix
- prompt or policy change
- tool behavior fix
- harness test or repro fixture
- regression watch item
- research seed when the pattern is real but not yet understood

If there is no concrete action, the debugging loop is not done.

## Fast Path Recipes

### Regression Suspected

1. Filter to the affected domain or fixture.
2. Open the latest failure.
3. Use `Diagnosis` to find a similar prior run.
4. Use `Compare`.
5. Identify first divergence.
6. Convert that divergence into a fix or test.

### Repeated Failure Code

1. Open one failing session.
2. Expand `Open pathology summary`.
3. Use `Open cohort`.
4. Check whether the same code clusters around one fixture, tool, or event pattern.
5. If yes, create a harness or tooling task instead of treating it as a one-off.

### Unclear Root Cause

1. Inspect turns and perception first.
2. Check whether the first bad step is planning, perception, or tool execution.
3. Use similar failures to see whether the same shape exists elsewhere.
4. Create a bug brief if the issue now looks actionable.
5. Create a research seed if the pattern is still ambiguous after raw inspection.

## Team Conventions

Use these norms when working from traces:

- do not commit raw traces
- use the viewer for evidence, not memory
- use the lab for memory, not screenshot replay
- prefer compare workflows over narrative guessing
- create durable artifacts only for repeated or meaningful pathologies

## What Good Looks Like

A strong developer debugging loop should end with all of these true:

- one session was inspected deeply
- one related session or cohort was checked
- the likely failure class is named
- a concrete engineering action was chosen

## Recommended Next Product Steps

To make this workflow better for developers, the next useful additions are:

1. richer compare deep links into preloaded cohorts
2. pathology status tracking such as `new`, `investigating`, `fixed`, `watching`
3. direct links from bug briefs into task creation
4. direct links from research seeds to the created lab artifact
