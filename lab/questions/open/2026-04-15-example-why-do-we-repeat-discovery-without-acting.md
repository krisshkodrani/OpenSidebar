# Example: Why does the executor repeat discovery steps without acting on the result?

Status: Example
Type: pathology
Source: traces
Created: 2026-04-15T08:00:00.000Z
Tags: example, traces, grounding, action-selection

## Why This Matters

- Repeated discovery without action burns turn budget and makes the agent look indecisive.
- This pattern often hides a harness problem that generic prompting alone will not fix.

## Trigger / Pathology

- In several browser tasks, the executor calls `find_element` or `read_page` multiple times in a row, gets usable information, but does not convert that information into the next concrete action.
- The visible symptom is "I found the element" repeated across turns with no mutation or state change.

## Evidence

- continuation-related traces showing repeated `find_element` calls
- navigation-challenge runs with discovery-heavy loops
- any logs that show repeated tool calls with identical arguments and results

## Generalization Target

- Likely harness-wide, not site-specific
- Most likely to appear in workflows where discovery and action are loosely coupled

## Candidate Explanations

- The executor lacks an explicit "act on newly discovered affordance" contract
- Tool results are informative, but not salient enough in the next-turn prompt
- Repeated-action detection is too late and only catches the pattern after several wasted turns

## Proposed Investigation

- Sample traces where discovery repeats at least 3 times without a state-changing action
- Compare successful vs failed cases to see what pushes the model from discovery into execution
- Draft a Notion RFC if the issue looks prompt-contract or orchestration-level rather than fixture-specific

## Exit Criteria

- We can name the main cause of the pattern with evidence from multiple traces
- We can propose a concrete intervention: prompt rule, tool-result shaping, or loop-level guardrail
- The question should promote to a Notion RFC or experiment if the direction is coherent
