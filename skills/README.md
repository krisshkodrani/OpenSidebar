# Skills

This directory is the proposed home for repo-curated workflow skills used by OpenSidebar.

## Purpose

Skills are not replacements for tools.

OpenSidebar tools should remain generic browser primitives. Skills sit above the tool layer and define reusable workflow procedures for recurring browser-task classes such as:

- multi-field form filling
- transactional act-check-act flows
- cart modification before checkout
- cross-turn draft revision
- cross-tab comparison

## Design Rules

1. Keep tools generic and composable.
2. Make skills workflow-shaped, not site-shaped.
3. Prefer one primary skill per orchestrator node.
4. Load only the selected skill body at runtime.
5. Tie each skill to verification and memory expectations.
6. Derive skills from trace and E2E evidence.

## Layout

```text
skills/
  workflow/
    <skill-id>/
      descriptor.json
      SKILL.md
```

## Roadmap

See [docs/skills-roadmap-2026-04-13.md](../docs/skills-roadmap-2026-04-13.md) for:

- the current runtime workflow skills
- the next worthwhile product skills
- lab-only meta-skills
- promotion and prioritization rules

## Current Status

**The runtime source of truth is the TypeScript catalog** —
`apps/extension/src/background/orchestrator/skill-catalog.ts` (descriptors) and
`skill-bodies.ts` (procedure bodies). The MV3 extension cannot read this
directory at runtime, and no build step inlines it.

This directory mirrors a subset of the runtime catalog for review and
authoring. The mirrored `descriptor.json` files are kept field-identical to the
catalog (checked by `tests/background/skill-disk-parity.test.ts`; regenerate
from the catalog when the runtime changes — live wins every conflict). A
build-time generator that makes this directory the single source is the
planned end state (2026-07-23 skills audit, Finding 1).
