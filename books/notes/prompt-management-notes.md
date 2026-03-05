# Prompt Management Notes

## Sources

- `books/Agentic-Design-Patterns.pdf`
- `books/Context-Engineering-for-Multi-Agent-Systems.pdf`
- `books/Designing-Multi-Agent-Systems.pdf`

## Key Insights

1. Prompt quality should be governed as a system artifact, not scattered inline text.
2. Multi-agent reliability depends on explicit role boundaries and minimal overlap.
3. Context load should prioritize actionable state and suppress repetitive low-signal content.
4. Evaluation loops are strongest when runtime prompts and eval prompts are versioned together.

## Implications for OpenSidebar

1. Fragmented prompt ownership creates drift between runtime behavior and eval coverage.
2. Duplicated policy blocks across orchestrator and executor increase instruction conflicts.
3. Large dynamic context sections reduce model focus and degrade tool-calling precision.

## Proposed Changes

1. Centralize prompts under root `prompts/` and compile to generated runtime artifacts.
2. Attach prompt id/version/hash to runtime traces and eval runs.
3. Reduce duplicated instruction layers and keep a single canonical policy source per role.
4. Add lint/CI checks to prevent new hardcoded prompt blobs.

## Mapping

- RFC:
  - `docs/rfc/rfc-centralized-prompt-management.md`
- Code targets:
  - `src/background/agent/context.ts`
  - `src/background/agent/guardian.ts`
  - `src/background/agent/loop.ts`
  - `src/background/orchestrator/handoff.ts`
  - `src/prompts/registry.ts`
  - `evals/judge.ts`
- Future prompt source:
  - `prompts/`

## Open Questions

1. Should runtime prompt updates be gated behind explicit prompt bundle versions?
2. Should evals pin prompt bundle hashes by default to guarantee exact replay?
