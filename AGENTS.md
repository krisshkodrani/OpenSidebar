# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project Shape

OpenSidebar is a browser-agent Chrome extension with a small monorepo around it.

Key areas:

- `apps/extension/src/background`: the main agent runtime, including the orchestrator, agent loop, tools, LLM client, skills, checkpoints, and durability logic.
- `apps/extension/src/content`: content-script code and page bridge logic.
- `apps/extension/src/sidepanel`: the extension UI used to start and monitor tasks.
- `apps/extension/src/shared/`: shared React UI components (used by both sidepanel and overlay harness).
- `apps/extension/src/adapters/`: BrowserAdapter implementations (chrome, playwright, mock) for decoupled environment I/O.
- `apps/extension/src/trace-viewer`: the trace viewer and analytics UI.
- `apps/extension/tests/background`: focused runtime and orchestrator tests.
- `apps/extension/tests/e2e`: fixture-driven E2E tests for real browser behavior.
- `scripts/run-e2e-staged.ts`: the staged E2E runner for `easy`, `medium`, and `hard`.
- `traces/runs`: recorded trace sessions produced by E2E and debugging runs.

Repo policy:

- Keep stable product docs in `docs/`.
- Keep runtime artifacts local under `.artifacts/`.
- RFCs, investigations, and research notes live outside the repo.
- If Notion is available, send archive-bound notes, reports, RFCs, and research writeups there directly instead of keeping them in git.
- If a real product bug, follow-up task, or cleanup need is identified during work and is not being fixed immediately, create a GitHub issue for it when GitHub tools are available.

## Harness Architecture Direction (RFC-012 Draft)

OpenSidebar is evaluating a dual-environment model:

- **Extension (production):** Chrome sidepanel + chromeAdapter. Uses `chrome.tabs`, `chrome.scripting`, `chrome.storage`, `chrome.runtime`.
- **Overlay (testing):** Draggable panel injected into any page via Playwright + playwrightAdapter. Uses `page.evaluate()`, `page.screenshot()`, in-memory storage.
- **Headless (CI):** No UI. agent-core + mockAdapter. Trajectory output only.

The target direction is for the same agent-core to run identically across all three. The shared React UI (sidepanel components) would power both the extension sidepanel and the overlay. A `BrowserAdapter` interface would abstract environment-specific I/O.

Draft design constraints to preserve while RFC-012 is under review:

- Sidepanel/UI components must NOT import `chrome.*` APIs directly. Use the bridge abstraction or adapter. Chrome APIs belong in the adapter layer only.
- Agent-core (background) changes should avoid making a future overlay/headless adapter harder.
- Trajectories should avoid Chrome-specific fields when the data is intended for cross-environment replay.

## Default Change Placement

Prefer these locations when making changes:

- Put agent behavior changes in the product runtime first, usually under `apps/extension/src/background`.
- Put page interaction fixes in reusable runtime policy, controllers, or skills before considering test changes.
- Keep content-script and bridge fixes in `apps/extension/src/content` or background tool/bridge code, not in fixtures.
- **E2E test harness (fixtures):** Keep thin. It may configure the environment, seed minimal state, collect diagnostics, and assert results, but it must not contain product logic.
- **Overlay harness (RFC-012 draft):** If approved, this should be treated as product code rather than a throwaway test utility. Until approved, avoid adding hard dependencies on it.
- Use skills when a workflow pattern is stable and reusable across sites or tasks.
- Use test-only instrumentation only when it is pure observability or minimal state injection needed for determinism.
- Do not add repo-backed research workflows, vendored agent repos, or note-taking systems to the product tree.

## Development Discipline

These rules bias toward small, verifiable, product-quality changes. They align with the four coding-agent principles often summarized as: think before coding, simplicity first, surgical changes, and goal-driven execution.

Use these principles as operating discipline, not slogans. They are strongest when combined: an agent should surface ambiguity before acting, choose the smallest viable design, limit the diff to the task, and verify against a concrete goal. The main failure mode is applying one principle in isolation, such as using "simplicity" to skip necessary edge cases, or "goal-driven execution" to overfit a test while missing the product behavior.

Use judgment for trivial tasks, but do not trade correctness for speed.

### Think Before Coding

Before implementing, identify the user-visible goal and any assumptions that affect behavior. Instead of silently making assumptions, surface meaningful ambiguity, state assumptions explicitly, and ask for clarification when the wrong assumption would be costly.

- State important assumptions when they affect the solution.
- If multiple interpretations are plausible and the wrong choice would be costly, ask before editing.
- If a reasonable low-risk assumption exists, proceed and mention it.
- Surface tradeoffs when choosing between a narrow fix, a broader runtime fix, or a test-only change.
- Push back on approaches that add complexity, fixture-specific behavior, or brittle shortcuts.

### Simplicity First

Implement the minimum product change that satisfies the request. Prefer the least code that solves the real problem without overengineering, speculative abstractions, or unnecessary features.

- Do not add features, configuration, abstraction, or generalized frameworks unless the request or existing design clearly calls for them.
- Prefer existing helpers, patterns, and boundaries over new mechanisms.
- Avoid defensive code for states that cannot occur unless there is evidence they do occur.
- If the implementation grows large, pause and look for a smaller design before continuing.

