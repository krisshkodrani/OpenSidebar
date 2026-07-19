# Token Economics & Planner Quality Analysis — 2026-07-18

Analysis of ~970 executor LLM calls (Jul 15–18 traces) and 93 planner calls /
86 structured plan decompositions (trace-index.sqlite, full history). Produced
during the `feat/pi-backend` executor-eval cycle; run data is dominated by the
staged e2e suites and the live refurbed application takes.

## 1. Seat breakdown: the executor is ~100% of spend

- All 153 recent sessions emitted `internal_planning_disabled` — the
  orchestrator sets `disableInternalPlanning: true` for every role
  (`orchestrator/contracts.ts:buildRoleExecutionContract`), so the in-loop
  `TaskPlanner` never runs; decomposition is orchestrator-side only.
- Planner seat (glm-5p2) totals across 93 decompositions: 220K in / 74K out —
  ≈3.5% of executor volume. Judge fires only on high-risk completions and did
  not appear at all in this window.
- Conclusion: streamlining the executor is streamlining the system.

## 2. Executor request anatomy (take-5 refurbed run, 53 turns, qwen3p7-plus)

| Metric | Value |
| --- | --- |
| Input per request | ~23.6K tokens, **flat** across all 53 turns (20.1K–26.9K) |
| Output per request | ~216 avg; 11.5K total vs 1.25M input → input is 99.1% of volume |
| Cache hit | 41% overall, **capped at exactly 12,288 tokens** on every hitting turn |

The flat input curve means per-turn history compression works. The request is
rebuilt each turn as 3 messages (system + history digest + short user), with
the page state embedded **inside the system message**
(`agent/context.ts:constructSystemMessage`).

Composition of one ~23.6K request: ~12.3K stable instructions+persona,
then task/plan/notes, page context incl. the per-turn turn-budget counter,
last-action outcome, ~30 visible elements (~1.2K), page content (~1.7K),
page interpretation, screenshot (~765 tok), history digest (~4.5K).

## 3. Why cache stalls at 12,288

Fireworks prefix caching is positional. The `{{cacheBreakpoint}}` sits after
instructions+persona (~12,288 tok); the first post-breakpoint content (turn
budget, last-action outcome, snapshot) changes every turn, so nothing after it
can ever cache — including content that did NOT change. Measured waste:

- Page content was byte-identical for all 53 turns (6,668 chars ≈ 1.7K tok)
  → ~88K tokens (7% of the run) of literally unchanged text re-billed.
- ~8 turns had cache=0 despite an identical prefix → Fireworks-side eviction.

## 4. Executor model comparison (Jul 15–18, same harness)

| model | calls | in/call | out/call | lat p50 | lat p90 | cache hit |
| --- | --- | --- | --- | --- | --- | --- |
| qwen3p7-plus | 357 | 17.9K | 210 | **1.06s** | 3.0s | 11% (41% on take 5) |
| minimax-m3 | 303 | 16.7K | 274 | 2.2s | 5.2s | 16% |
| kimi-k2p7-code | 306 | 18.5K | **135** | 2.9s | 8.2s | **40%** |

- qwen is 2–2.7× faster per call; kimi is the tersest (135 out/call) and gets
  the warmest cache; minimax is the chattiest (274 out/call).
- Input volume is dictated by our prompt, not the model (±10%). Output is
  economically irrelevant (<1% of volume).

### 4b. EVAL CORRECTION: qwen's medium-tier "failure" was infrastructure

Every one of the 12 error sessions in this window carries
`LLM API Error (503): no healthy upstream` — Fireworks' qwen3p7-plus pool,
zero tokens generated. This includes BOTH online-shop eval runs (`881e3dbb`,
`762c6e3e`): node 1 hit 503 on all 3 retries and the remaining plan nodes
collapsed as `unsatisfiable_dependencies`. The model never produced a token.

→ qwen3p7-plus's medium score is 18/19 **with the single miss being provider
capacity, not model behavior**. The same 503 killed take-5 attempt 2 on
Jul 18. qwen's real risk is deployment thinness, not capability.

## 5. Executor streamlining levers (ranked)

1. **Cut the verification tail** (~24% of take-5: turns ~42–54 were pure
   re-`read_element` of already-confirmed fields at 23.6K/turn ≈ 300K tok).
   → LP-17 Layer 1 fill-checklist. Turn count IS the cost model.
2. **Dedupe unchanged page content** (~7%): hash page content per turn; when
   unchanged send an "unchanged since turn N" marker. Extendable to the
   elements block later (riskier — tags are the action surface).
