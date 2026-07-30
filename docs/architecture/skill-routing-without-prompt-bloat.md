# Scaling Skills Across Environments Without Prompt Bloat

> **Status: implemented.** The routing layer described here shipped in
> `orchestrator/skills.ts` (`resolveEligibleSkillCandidates` inside
> `selectPrimarySkill`, candidate cap `MAX_ROUTED_SKILL_CANDIDATES = 32`),
> with types in `skill-types.ts` and the catalog/bodies in
> `skill-catalog.ts` / `skill-bodies.ts`. The implementation matches this
> design closely; naming nit: the matcher input field is `query` (in
> `SkillMatcherInput`), not `taskText` as illustrated below. A runtime
> ablation switch (`setDisabledSkillIds`) also exists for selection-time
> skill disabling. Note the current catalog packages things slightly
> differently than the layer examples: most "enterprise" examples below
> (list filter/sort, catalog ordering, chart extraction) ship as **core
> (unpacked) always-eligible skills**; the gated enterprise packs today are
> `communication-workflows` and `procurement-workflows`, plus the
> `servicenow-platform` platform pack.

## Summary

OpenSidebar should scale skill selection with signal-gated environment routing while keeping workflow skills generic by default.

The runtime should not have a WorkArena mode. WorkArena is an evaluator that exposes gaps in reusable browser-agent behavior. Product code should route through core workflow skills first, then add platform-specific packs only when concrete page, URL, runtime, or user signals justify them.

Default choices:

- Keep core workflow skills always eligible.
- Activate platform packs only from strong environment evidence.
- Treat task text as a weak signal unless the user explicitly names the platform.
- Never use WorkArena task IDs, seeds, expected validator values, or benchmark-only facts as routing inputs.
- Inject only the selected skill contract/body into executor prompts.

## Skill Pack Model

Use three layers.

### Core Workflow Skills

Core workflow skills are always eligible and should work across websites and apps.

Examples:

- form fill with readback
- act-check-act execution
- menu navigation
- list filtering
- list sorting
- knowledge/search answer extraction
- catalog/cart/checkout flow
- modal recovery
- budget-aware execution

### Enterprise Workflow Packs

Enterprise workflow packs cover business-app patterns that are not tied to one vendor.

Examples:

- record creation
- table/list management
- request/catalog ordering
- dashboard/chart extraction
- approval/checklist workflows

### Platform Packs

Platform packs activate only with concrete platform evidence. They encode platform semantics, not benchmark shortcuts.

Example: `servicenow-platform`

- reference fields
- choice fields
- ServiceNow table/list URLs
- ServiceNow catalog state
- iframe/classic UI handling
- Glide-backed form commits

There should be no WorkArena runtime pack.

## Routing Policy

Before `selectPrimarySkill`, run an eligibility router:

1. Start with always-on core skills.
2. Add enterprise workflow packs when task/page shape suggests a business workflow.
3. Add platform packs only when strong platform signals are present.
4. Apply user/deployment enabled-pack settings as a policy filter.
5. Return a bounded candidate set.
6. Run existing skill selection only over that candidate set.

## Signal Strength

Strong signals:

- Current URL host/path matches known platform patterns.
- Page title or DOM contains stable platform markers.
- Runtime connector/context identifies the platform.
- User explicitly names the platform, such as "in ServiceNow".

Weak signals:

- Task text mentions generic business nouns, such as incident, change request, problem, catalog item, asset, or knowledge article.

Weak signals may influence ranking inside an already eligible pack, but they must not activate a platform pack by themselves.

## Anti-Overfitting Rules

- Do not route on WorkArena task IDs.
- Do not route on seed numbers.
- Do not encode hidden expected answers.
- Do not add benchmark-specific prompt phrases.
- Do not make ServiceNow skills responsible for generic workflows that should work elsewhere.
- Prefer generic workflow skills plus platform adapters/controllers.
- If a fix would help any comparable enterprise app, put it in core or enterprise workflow logic.
- If a fix only handles ServiceNow semantics, put it in `servicenow-platform`.
- If a fix only helps WorkArena validation, reject it unless it is pure test observability.

## Prompt Compactness

The planner/router may see compact descriptors:

- skill id
- description
- tags
- triggers
- maturity
- pack id
- activation reason

The executor receives only:

- selected skill body
- evidence requirements
- tool policy
- relevant platform controller/tool availability

The verifier receives only:

- selected skill verification summary
- required evidence
- completion constraints

The executor should never receive the full skill catalog.

## Implementation Shape

Add a routing layer before `selectPrimarySkill`:

```ts
resolveEligibleSkillCandidates({
  taskText,
  pageUrl,
  pageTitle,
  pageMarkers,
  runtimeContext,
  enabledSkillPackIds,
});
```

The router should:

- include all core skills
- add enterprise packs from workflow shape
- add platform packs from strong platform signals
- apply enabled/disabled pack settings
- cap the candidate set
- return candidate descriptors plus activation reasons

Then update `selectPrimarySkill` to accept either a candidate descriptor list or a routing context used to derive one.

## ServiceNow Activation

Activate `servicenow-platform` only when one or more strong signals exist:

- URL host contains a ServiceNow instance pattern.
- URL path matches stable ServiceNow routes.
- Page markers indicate ServiceNow UI, classic workspace, catalog, list, or form shell.
- Runtime context says the active connector/environment is ServiceNow.
- User explicitly says "ServiceNow".

Task words like incident, problem, change request, or catalog item are insufficient alone.

## Test Plan

Unit tests:

- ServiceNow URL enables `servicenow-platform` plus core.
- Explicit "in ServiceNow" task enables `servicenow-platform`.
- Generic "create an incident" task without ServiceNow evidence uses core/enterprise only.
- Generic catalog checkout site does not enable ServiceNow catalog behavior.
- Non-ServiceNow knowledge base uses generic answer extraction.
- Communication task enables communication pack without ServiceNow.
- Disabled pack setting removes a pack even when signals match.
- Candidate set remains bounded.
- WorkArena task IDs are ignored as routing signals.

Regression tests:

- Existing ServiceNow skill selections remain stable when strong ServiceNow evidence exists.
- Generic skills remain selected for non-ServiceNow pages.
- Executor prompt includes only the selected skill body.
- Verifier receives only selected-skill verification requirements.
- Run focused background tests for skill selection, handoff, and verifier behavior.
- Run one ServiceNow smoke after routing changes.
- Run broader WorkArena only after routing changes accumulate.

## Assumptions

- OpenSidebar remains Chrome-first.
- This does not require a full headless runtime.
- Repo-owned curated packs are enough for now.
- Dynamic retrieval or plugin discovery should wait until the catalog is much larger.
- User-authored website skills can be considered after core/platform routing produces the primary candidate set.
