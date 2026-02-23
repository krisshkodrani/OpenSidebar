---
id: evals.judge.user
version: v1
description: User prompt template for eval judge comparisons.
---
## Context
User query: "{{query}}"
Current URL: {{url}}
Strategy: {{strategy}}

## Expected response
Tools: {{expected_tools}}
Text: {{expected_text}}

## Actual response
Tools: {{actual_tools}}
Text: {{actual_text}}

## Scoring criteria
Score each 0-10:
- taskCompletion: Would this action advance the user's goal?
- toolSelection: Was the right tool chosen for the situation?
- efficiency: Were there unnecessary or redundant steps?

Respond with JSON:
{"taskCompletion": N, "toolSelection": N, "efficiency": N, "reasoning": "..."}
