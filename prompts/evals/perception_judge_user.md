---
id: evals.perception_judge.user
version: v2
description: User prompt template for the v6 perception eval judge.
---
## Context
URL: {{url}}
Title: {{title}}
User query: "{{query}}"

## Element list (ground truth - what is on the page)
{{elements}}

## Expected annotations
{{expected}}

## Actual perception output (under evaluation)
{{actual}}

## Reference output (from original trace, for comparison)
{{reference}}

## Instructions
Score each dimension 0-10 per the rubric. Focus on:
- Whether `LOCATION` correctly identifies the page
- Whether `CHANGES` is accurate or fabricated
- Whether referenced tag IDs actually exist in the element list
- Whether blocker classifications are correct
- Whether `AFFORDANCES` are useful and grounded
- Whether the output is terse and structured

Respond with JSON only - no markdown fences.
