# Prompt Sources

Root prompt source files for OpenSidebar.

These markdown templates are compiled into runtime artifacts by:

- `scripts/build-prompts.ts`

Generated outputs:

- `src/prompts/generated.ts`
- `src/prompts/manifest.json`

## Conventions

- Use YAML frontmatter with required fields:
  - `id`
  - `version`
  - `description`
- Body is the template text.
- Keep templates role-specific and concise.

## Current Scope

- `prompts/runtime/orchestrator/*.md` (runtime orchestrator prompt templates)
- `prompts/runtime/planner/*.md` (plan planner prompts)
- `prompts/runtime/agent/*.md` (agent system prompt templates)
- `prompts/runtime/reflections/*.md` (loop correction/escalation reflections)
- `prompts/evals/*.md` (eval judge and critique templates)
- `prompts/ui/saved-prompts/*.md` (default sidepanel saved prompt content)

Additional prompt surfaces (remaining runtime inline prompt fragments, e.g.
module-specific prompts outside migrated paths) will be migrated in follow-up phases.
