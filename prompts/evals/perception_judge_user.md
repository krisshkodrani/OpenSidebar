---
id: evals.perception_judge.user
version: v1
description: User prompt template for perception eval judge.
---
## Context
URL: {{url}}
Title: {{title}}
User query: "{{query}}"
Perception mode: {{mode}}

## Element list (ground truth — what is on the page)
{{elements}}

## Expected annotations
{{expected}}

## Actual perception output (under evaluation)
{{actual}}

## Reference output (from original trace, for comparison)
{{reference}}

## Instructions
Score each dimension 0-10 per the rubric. Focus on:
- Whether referenced tag IDs actually exist in the element list
- Whether blocker classifications are correct
- Whether the completion signal matches expected status
- Whether the output is terse and structured

Respond with JSON only — no markdown fences.
