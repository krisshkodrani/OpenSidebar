# RFC: Autocomplete Guard — Fall Back to Original Query for Intent Detection

**Status**: Draft (v2 — revised after code review)
**Date**: 2026-04-10
**Author**: Agent session
**Reviewer**: Codex
**Affects**: `src/background/agent/loop.ts` (`rewriteAutocompleteTextEntry` and its call sites)

## Problem

BUG-002 fix (autocomplete type_text guard) successfully truncates the address field input — the agent types partial text, waits for the dropdown, and clicks the correct suggestion. But the product search field still gets the full value typed directly.

**Root cause**: `indicatesAutocompleteSelectionIntent()` checks the current plan step's objective for keywords like "suggestion", "autocomplete", "typeahead", "dropdown". The planner produces:

- Address step: `"Select the address **suggestion** for 123 Main Street..."` → matches → guard fires
- Product step: `"Search for Laptop Stand in the product search field"` → no keyword match → guard skipped

The element detection (`isAutocompleteLikeElement()`) correctly identifies BOTH fields as autocomplete-like (both have `placeholder` containing "search"/"typing" and `autoComplete="off"`). The gap is purely in the intent check — the planner doesn't always propagate autocomplete wording into every step objective.

## Evidence

From the E2E report `docs/e2e-reports/natural-v2/autocomplete.md`:
```
addressConfirmed: "Selected: 123 Main Street, Springfield, IL 62704"  ← WORKED
productConfirmed: ""                                                   ← FAILED
autocompleteResult.address: "123 Main Street, Springfield, IL 62704"  ← WORKED
autocompleteResult.product: ""                                         ← FAILED
```

The executor step label confirms: `"Executor: Type "Laptop Stand" into "Type to search products.…" input"` — full value typed, no truncation.

## Proposed Fix

When the step objective doesn't indicate autocomplete intent, fall back to checking the **original user query** as a secondary signal. This is explicitly a **fallback**, not a precedence change — the step objective remains the primary source of intent.

### Safety model

The rewrite guard has **two independent gates** that must BOTH pass:

1. **Element classification** (`isAutocompleteLikeElement`) — the primary safety boundary. Checks `role="combobox"`, `aria-autocomplete`, `list`, placeholder text containing "suggest"/"search"/"typeahead", etc. **If the element is a normal text input, the guard never fires regardless of intent.**
2. **Intent detection** (`indicatesAutocompleteSelectionIntent`) — confirms the task actually involves selecting from suggestions. Checks for "suggestion", "autocomplete", "typeahead", "dropdown" keywords.

This RFC only widens the **intent** gate's input (step objective → step objective OR original query). The **element** gate is untouched and remains the hard boundary that prevents rewriting normal text fields.

In other words: "the user's query mentioned suggestions once" is NOT sufficient to trigger a rewrite. The target element must independently look like an autocomplete field.

### Change to `rewriteAutocompleteTextEntry()`

Add `originalQuery` as a fallback-only parameter:

```typescript
export function rewriteAutocompleteTextEntry(params: {
  objectiveText: string;
  originalQuery: string;  // NEW — fallback only
  element: DomSnapshot["elements"][number] | null | undefined;
  typedText: string;
}): { rewrittenText: string; reason: string } | null {
  const { objectiveText, originalQuery, element, typedText } = params;
  const trimmed = typedText.trim();
  if (trimmed.length < 4) return null;
  
  // Intent check: step objective is the primary source.
  // Original query is a fallback for when the planner dropped
  // the autocomplete wording from the active step's objective.
  if (
    !indicatesAutocompleteSelectionIntent(objectiveText) &&
    !indicatesAutocompleteSelectionIntent(originalQuery)
  ) return null;
  
  // Element classification: the hard safety boundary.
  // Even if intent is detected, normal text inputs are never rewritten.
  if (!isAutocompleteLikeElement(element)) return null;
  
  // ... rest unchanged
}
```

### Change to call sites

Both call sites in `loop.ts` already have access to `this.originalQuery`. Add it to the params:

```typescript
const rewrite = rewriteAutocompleteTextEntry({
  objectiveText: activeObjective,
  originalQuery: this.originalQuery,  // NEW
  element: target,
  typedText: String(args.text || ""),
});
```

### What this does NOT change

- `isAutocompleteLikeElement()` — unchanged, remains the primary safety boundary
- `indicatesAutocompleteSelectionIntent()` — unchanged function, just called on an additional input
- `buildAutocompletePrefix()` — unchanged
- The truncation behavior — same prefix logic
- Step objective as primary intent source — still checked first
- Existing address field behavior — still works via step objective match

## Tests

### Required unit tests

**Positive: query fallback fires for autocomplete element** (the fix target)
```typescript
test("rewriteAutocompleteTextEntry falls back to original query for autocomplete element", () => {
  const result = rewriteAutocompleteTextEntry({
    objectiveText: "Search for Laptop Stand in the product search field",
    originalQuery: "Fill in the address from the suggestions, and search for Laptop Stand",
    element: makeInput({ placeholder: "Type to search products..." }),
    typedText: "Laptop Stand",
  });
  expect(result).not.toBeNull();
  expect(result!.rewrittenText.length).toBeLessThan("Laptop Stand".length);
});
```

**Negative: query fallback does NOT fire for normal text input** (regression guard)
```typescript
test("rewriteAutocompleteTextEntry does not rewrite normal input even when query mentions suggestions", () => {
  const result = rewriteAutocompleteTextEntry({
    objectiveText: "Type the shipping address into the form",
    originalQuery: "Fill in the address from the suggestions, then enter your phone number",
    element: makeInput({ placeholder: "Phone number", type: "tel" }),
    typedText: "555-0123",
  });
  expect(result).toBeNull();
});
```

This negative test confirms that a normal field (phone number) is never rewritten even though the original query mentions "suggestions" — because `isAutocompleteLikeElement()` rejects it.

**Existing tests**: Update to pass `originalQuery` parameter (can be empty string for existing cases since they already match via `objectiveText`).

### E2E confirmation

```bash
npm run test:e2e:progressive -- autocomplete
```

## Estimated impact

- ~5 lines changed in `rewriteAutocompleteTextEntry`
- ~2 lines changed at each call site (add `originalQuery` param)
- 2 new unit tests (1 positive, 1 negative regression)
- Existing tests updated to pass new param

## Decision

- [ ] Approved
- [ ] Approved with modifications: ___
- [ ] Rejected — reason: ___
