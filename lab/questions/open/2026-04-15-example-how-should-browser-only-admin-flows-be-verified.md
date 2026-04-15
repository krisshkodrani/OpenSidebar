# Example: How should browser-only admin flows be verified when no API or SCIM path exists?

Status: Example
Type: design
Source: product-research
Created: 2026-04-15T08:10:00.000Z
Tags: example, verification, admin-flows, browser-automation

## Why This Matters

- Browser-only admin tasks can have billing, permission, or compliance side effects.
- "The modal closed" is not enough evidence for completion in these flows.

## Trigger / Pathology

- A user asks the agent to manage accounts, permissions, or membership in a SaaS product where enterprise identity features are unavailable.
- The system can act through the browser, but the success condition is ambiguous.

## Evidence

- product research notes on non-enterprise provisioning
- traces of invite/member-management workflows
- any E2Es involving stateful admin or confirmation-heavy flows

## Generalization Target

- Broader than one product, but limited to browser-only admin workflows
- Likely relevant to invites, seat assignment, access changes, and offboarding flows

## Candidate Explanations

- The current `done` criteria are too action-oriented instead of state-oriented
- The verifier lacks a reusable contract for member-list or permission-state confirmation
- Approval and verification are being treated as separate concerns when they need a shared workflow contract

## Proposed Investigation

- Define what counts as sufficient evidence in browser-only admin flows
- Compare state verification patterns across at least two products
- Determine whether this belongs in a dedicated workflow skill, a verifier policy, or both

## Exit Criteria

- We can state the minimum evidence required before the agent may call the task complete
- We know whether approval-sensitive admin flows need a special verification contract
- The result is concrete enough to turn into an RFC, skill contract, or test plan
