# WorkArena Generalized Harness Philosophy

Last updated: 2026-05-07

WorkArena is useful because it makes browser-agent weaknesses concrete. It should not become the shape of the product. The purpose of WorkArena runs is to expose reusable harness, runtime, tool, and skill problems that also matter on normal websites and customer workflows.

The guiding question is:

> What general browser-agent capability did this benchmark failure reveal?

## What WorkArena Teaches

WorkArena is a strong evaluator because it combines realistic web applications, hidden validation, seeded variation, session transfer, and multi-step workflows. Those properties reveal problems that smaller fixtures often hide:

- whether the harness can preserve real browser state across reset, extension launch, execution, validation, and teardown
- whether validation truth stays synchronized with the page state the agent actually changed
- whether traces explain the reason a run passed, failed, or only appeared to pass
- whether tools express real operations, such as applying a list filter, instead of forcing fragile click sequences
- whether skills guide workflow discipline without embedding hidden benchmark answers
- whether category-balanced results expose missing capabilities that aggregate pass rates would hide

A good WorkArena batch should therefore produce engineering direction, not just a score.

## Harness Principles

The generalized harness should be a truth-preserving adapter between an evaluator and the product runtime.

It may:

- reset or seed external state
- transfer browser sessions into the extension environment
- start and stop the agent under realistic conditions
- collect traces, logs, prompts, costs, screenshots, and generated reports
- call the evaluator validator and preserve its result as the primary success signal

It must not:

- complete product work on behalf of the agent
- branch on task id, seed, fixture text, or hidden expected values
- convert benchmark-specific selectors into product shortcuts
- treat planner belief, a pretty breadcrumb, or a terminal status as stronger evidence than real validation
- hide validation/session mismatches behind a green report

The harness is successful when it makes failures diagnosable and fair. The product is successful when the runtime, tools, adapters, and skills can solve the workflow without benchmark knowledge.

## From Failures To General Problems

Classify every WorkArena failure into the broadest reusable problem it exposes:

| Signal | General problem to solve |
| --- | --- |
| Validation fails even though the page looks correct | Session transfer, final URL/state synchronization, or validator timing is unreliable. |
| A task passes validation but the agent terminal state says failure | Runtime terminal accounting or completion verification is inconsistent. |
| The agent clicks through many UI controls for a structured operation | A tool primitive or domain adapter is missing. |
| The same workflow category fails across seeds | Skill selection, tool routing, or workflow evidence rules are weak. |
| One category is clean and another is weak | Prioritize the weak workflow class before broadening the benchmark batch. |
| A pass takes many turns or traces | The capability works but needs a more direct tool, skill, or recovery path. |
| Reset or teardown errors appear around otherwise valid runs | Harness/session robustness needs work before interpreting category scores too strongly. |

For example, a ServiceNow list-filter failure should become a generalized list/table filtering problem: field label mapping, reference resolution, choice encoding, query application, and evidence that the list refreshed. It should not become a branch for `filter-incident-list` or one seeded prompt.

## Batch Discipline

Use small WorkArena batches to learn, not to chase a leaderboard.

- Run guarded smoke first to prove the evaluator bridge is healthy.
- Run category or triage samples without retries to expose deterministic failures.
- Preserve pass@1 as the reliability signal; add pass@2 later as a recovery signal.
- Use category-balanced pass@1 so broad categories do not hide narrow but important failures.
- Rank failures by reusable fix layer: harness/session, validation sync, DOM/perception, tool runtime, domain adapter, skill policy, or planner routing.
- Fix the broadest reusable bottleneck, then rerun the isolated case before broadening again.

The right next action after a batch is usually not "run more WorkArena." It is to name the missing capability and fix it where it belongs.

## Product Standard

WorkArena progress counts when it improves OpenSidebar outside WorkArena:

- a tool handles a class of web operation more reliably
- a domain adapter captures stable platform semantics without hidden answers
- a skill teaches repeatable sequencing and evidence requirements
- the harness preserves state and validation truth more faithfully
- traces make both success and failure easier to audit

A benchmark pass is evidence. A reusable capability is the product improvement.

