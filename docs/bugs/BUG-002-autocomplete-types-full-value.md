# BUG-002: Executor types full value into autocomplete fields instead of selecting from dropdown

**Severity**: Medium
**Component**: Executor model behavior + planner interaction patterns
**Test**: `tests/e2e/autocomplete.test.ts`
**Prompt**: "Fill in the address with '123 Main Street, Springfield, IL 62704' from the suggestions, and search for 'Laptop Stand' in the product search."
**Status**: Open

## Observed behavior

The agent types the complete address `"123 Main Street, Springfield, IL 62704"` directly into the input field. The autocomplete dropdown appears (the DOM settle mechanism detects it: "N new elements appeared after typing"), but the agent ignores the suggestions and commits the typed value.

The fixture requires click-based selection — `selectedAddress` state is only set by the dropdown click handler (`selectAddress()`), not by typing. So `window.autocompleteResult.address` stays empty even though the input shows the correct text.

## Evidence

Report `docs/e2e-reports/natural-v2/autocomplete.md`:
```
addressInput: "123 Main Street, Springfield, IL 62704"  ← typed directly
productInput: "Laptop Stand"                            ← typed directly
autocompleteResult.address: ""                          ← never selected from dropdown
autocompleteResult.product: ""                          ← never selected from dropdown
```

The fixture (`tests/e2e/fixtures/online-shop-pro/src/routes/autocomplete.tsx`):
- Address suggestions appear after 300ms debounce when input length >= 2
- `selectedAddress` is ONLY set by clicking a dropdown option (line 64-69)
- The test checks `autocompleteResult.address` which reads from `selectedAddress`

## Root cause

**Planner produces a goal, not a procedure**: The planner creates a step "Select the address suggestion for 123 Main Street..." — this is semantically correct but doesn't decompose the timing-dependent interaction sequence.

**Executor takes the shortest path**: The model has the full address in the prompt. Typing it directly is faster than partial-type → wait → click. The model optimizes for efficiency, not for the fixture's state management.

**DOM settle message is informational, not directive enough**: After Fix 4, the message says "IMPORTANT: Do NOT type the full value — select the matching option from the dropdown by clicking it." But by the time this fires, the model has already typed the full value on the previous turn.

**Interaction pattern prompt not effective**: Fix C added autocomplete patterns to `decompose_system.md` ("Type PARTIAL text, wait for dropdown, click suggestion"). The planner may or may not produce 3 micro-steps from this — and even if it does, the executor model still types the full value in the "type partial text" step.

## Possible fixes

1. **type_text tool guard**: When typing into an input that has autocomplete-like behavior (detected via `autocomplete` attribute, or `role="combobox"`, or recent DOM settle showing dropdown), truncate the typed value to the first few characters and warn the executor to wait for and click suggestions.

2. **Planner micro-step enforcement**: The planner prompt patterns are advisory. Make them mandatory by detecting "suggestions" or "autocomplete" in the query and forcing a 3-step decomposition at the orchestrator level (not just the planner prompt).

3. **Fixture-aware testing**: Accept that some fixtures require specific interaction patterns that natural prompts can't convey. The autocomplete fixture is testing a specific UI pattern, not a natural task. Consider whether the test assertion should accept typed values OR dropdown selections.

4. **Post-type_text intervention**: When the DOM settle detects a dropdown AND the typed value matches a suggestion, auto-click the matching suggestion element. This is aggressive but would solve the specific autocomplete interaction gap.

## Reproduction

```bash
npm run test:e2e:progressive -- autocomplete
```

## Related

- Report: `docs/e2e-reports/natural-v2/autocomplete.md`
- Fixture: `tests/e2e/fixtures/online-shop-pro/src/routes/autocomplete.tsx`
- DOM settle (Fix 4): `src/background/agent/loop.ts` ~line 6669
- Planner patterns (Fix C): `prompts/runtime/planner/decompose_system.md` (INTERACTION PATTERNS section)