### Surgical Changes

Keep diffs tightly tied to the task. Do not "improve" adjacent code, refactor unrelated sections, or change formatting unless it is required for the task.

- Touch only files needed for the requested behavior.
- Do not reformat, rename, reorganize, or clean up adjacent code unless required by the change.
- Match existing style even when it is not your preferred style.
- Remove imports, variables, functions, tests, or comments made obsolete by your own change.
- Do not remove pre-existing dead code or unrelated behavior unless explicitly asked.
- If you notice unrelated cleanup or a real product bug, mention it or create a GitHub issue when appropriate.

Every changed line should have a clear reason connected to the user request or necessary verification.

### Goal-Driven Execution

Turn work into verifiable outcomes. Prefer clear success criteria over vague activity, then loop until the stated goal is verified by the narrowest relevant check.

- For bug fixes, prefer a focused reproduction or regression test before or alongside the fix.
- For behavior changes, verify the observable behavior, not just internal planner artifacts.
- For refactors, preserve behavior and run the narrowest relevant tests.
- For E2E/runtime failures, follow the repository triage order: identify the general runtime cause, confirm it, fix product behavior, add or update the narrowest regression test, then rerun the isolated case.

For multi-step work, use a short plan with verification points when it improves clarity:

```md
1. Identify failing behavior -> verify with trace, focused test, or reproduction.
2. Make the smallest runtime/product fix -> verify the targeted case.
3. Run the narrowest relevant test suite -> broaden only if needed.
```

Strong success criteria should let the agent continue independently. Weak or ambiguous criteria should be clarified before large edits.

## Code Review Workflow

When implementing non-trivial code changes, use this workflow:

1. Implement the requested change.
2. Run the relevant tests/typechecks/lints.
3. Call the DeepSeek MCP reviewer on the final diff.
4. Treat DeepSeek as an adversarial reviewer and second-opinion doctor, not as an automatic author or final authority.
5. For each DeepSeek finding:
   - **Accept** if it identifies a concrete bug, missed edge case, security issue, brittle selector, race condition, or maintainability problem.
   - **Reject** if it is style-only, speculative, increases complexity without clear benefit, or conflicts with stronger local evidence and Codex is confident in the implementation.
6. Apply accepted fixes.
7. Re-run tests.
8. Summarize:
   - what was implemented,
   - what DeepSeek found,
   - what was accepted/rejected,
   - final test result.

### When to skip the review

Skip the review workflow for:

- Single-line or trivial fixes (e.g., typo corrections, comment updates, log-level changes).
- Changes under ~30 net lines of code with no structural or behavioral impact.
- Purely mechanical changes (e.g., renaming a symbol consistently across the codebase with no logic changes).

When in doubt, run the review.

### Reviewer fallback

If the DeepSeek MCP reviewer is unavailable (e.g., down, rate-limited, or returns empty results):

