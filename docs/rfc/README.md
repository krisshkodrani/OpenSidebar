# RFCs (Request for Comments)

Feature proposals and technical decisions for OpenSidebar.

## Active RFCs

| RFC | Status | Summary |
|-----|--------|---------|
| [Multi-Turn Conversation Resilience](./rfc-multi-turn-resilience.md) | **Proposed** | Rolling distillation, pinned goal, fresh-start recovery, episodic subtasks — based on "LLMs Get Lost In Multi-Turn Conversation" (arXiv:2505.06120) |
| [Programmatic Verification](./rfc-programmatic-verification.md) | **Proposed** | Replace LLM-based node verification with DOM-state checks; eliminate critic/advocate debate — based on Dibia Ch 10, Gulli Ch 4, Rothman Ch 2 |
| [Batched Action Execution](./rfc-batched-actions.md) | **Proposed** | Reduce LLM round trips for predictable workflows (forms, logins) via batch hints + `fill_form` tool — based on Dibia Ch 5, Gulli Ch 3/6, Rothman Ch 4 |
| [Orchestrator Call Reduction](./rfc-orchestrator-call-reduction.md) | **Proposed** | Remove deliberation, plan review, debate rounds, retrospective LLM calls; replace with programmatic checks — based on Dibia Ch 11, Gulli Ch 7/17, Rothman Ch 4/8 |
| [Centralized Prompt Management](./rfc-centralized-prompt-management.md) | **Proposed** | Move all prompts into root `prompts/`, compile at build time, and share one prompt manifest across runtime + evals |

## Orchestrator Design

Active design documents for the orchestrator subsystem: [orchestrator/](./orchestrator/)

## RFC Process

### Submitting an RFC

1. **Create RFC document** in this directory using the template below
2. **Technical review** — evaluate technical feasibility
3. **Design review** — consider UX implications
4. **Approval** — RFC moves to "Ready to implement" status
5. **Implementation** — assigned to development milestone
6. **Deletion** — remove the file once the work is captured in architecture docs and CLAUDE.md

### RFC Template

```markdown
# RFC: [Feature Name]

## Status

[Proposed | Ready to implement | In progress | Complete]

## Problem

[Clear description of the issue or opportunity]

## Solution

[Proposed implementation approach]

## Implementation

[Technical details and code changes]

## Testing

[Test plan and success criteria]

## Impact

[Effects on users, performance, security]
```
