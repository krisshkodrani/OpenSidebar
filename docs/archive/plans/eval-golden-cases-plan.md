# Golden Case Expansion Plan

Date: 2026-04-01
Context: E2E test suite reached 40/40 (100%) pass rate. Most failures traced back to planner decomposition quality and prompt-sensitive LLM decisions. Current golden cases (13) only test single-turn tool selection — they don't cover decomposition or multi-step reasoning.

## Category A: Planner Decomposition Quality

These test the planner's `decompose()` output — given a query and page context, does it produce the right step structure?

### Eval format
- **Input:** query string + page title + page URL
- **Method:** Call `TaskPlanner.decompose()` and validate the returned steps
- **Validation:** Structural checks on step count, objective keywords, dependency chain, success criteria quality

### Cases

| # | Case | Input pattern | Expected structure | Pathology |
|---|------|--------------|-------------------|-----------|
| 1 | Round-trip detection | "Go to X, read data, return to Y, read data, report both" | Has return step + read steps for both targets | `missing_return_leg` |
| 2 | Multi-item ordering | "Add item A and item B, apply coupon, checkout" | Separate add-to-cart nodes per item | `under_decomposition` |
| 3 | Coupon as separate step | "Buy product, apply code SAVE10, checkout" | Coupon node (type + Apply + verify) separate from checkout | `missing_verification_step` |
| 4 | Over-decomposition guard | "Click the submit button" | Single node, not 3 | `over_decomposition` |
| 5 | Success criteria quality | "Add item, change quantity to 3" | Either combined node or Step 1 criteria doesn't contradict Step 2 | `contradictory_criteria` |
| 6 | Data collection completeness | "Read price from page A, rating from page B, report both" | Separate read nodes + report node mentioning both | `missing_data_collection` |
| 7 | Form fill granularity | "Fill registration form and submit" | One batch-fill node, not per-field | `over_decomposition_form` |
| 8 | Navigation + action sequencing | "Go to Settings, change email, save" | Sequential dependencies, not parallel | `missing_dependency` |

### Source traces
- Case 1: `traces/7e462f23-...` (go-back-navigation)
- Case 2: `traces/fa57ff21-...` (online-shop 2-item)
- Case 3: `traces/8c15b521-...` (online-shop natural 2-item, node 3)
- Cases 4-8: Synthesize from test prompts

## Category B: Prompt-Sensitive Agent/Verifier Decisions

These test single-turn LLM decisions that depend on specific prompt wording. Golden case format — replay conversation state, check tool output.

### Cases

| # | Case | Source | Decision point | Correct action | Pathology |
|---|------|--------|----------------|---------------|-----------|
| 1 | Pre-submit verification | online-shop natural 2-item, node 3, turn 2 | Page shows Discount: $0.00, Apply button visible, Place Order visible | Click Apply (not Place Order) | `premature_submit` |
| 2 | Verifier node acceptance | go-back-navigation, node 1 verification | Output: "Reached Beta", Objective: "Navigate Alpha to Beta", Task: full round-trip query | Accept (not retry) | `verifier_scope_leak` |
| 3 | Sub-node done scoping | online-shop quantity, node 1, turn 5 | Executor completed add-to-cart (qty 1), original query says "change qty to 3" | Call done() (not click +) | `scope_overshoot_subnode` |

### Source traces
- Case 1: `traces/8c15b521-c789-4788-833e-4a0070d2c6d4.jsonl` turn 2
- Case 2: Verifier input from go-back orchestrator logs (14:16:34)
- Case 3: `traces/fa57ff21-0f68-4edb-9b6b-634ae055cbb8.jsonl` turn 5

## Extraction Method

1. Read the source trace file
2. For Category A: extract the query and page context, call decompose(), validate step structure
3. For Category B: extract `llmRequest.messages` from the specific turn, set expected to the correct tool call
4. Save as JSON in `evals/golden/` following existing format

## Regression Value

These 11 cases protect against:
- Prompt changes that break decomposition quality (Category A)
- Prompt changes that break agent decision quality at critical moments (Category B)
- The specific bugs fixed in the 2026-04-01 E2E session

Without these, someone could edit the planner prompt, verifier prompt, or executor prompt and silently regress the fixes that took 40/40 pass rate from 28/42.