- Self-review the diff against the same [reviewer focus list](#deepseek-reviewer-focus).
- Note the unavailability and self-review result in the summary.
- The agreement gate still applies: tests must pass, and any self-identified issues must be addressed or explicitly rejected with reasoning.

### DeepSeek reviewer focus

Ask DeepSeek to review especially for:

- correctness bugs
- async/race conditions
- TypeScript type issues
- browser automation brittleness
- selector fragility
- SPA re-render timing problems
- missing act-check-act verification
- security/session/auth mistakes
- unnecessary complexity

### Agreement gate

Do not merge or finalize until:

- tests pass, and
- either DeepSeek approves, or Codex explicitly explains why remaining DeepSeek objections are rejected. DeepSeek is advisory; a confident Codex rejection is acceptable when supported by tests, code context, and concrete reasoning.

## Product And E2E Design Rules

When working on runtime behavior, skills, prompts, or E2E-related failures, follow these rules:

1. Solutions must target real product behavior, not just the current E2E fixture.
2. The harness must stay thin and should only observe, seed minimal state, or assert outcomes.
3. Domain behavior should live in runtime policy, reusable controllers, or skills, not in test-only branches.
4. When a repeated workflow has a stable structure, prefer a generic skill over ad hoc prompt tweaks.
5. Skills should encode reusable sequencing, evidence expectations, and tool discipline, not fixture-specific shortcuts.
6. A skill must never depend on test-only selectors, hardcoded fixture text, or hidden knowledge from the E2E.
7. Planner or verifier estimates must not be treated as execution truth when they can be wrong.
8. Heuristic gates may warn, rank, or defer, but they should not silently convert future work into failure without direct evidence.
9. Prompts should sound like natural user requests, with normal language and concrete intent.
10. Prompts should avoid unnatural scaffolding, keyword stuffing, or wording chosen only to trigger a particular tool path.
11. When a task fails, the first fix should be the most general runtime cause, not the narrowest test symptom.
12. If a generic fix exposes the next bottleneck, keep following the bottlenecks in order instead of patching around them in the harness.
13. Recovery paths must be sincere: if state is uncertain, the system should say so and re-ground, not pretend it still knows.
14. Evaluation should be fair: a task is successful only when the real user objective is met, not when intermediate planner artifacts look good.
15. Any optimization for long tasks should preserve correctness first, then reduce cost or turns second.
16. If a behavior is useful outside E2E, it belongs in the product. If it is useful only inside E2E, it belongs nowhere unless it is pure test instrumentation.
17. Sidepanel UI components must be environment-agnostic. Do not call `chrome.*` APIs directly inside components — use the bridge abstraction for message passing and persistence. This keeps the shared React app portable between sidepanel (chromeAdapter) and overlay (playwrightAdapter).
18. Trajectories must be environment-agnostic. Record tool calls, observations, and step labels in a format that replays identically across adapters. Do not include Chrome-specific fields (tab ID references, `chrome.storage` keys) in trajectory entries intended for replay.

## Prompt And Skill Guidance

- Prefer natural prompts in fixtures and tests. They should read like normal user requests, not activation phrases for a specific tool.
- Do not encode fixture-specific hidden knowledge into prompts, skills, or runtime policy.
- Prefer generic skills with reusable sequencing, evidence rules, and tool discipline.
- If a skill guess is weak, bias toward soft guidance such as ranking or prompt framing rather than hard suppression.
- If a repeated workflow is expensive or brittle, first look for a reusable skill or controller before adding special-case planner logic.

## E2E Workflow

- Prefer staged E2E execution through `scripts/run-e2e-staged.ts`.
- Run `easy` before `medium`, and `medium` before `hard`, unless the task is explicitly scoped to a single failing test.
- When a staged run fails, debug the first clean, high-signal failure before spending tokens on later suites.
- Re-run isolated E2E files when iterating on a specific failure.
- Generated E2E reports belong in `.artifacts/e2e/`, not `docs/`.

### Which environment to use

- **WorkArena tasks** (ServiceNow, Notion) → use the staged E2E runner (`npm run test:e2e:staged`). These target benchmark fidelity and regression detection.
- **Generic site tasks** (arbitrary pages) → use the Playwright harness. These target product correctness on real-world pages outside benchmarks.
- **CI / headless** → mockAdapter. These target unit-level behavior and should run fast without a browser.
- When fixing an agent-core bug, prefer verification that covers both benchmark-style WorkArena behavior and a generic non-WorkArena case when practical.

Useful commands:

- `npm run build`
- `npm run test`
- `npm run test:e2e:easy`
- `npm run test:e2e:medium`
- `npm run test:e2e:hard`
- `npm run test:e2e:staged`

## E2E Runtime Defaults

The E2E harness defaults to:

- provider mode: `fireworks`
- lane: `dev`
- executor/planner model: the Fireworks default configured by the runtime unless explicitly overridden by environment variables

Relevant env vars include:

- `E2E_PROVIDER`
- `E2E_EXECUTOR_MODEL`
- `E2E_TEMPERATURE`
- `E2E_USE_VL_EXECUTOR`
- `E2E_DIAGNOSTIC`

Keep harness configuration minimal and prefer runtime fixes over provider-specific test branching.

## Failure Triage Order

When an E2E or runtime task fails, prefer this order:

1. Identify the most general runtime cause.
2. Confirm the failure in traces or focused tests.
3. Fix the product behavior in runtime policy, orchestration, bridge logic, or skills.
4. Add or update the narrowest regression test that proves the fix.
5. Re-run the isolated failing case before broader staged suites.

Do not start by patching the fixture or harness unless the failure is clearly caused by test infrastructure.

## E2E Report Format

When an agent runs the E2E suite or prepares an E2E summary report, create a dated markdown report under `.artifacts/e2e/` using this filename pattern:

- `.artifacts/e2e/e2e-report-YYYY-MM-DD.md`

Do not create or update a tracked `docs/e2e-report.md` or dated report in `docs/`.

The report should use this structure:

1. Title: `# E2E Final Report`
2. Date line
3. Scope line
4. Overall result line
5. A markdown table with these columns:
   - `Case`
   - `Success`
   - `Turns`
   - `Perceptions`
   - `Traces`
   - `Prompt used`
6. A short `## Metric Definitions` section
7. A short `## Stability Notes` section

Metric conventions:

- `Turns`: total recorded trace turns across the trace file(s) for that case.
- `Perceptions`: turns where the trace input included `Page Interpretation`.
- `Traces`: number of trace sessions produced for that case, including replans or retries.
- `Success`: whether the case completed successfully in the run.

Prefer concise prompts in the table: compact whitespace, preserve key literals, and keep the wording faithful to the actual test prompt.

### Alternative Detailed Format

For single-test or more detailed reports, use this extended structure:

1. Title with test name and date
2. Run section: test file, result, runtime, trace count, trace file
3. Prompt Used section
4. Summary table with additional columns: `Prompt style`, `Tool calls`, `Tool executions`, `Cost`, `Tokens`
5. Trace Details table: Trace ID, Turns, Model, LLM duration, token breakdown, cost
6. Tool Call Breakdown table
7. Event Counts table
8. Turn Sequence table
9. Outcome Notes section