3. **Extend the stable prefix** (free-ish): move the turn-budget counter and
   last-action outcome to the end of the prompt; hoist task/plan-instructions
   (stable per run) before the breakpoint → cache frontier ~12.3K → ~14–15K.
4. **Messages-native layout** (structural): page state in the newest user
   message + append-only history could reach ~80% hit — BUT input then grows
   per turn instead of staying flat, and Fireworks' cache benefit is primarily
   TTFT latency, not (confirmed) billing discount. Verify Fireworks' cached
   input pricing before investing; levers 1–3 pay off regardless.
5. Output tokens: nothing to do (<1% of volume).

## 6. Planner/orchestrator quality (86 structured plans, full history)

Shape: 64/86 plans (74%) are single-node; multi-node: 3–6 nodes.
Difficulty labels: 40 simple / 35 moderate / 11 complex.

### What it does well

- **Node prompts are well-shaped**: every node objective ships with explicit
  Success criteria plus "Planner assumptions (validate against current page
  before acting)" — executors get grounded, verifiable contracts.
- **Read-before-act on unknown pages**: "Can you complete this challenge?" →
  read/understand → first action → continue-until-done. Correct structure for
  an unobserved page.
- **Conditional plans honor escape hatches**: "Generate a report and submit
  it. If that is not possible, tell me why" → inspect → conditional act →
  verify-or-explain. The user's fallback branch survives decomposition.
- **Skill selection is mostly apt** (structured-form-fill,
  navigate-read-return, paginated-record-lookup match their tasks).

### Failure modes (graded against the runs)

1. **Over-decomposition of sequential UI work** (the big one). "Order 2 shoes
   + coupon + express + checkout" → 5 serialized nodes; even "add ONE shoe to
   cart + coupon + checkout" → 4 nodes. Every node spawns a fresh executor
   session (~12–35K tokens of fresh context each; a trivial verify node cost
   11.6K). Serialized nodes on the same page/form with no parallelism and no
   distinct skill add pure overhead AND fragility (see #3).
2. **Redundant trailing verify nodes**: warehouse-counts plan appended
   "Return to warehouse alpha and verify that page is visible" AFTER the
   answer was already reported — a whole extra session for nothing.
3. **Dependency chains amplify single-node failures**: the 5-node shoe order
   died entirely (0 tokens) because node 1 hit the 503 and nodes 2–5 collapsed
   as `unsatisfiable_dependencies`. A single-node plan would have kept
   retrying/escalating inside one session. Chain depth = blast radius.
4. **Difficulty inflation**: simple 2–3-action tasks labeled complex
   (11 "complex" labels concentrate on catalog/cart tasks).
5. **Resource-hint "repair" pass emits garbage**: prompt fragments shredded
   into fake resource keys (`form: do-not-submit-the-form`,
   `form: when-every-listed-field`, `form: if-the-file-input`) with
   `access: approval`. Harmless in serialized mode, but it is noise feeding
   the scheduler/approval machinery, and it degrades trace legibility.
6. **Planner latency is the hidden cost, not tokens**: glm-5p2 decomposition
   p50 8.2s, p90 39s, max 62s; 2/93 calls hit the 4,096-token output cap
   (truncated JSON → repair path). Take-5 spent 53s planning a
   **single-node** plan — ~12% of wall clock before the first action.

### Verdict

The planner's *language* is good (objectives, criteria, assumptions) but its
*graph-shape judgment* is weak: it over-splits sequential same-page work,
appends ceremonial verify nodes, and pays 8–60s of glm-5p2 thinking even when
the answer is "one node". Given 74% of real plans end up single-node anyway,
the cheapest wins are: (a) a fast single-node short-circuit (heuristic or
small-model pre-check) so simple tasks skip the 8–60s decompose; (b) a
collapse pass that merges serialized same-page/same-skill nodes; (c) drop
trailing verify-only nodes (the executor's done() gate already verifies);
(d) cap/clean the resource-hint repair pass.

## Data sources

- `traces/*.jsonl` agent.turn records (llmRequest/llmResponse.usage)
- `.artifacts/trace-index.sqlite`: `trace_run_events`
  (`plan_decomposed`, `planner_llm_call`, `node_failure_attribution`),
  `trace_sessions` (per-node objectives, outcomes, failureDetail)
- Take-5 run: session `bd19ff2b`, run `8f62e787` (2026-07-18)
