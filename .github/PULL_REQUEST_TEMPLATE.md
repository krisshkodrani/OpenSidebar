<!--
Thanks for contributing to OpenSidebar! Please skim CONTRIBUTING.md first —
especially the seam map (where changes land cleanly) and the do-not-enter map
(owner-gated surfaces). PRs into loop.ts / completion-kernel.ts / skills.ts
without a stamped RFC will be asked to step back to an issue first.
-->

## What this changes

<!-- One or two sentences. Link the issue this closes, if any (e.g. Closes #123). -->

## Surface (per the CONTRIBUTING seam map)

- [ ] E2E fixture / test
- [ ] Policy module (`background/agent/*-policy.ts`)
- [ ] Tool (definition + args type + `content/actions.ts`)
- [ ] Trace-viewer panel / analysis
- [ ] Provider adapter
- [ ] Docs / templates
- [ ] Other (please describe)
- [ ] Touches `loop.ts` / `completion-kernel.ts` / `skills.ts` — **owner-gated; link the stamped RFC:** <!-- RFC link -->

## Checklist

- [ ] `pnpm run verify` passes locally (rfcs + lint + typecheck + test + build + dist-check)
- [ ] Did not grow any landmine file (`loop.ts`, `completion-kernel.ts`, `tools/index.ts`, `orchestrator/index.ts`, `skills.ts`) past its ratchet budget (`node scripts/loop-ratchet.mjs`); tightened `scripts/loop-ratchet-budget.json` if code was extracted
- [ ] Added or updated the narrowest test that proves this change (a failing E2E fixture counts)
- [ ] For a tool change: parameter names match across all three layers (schema, args type, `actions.ts`)
- [ ] No benchmark-specific / task-id / seed branches; no domain logic outside adapters
- [ ] Did not edit generated files (e.g. `prompts/generated.ts`); changed the source instead
- [ ] Docs/copy updated if behavior or settings changed

## How to test

<!-- Commands you ran, fixtures touched, or manual steps to reproduce the result. -->

## Notes for the reviewer

<!-- Anything non-obvious: trade-offs, follow-ups deliberately left out, screenshots (redacted). -->
