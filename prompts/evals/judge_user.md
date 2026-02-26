---
id: evals.judge.user
version: v2
description: User prompt template for eval judge with system prompt context.
---
## Context
User query: "{{query}}"
Current URL: {{url}}
Strategy: {{strategy}}
Pathology tag: {{pathology}}

## System prompt excerpt (what the agent was told)
{{system_prompt_excerpt}}

## Visible elements on page (what the agent could see)
{{visible_elements}}

## Expected response (correct behavior)
Tools: {{expected_tools}}
Text: {{expected_text}}

## Actual response (what the agent did)
Tools: {{actual_tools}}
Text: {{actual_text}}

## Instructions
Score each dimension 0-10 per the rubric. Focus on whether the agent used the information available to it (visible elements, system prompt instructions) correctly. If the agent made a mistake, suggest a specific system prompt edit that would prevent it.

Respond with JSON only — no markdown fences.
