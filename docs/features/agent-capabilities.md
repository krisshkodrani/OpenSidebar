# Agent Capabilities

OpenSidebar combines a fast executor with a planner, verifier, and visual perception layer.

## Model Roles

| Role | Model | Provider | Purpose |
| --- | --- | --- | --- |
| Executor | `openai/gpt-6-luna` | OpenRouter | Default visual action loop |
| Executor fallback | `openai/gpt-6-luna` | OpenRouter | Empty-response retry seat |
| Planner | `openai/gpt-6-luna` | OpenRouter | Planning, rerouting, verification |
| Judge | `typesafe/jev-1.13` | OpenRouter Decisions API | Typed completion rubric decisions |
| Perception | `unified_vl` by default; structured fallback is provider-specific | Configured provider | Visual grounding |

Xiaomi MiMo can be selected as an agent provider with `XIAOMI_API_KEY`. In that mode, the executor uses `mimo-v2-omni` and planner choices are limited to curated MiMo V2 models.

The OpenRouter chat requests ask for response usage. Session cost accounting uses
provider-reported USD cost when present and labels table-based fallback as an
estimate. Judge calls record usage in `judge_call` trace events and add it to
the session cost figure. Planner calls record usage in `planner_llm_call` trace
events and add their charges to the session cost figure. Model rates vary with
routing, cache use, and context length. Jev's 0.5 decision threshold is a
starting point pending calibration against labeled browser-task outcomes.

Luna's Chat Completions tool calls use `reasoning_effort: none`; planner calls
use medium reasoning. Jev has a 32k text context and returns probabilities for
typed questions, rather than chat text. See the [Luna model card](https://developers.openai.com/api/docs/models/gpt-6-luna),
[Jev model card](https://openrouter.ai/typesafe/jev-1.13), and
[OpenRouter Decisions API guide](https://openrouter.ai/blog/tutorials/how-to-use-jev/).

## Runtime Capabilities

- Single-step execution through the main agent loop.
- Multi-step orchestration through planner, executor, and verifier roles.
- 38 tool primitives for page interaction, navigation, inspection, and control flow.
- Stateful perception for page location, change detection, blockers, and affordances.
- Approval gates and risk classification for sensitive actions.
- Anti-loop guardrails, stale element recovery, and retry policy control.
- Trace recording and logs for debugging and quality work.

## Perception Contract

The perception layer returns:

- `LOCATION`
- `CHANGES`
- `BLOCKERS`
- `VISUAL-ONLY`
- `AFFORDANCES`

## Orchestration

For harder tasks the runtime can:

1. build a plan
2. execute one node at a time
3. verify success criteria
4. retry, reroute, escalate, or finish

This lets the product separate fast execution from slower reasoning without forcing every turn onto the planner model.
