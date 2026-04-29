# The Right Level Of Abstraction

Last updated: 2026-04-29

This guide explains how OpenSidebar should decide where to fix browser-agent failures. It is written from the WorkArena ServiceNow work, but the principle applies to every benchmark, product workflow, and real user task.

The short version:

> Fix the reusable behavior that failed, not the benchmark example that exposed it.

## Why This Matters

Browser-agent failures are often tempting to patch at the visible symptom:

- "Click this exact button for this exact task."
- "If the prompt contains Margaret Grey, use this value."
- "Increase the turn limit until the task passes."
- "Add a test harness shortcut for this one fixture."

Those changes can turn one red run green, but they do not make the agent better. They also make future failures harder to diagnose because success starts depending on hidden benchmark knowledge.

The right abstraction is the lowest layer that expresses the real reusable capability.

For example, the WorkArena `filter-incident-list` failure was not really about Margaret Grey. The real missing capability was:

- identify a ServiceNow list filter request,
- map visible labels to real fields,
- encode choice values,
- resolve reference display values to sys_ids,
- apply the resulting query in a way ServiceNow and WorkArena both recognize.

The fix belongs in a reusable list-filter tool and skill policy, not in the prompt, the runner, or a hardcoded task branch.

## The Abstraction Ladder

Use this ladder when deciding where a fix belongs. Start at the lowest level that honestly solves the general behavior.

| Layer | Put fixes here when... | Example |
| --- | --- | --- |
| Content/DOM runtime | The browser cannot perceive or interact with a class of real page elements. | Shadow DOM traversal, iframe targeting, stable element IDs, autocomplete commit behavior. |
| Tool primitive | The agent needs a reusable browser or application operation. | `apply_list_filter`, future `apply_list_sort`, table inspection, reference resolution. |
| Domain adapter | A platform has stable generic semantics. | ServiceNow reference fields require sys_ids; ServiceNow choices have display labels and encoded values. |
| Skill | A workflow has a stable sequence and evidence requirements. | For explicit list filters, call structured filter tooling before manual filter-builder clicks. |
| Planner policy | The planner repeatedly chooses the wrong workflow class. | Route structured list-filter requests to the list-filter workflow. |
| Harness | The problem is reset, session transfer, reporting, or deterministic setup. | BrowserGym session import/export or report schema validation. |
| Fixture/test | The test itself is wrong or unrealistic. | Incorrect expected value, broken local fixture, non-user-like prompt wording. |

If a fix only mentions one benchmark task id, one seed, or one hidden expected value, it is probably too low-value and too specific.

## Good Versus Bad Fixes

| Situation | Better fix | Worse fix |
| --- | --- | --- |
| ServiceNow list filter cannot set `Caller = Margaret Grey` | Resolve reference display values to sys_ids for reference fields. | Hardcode Margaret Grey's sys_id. |
| Agent struggles with ServiceNow list sorting | Add `apply_list_sort` or improve list-header sorting behavior. | Tell the model to click a particular column coordinate. |
| Knowledge task cannot extract answer from search result | Improve search result opening and article text extraction. | Add the answer to the prompt. |
| Chart task needs a displayed percent | Add chart/table data extraction that works for SVG/canvas/table-backed charts. | Hardcode the visible number from one run. |
| Catalog order task stalls on configuration controls | Add a catalog-item configuration helper and skill evidence rules. | Increase max turns and hope manual clicking finishes. |
| Report says validation passed but agent terminal failed | Fix terminal-state accounting. | Treat every validation pass as a runner exception. |

## WorkArena Case Study: List Filters

The `workarena.servicenow.filter-incident-list` sample originally failed for several reasons:

1. The executor did not consistently use a structured filter path.
2. Manual ServiceNow filter-builder interaction was brittle and expensive.
3. Reference fields were encoded with display values instead of sys_ids.
4. The validator expects query semantics, not just a plausible-looking breadcrumb.

The scalable fix was to add and prefer `apply_list_filter`.

That tool now represents a reusable operation:

- accept field/operator/value conditions,
- infer the target ServiceNow table,
- resolve field labels such as `Caller` to fields such as `caller_id`,
- resolve choice labels such as `Inquiry / Help` to encoded values such as `inquiry`,
- resolve reference labels such as `Margaret Grey` to ServiceNow sys_ids,
- build the encoded `sysparm_query`,
- navigate to the filtered list.

That is the right level of abstraction because the behavior is useful beyond one WorkArena case.

## Signals That A Fix Is Too Specific

Treat these as warning signs:

- The code branches on a benchmark task id.
- The code branches on a seed.
- The code embeds a hidden validator answer.
- The prompt contains unnatural trigger phrases for a tool.
- The harness performs product logic instead of setup, observation, or validation.
- A skill depends on test-only selectors or fixture-only wording.
- The fix passes one run but leaves the underlying trace failure unexplained.
- The agent says it is done based on planner belief rather than page or validator evidence.

## Signals That A Fix Is At The Right Level

A good fix usually has these properties:

- It describes a real browser or application capability.
- It can be explained without naming the benchmark case.
- It works for multiple prompts with the same workflow shape.
- It has focused regression coverage.
- It reduces manual clicking, repeated exploration, or fragile coordinates.
- It improves trace readability because the tool result states what happened.
- It preserves benchmark fairness: no hidden expected answers, no fixture shortcuts.

## How To Choose The Fix Layer

Use this process for E2E and WorkArena failures:

1. Confirm the first clean failure from traces or live validation.
2. Name the missing capability in platform-neutral terms.
3. Decide the narrowest reusable layer that owns that capability.
4. Implement there.
5. Add a focused regression test at that layer.
6. Rerun the isolated case.
7. Only then broaden to category samples or staged suites.

Example:

```text
Symptom:
WorkArena list filter failed for Caller = Margaret Grey.

Bad diagnosis:
The model clicked the wrong ServiceNow widget.

Better diagnosis:
The product lacks a reliable structured list-filter operation for ServiceNow reference fields.

Fix layer:
Tool primitive plus skill preference.

Verification:
Unit test proves reference display value becomes sys_id.
Live WorkArena task validates the resulting query.
```

## Practical Placement Rules

Prefer these placements in this repository:

- Agent behavior changes: `apps/extension/src/background`
- Page interaction fixes: reusable tools, runtime policy, controllers, or skills
- Content bridge fixes: `apps/extension/src/content`
- Shared tool contracts: `packages/shared-types`
- E2E harness changes: only setup, observation, deterministic state transfer, or reporting
- Generated run reports: `.artifacts/e2e/`
- Stable guidance: `docs/`

Avoid putting product behavior into:

- benchmark prompts,
- test-only branches,
- fixture selectors,
- one-off runner code,
- documentation-only instructions without runtime support.

## The Standard We Should Hold

A WorkArena fix is scalable when we can say:

> This made OpenSidebar better at a class of real browser tasks, and WorkArena happened to be the proof.

It is not scalable when we can only say:

> This made one WorkArena run pass.

The benchmark is useful because it exposes missing capabilities. The product improves when those capabilities become reusable runtime behavior.
