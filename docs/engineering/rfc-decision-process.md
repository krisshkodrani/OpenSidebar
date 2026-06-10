# RFC Decision Process

This process turns RFC critique into a binding implementation boundary. RFCs
remain in Notion; this document is the stable workflow contract for reviewers and
implementers.

## Lifecycle

`Draft -> Reviewed -> Decision stamped -> Implementation plan -> Implementation -> Verification -> Archived or promoted to docs`

`Reviewed` means feedback exists. It does not mean the RFC is approved.

## Decision Authority

- The user or a maintainer owns the final decision.
- An agent may provide a recommendation, but must label it as a recommendation.
- If the owner has not decided, stop before implementation and ask for the final
  status.
- The latest owner-authored Decision Stamp controls the RFC. If it supersedes an
  earlier stamp, retain the prior decision in the page history.

## Status Semantics

| Status              | Meaning                                                       | Implementation allowed?               |
| ------------------- | ------------------------------------------------------------- | ------------------------------------- |
| Approved            | The chosen path is ready.                                     | Yes                                   |
| Approved with edits | The direction is accepted, but listed RFC edits are blocking. | Only after the edits are incorporated |
| Rejected            | Do not pursue this design.                                    | No                                    |
| Parked              | Preserve the proposal for later prioritization.               | No                                    |
| Needs more research | Evidence is insufficient for a decision.                      | Only the named research or spike      |

## Decision Stamp

All fields are required. Use `None` only when there is deliberately no item. Do
not use placeholders such as `TBD`, `TODO`, `Pending`, or `...`.

```md
## Decision

Status: Approved

Chosen path:

- Describe the single authoritative design.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- List work that may wait, or `None`.

Do not do:

- Record rejected alternatives and boundaries agents must not reinterpret.

Evidence required before merge:

- Name tests, measurements, traces, or observable acceptance criteria.

Next action:

- Implement
```

Allowed statuses are `Approved`, `Approved with edits`, `Rejected`, `Parked`, and
`Needs more research`. Allowed next actions are `Implement`, `Revise RFC`, `Run
spike`, and `Archive`. An `Approved with edits` stamp should use `Revise RFC`
until its blocking edits are incorporated, then change the next action to
`Implement`. A retrospectively stamped, verified implementation may use
`Approved` with `Archive`.

## Implementation Gate

Before implementing RFC-driven work, verify:

1. The owner-authored Decision Stamp is present.
2. `Status` permits the requested action.
3. Blocking edits are resolved.
4. The implementation plan follows `Chosen path` and `Do not do`.
5. The plan includes every item under `Evidence required before merge`.

If any item fails, revise the RFC or ask the owner for a decision. Do not resolve
the ambiguity by choosing a design in code.

## Review Prompt

Use this after critique:

```text
Convert this RFC review into a decision stamp.

Recommend one status: approve, approve with edits, reject, park, or research more.
Then ask me for the final call if I have not already made it.

Include:
- the chosen path
- what must change before implementation
- what can wait
- what agents must not reinterpret
- what evidence proves the implementation is done
- the next action
```

For a local Markdown export, validate the completed stamp with:

```powershell
pnpm rfcs:check -- path\to\rfc.md
```
