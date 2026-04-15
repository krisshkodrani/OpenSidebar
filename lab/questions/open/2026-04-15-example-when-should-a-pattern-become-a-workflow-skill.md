# Example: When should a repeated browser pattern become a first-class workflow skill?

Status: Example
Type: design
Source: roadmap
Created: 2026-04-15T08:05:00.000Z
Tags: example, skills, roadmap, generalization

## Why This Matters

- Promoting a pattern into a skill too early creates overfitting.
- Promoting too late leaves repeated execution variance in the harness.

## Trigger / Pathology

- A workflow shape keeps reappearing across E2E failures or trace analysis, but it is not clear whether it deserves a skill, a tool improvement, or a harness policy change.

## Evidence

- recent trace-analysis notes
- current skills roadmap
- at least 2-3 E2Es where the same workflow shape appears

## Generalization Target

- The question is harness-wide, but grounded in specific recurring workflows
- The main distinction is whether the pattern is stable across more than one site or fixture

## Candidate Explanations

- The pattern is truly a reusable multi-step contract and should become a skill
- The pattern is actually a missing tool primitive, not a skill
- The pattern is a scheduler/verifier problem and belongs in harness policy

## Proposed Investigation

- Compare the pattern against the skill-promotion rules in the roadmap
- Inspect traces for stability: does the same sequence recur with similar success criteria?
- Write down what would be encoded if this became a skill: sequence, verification rule, memory scope

## Exit Criteria

- We can say "skill", "tool", or "policy" with reasons
- We can describe the smallest useful contract if it should become a skill
- If the answer is still vague, the question should stay open rather than force a skill prematurely
