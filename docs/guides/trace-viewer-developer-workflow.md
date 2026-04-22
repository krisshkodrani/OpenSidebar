# Trace Viewer Developer Workflow

Date: 2026-04-21

Scope: Recommended workflow for engineers debugging agent behavior with the Trace Viewer

## Goal

This workflow is for developers who need to move from:

- a failing run
- to a clear diagnosis
- to an engineering action

The intended product split is:

- **Viewer = raw evidence and fast triage**
- **Docs and follow-up systems = durable conclusions**

The developer should start in the viewer and stay in the viewer until there is a concrete engineering action or an external note worth preserving.

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
2. `Turns`
3. `Perception`
4. `Logs`

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

## 4. Compare Before Guessing

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

## 5. End With An Engineering Action

Every debugging session should terminate in a concrete next step.

Preferred outputs:

- bug brief for engineering handoff
- code fix
- prompt or policy change
- tool behavior fix
- harness test or repro fixture
- regression watch item
- an external note or issue when the pattern is real but not yet understood

If there is no concrete action, the debugging loop is not done.

## Fast Path Recipes

### Regression Suspected

1. Filter to the affected domain or fixture.
2. Open the latest failure.
3. Use `Compare`.
4. Identify first divergence.
5. Convert that divergence into a fix or test.

### Repeated Failure Code

1. Open one failing session.
2. Filter the viewer to the same outcome, domain, or fixture.
3. Compare against another recent failure or success.
4. Check whether the same code clusters around one fixture, tool, or event pattern.
5. If yes, create a harness or tooling task instead of treating it as a one-off.

### Unclear Root Cause

1. Inspect turns and perception first.
2. Check whether the first bad step is planning, perception, or tool execution.
3. Use the viewer filters and compare mode to see whether the same shape exists elsewhere.
4. Create a bug brief or issue if the problem now looks actionable.
5. Capture any durable conclusion in the external notes system, not in the repo.

## Team Conventions

Use these norms when working from traces:

- do not commit raw traces
- use the viewer for evidence, not memory
- prefer compare workflows over narrative guessing
- create durable artifacts only for repeated or meaningful pathologies, and keep them outside the repo

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
