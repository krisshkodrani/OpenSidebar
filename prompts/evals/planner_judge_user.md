---
id: evals.planner_judge.user
version: v2
description: "User prompt template for planner eval judge. v2: termination context section."
---

## Task Context

**User query:** {{query}}
**Page:** {{pageTitle}} ({{pageUrl}})
**Page state:** {{perception}}

## Actual Plan (from planner)

{{actualPlan}}

## Reference Plan (from recorded session)

{{referencePlan}}

## Session Outcome

- **Outcome:** {{sessionOutcome}}
- **Turn count:** {{sessionTurnCount}}

## Termination Context

{{terminationContext}}

## Instructions

Evaluate the **Actual Plan** against the 5-dimension rubric. Use the Reference Plan and Session Outcome as additional context — a plan that led to a "completed" outcome in few turns is likely better than one that led to "max_turns".

Score each dimension 0-10 and provide your reasoning.
