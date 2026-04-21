# Prompt Management -- Topical Notes

## Sources

- Agentic Design Patterns, Ch 1 (Prompt Chaining), Appendix A (Advanced Prompting)
- Context Engineering for Multi-Agent Systems, Ch 1 (From Prompts to Context), Ch 6 (Summarizer)
- Designing Multi-Agent Systems, Ch 4.5 (Structured Output)

## Book Insights

1. **Prompt quality is a system artifact** -- prompts should be versioned, tested, and
   governed like code, not scattered as inline strings.
   (Source: Gulli Ch 1, Rothman Ch 1)

2. **Role boundaries reduce overlap** -- each agent role (executor, planner, verifier,
   perception) should have a distinct prompt with minimal instruction duplication.
   (Source: Rothman Ch 4 -- specialist agents with clear separation)

3. **Context load must be managed** -- large dynamic sections (DOM snapshots, full history)
   reduce model focus. Prioritize actionable state, suppress repetitive low-signal content.
   (Source: Rothman Ch 6 -- Summarizer agent, Gulli Ch 8 -- Memory Management)

4. **Structured output schemas** -- define expected output format (tool calls, JSON)
   explicitly. The model follows schemas more reliably than free-text instructions.
   (Source: Dibia Ch 4.5 -- "The Key to Reliable Agents")

## Where We Applied It

### Centralized Prompt Registry
- `src/prompts/` -- compiled prompt registry
- `prompts/runtime/agent/` -- agent system prompt
- `prompts/runtime/orchestrator/` -- orchestrator prompts
- `prompts/runtime/perception/` -- perception prompt template
- `prompts/runtime/planner/` -- planner decomposition prompt
- `prompts/runtime/reflections/` -- verification/reflection prompts
- `npm run prompts:build` / `npm run prompts:check` -- build and lint

### Role-Specific Personas
- `EXECUTOR_PERSONA` -- focused on action execution, tool use
- `PLANNER_PERSONA` -- focused on task decomposition, strategic thinking
- Perception prompt: unified 5-section format (LOCATION/CHANGES/BLOCKERS/VISUAL-ONLY/AFFORDANCES)
- Verifier prompt: focused on evidence assessment, pass/fail criteria

### Context Management
- `src/background/agent/context.ts` -- `ContextManager`
  - System prompt is static (cacheable via API prefix caching)
  - Dynamic sections assembled per-turn: perception, DOM, history, plan
  - 4 compression levels prevent context bloat
- `src/background/perception/perception-agent.ts`
  - Template variable: `{{priorObservations}}` -- last 5 entries full, overflow compressed
  - Template variable: `{{langNote}}` -- cross-lingual hint when page is non-English

### Structured Tool Schemas
- `ToolDefinition` type -- OpenAI function-calling format
- Parameter names synchronized across: LLM schema, TypeScript types, content script executor
- `tool_choice: "auto"` sent when tools present in API payload

## What We Learned

1. **Centralization eliminated drift** -- before the prompt registry, runtime prompts
   and eval prompts diverged silently. After centralization, changes propagate automatically.
   (RFC: Notion entry for "Centralized Prompt Management")

2. **The natural language rewrite** was the single biggest win: rewriting all 42 E2E
   prompts from structured templates to natural language improved pass rate from
   71% to 92%. This contradicts the "be structured" advice -- the model responds
   better to natural task descriptions than rigid format.
   (Evidence grade: A, Source: `lab/e2e-reports/natural-v2/_summary.md`)

3. **Tool descriptions matter more than system prompt** -- shortening tool descriptions
   (~300-450 tokens/turn saved) improved tool-call accuracy, not just cost. Less noise
   in the tool list = better tool selection.

4. **Prompt versioning gap** -- we still don't attach prompt hash to traces. The book
   recommends this (Rothman Ch 4 -- Execution Tracer). This means we can't replay
   exact conditions from old traces.

## Open Questions

1. Should runtime prompt updates be gated behind explicit prompt bundle versions?
2. How to A/B test prompt changes systematically given executor nondeterminism?
3. Should the perception prompt be model-specific (different formats for grok vs gpt)?

## Mapping

- RFC (Notion): `Centralized Prompt Management`
- Code: `src/background/agent/context.ts`, `src/prompts/`, `src/background/perception/`
- Prompts: `prompts/runtime/`
