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

The workflow skills in this directory are wired into runtime selection and prompt assembly.
