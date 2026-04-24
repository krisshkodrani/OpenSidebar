# Agent Capabilities

OpenSidebar combines a fast executor with a planner, verifier, and visual perception layer.

## Model Roles

| Role | Model | Provider | Purpose |
| --- | --- | --- | --- |
| Executor | `accounts/fireworks/routers/kimi-k2p5-turbo` | Fireworks | Default action loop |
| Executor fallback | `accounts/fireworks/routers/kimi-k2p5-turbo` | Fireworks | Runtime fallback for empty-response issues |
| Planner | `accounts/fireworks/routers/kimi-k2p5-turbo` | Fireworks | Planning, rerouting, verification |
| Perception | `x-ai/grok-4.1-fast` | OpenRouter | Visual grounding |

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
