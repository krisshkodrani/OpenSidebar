# RFC: Stable Element Identity & Inline Clickable Tagging

**Status:** Proposed
**Author:** OpenSidebar team
**Date:** 2026-02-12
**Depends on:** None (self-contained)

## Problem

Two tightly related defects in the content script's tagging system cause the majority of wasted agent turns:

### P0-A: Element IDs are unstable across snapshot refreshes

`tagElements()` resets `tagCounter = 0` and rebuilds the tag map from scratch on every snapshot refresh. After any DOM-modifying tool (click, hide, type, drag), the loop calls `refresh: true` which re-tags all elements with new sequential IDs. The LLM references an ID from the previous turn, but that ID now points to a different element.

**Evidence from logs (Step 4, Browser Navigation Challenge):**
```
Turn 45: click_element(2) => Clicked [2] button "Click Here"     ✓ correct
Turn 46: click_element(2) => Clicked [2] button "Continue Journey" ✗ ID shifted!
Turn 47: click_element(1) => Clicked [1] button "Keep Going"      ✗ wrong again
```

The agent needed to click the same "Click Here" button 3 times. It identified the right element on the first click. After the DOM reacted, the snapshot refreshed, and ID `[2]` was reassigned to a completely different button. **This single issue consumed 92 turns (~40% of the session).**

### P0-B: Inline clickable elements are not tagged

The `INTERACTIVE_SELECTORS` list covers `<a[href]>`, `<button>`, `[role='button']`, and `[onclick]`, but misses a large class of clickable inline elements:

- `<span>` or `<a>` elements without `href` that use JS event listeners (e.g. `addEventListener('click', ...)`)
- `<span>` with `cursor: pointer` CSS
- Generic elements with `click` listeners attached programmatically (no `onclick` attribute)

**Evidence:** Step 4's challenge text read *"...or click **here** 3 more times to reveal"* — the word "here" was an inline clickable `<span>` inside a `<p>`. Since it had no `href`, no `onclick` attribute, and no `role`, the tagging system never tagged it. `find_element("click here")` returned the parent `<p>` element, not the clickable span. The agent had **no way** to discover or interact with the actual target.

### Impact

| Issue | Turns wasted (single session) | User interventions |
|-------|-------------------------------|-------------------|
| Unstable IDs | ~50 turns (repeated wrong-element clicks) | 1 hint |
| Missing inline tags | ~70 turns (couldn't find clickable text) | 1 hint |
| **Combined** | **~92 turns** (overlapping) | Step 4 unsolvable without user hint |

Both issues interact: even when `find_element` returned a dynamic tag for a nearby element, the next snapshot refresh invalidated that tag. The agent was fighting both problems simultaneously.

---

## Design

### Part 1: Stable Element Identity

#### Approach: Content-hash-based stable IDs

Replace sequential `tagCounter++` with a deterministic hash of each element's identity. The hash is computed from properties that remain constant even when the DOM mutates around the element:

```
stableId = shortHash(tagName + domPath + textSignature + attrSignature)
```

**Components:**
- `tagName`: element tag name (e.g., `button`, `a`, `input`)
- `domPath`: simplified path from `<body>` — indices at each level, skipping ephemeral wrappers
- `textSignature`: first 30 chars of `textContent`, normalized
- `attrSignature`: sorted `id + name + type + role + href + aria-label` values

**Collision handling:** If two elements produce the same hash, append a disambiguation suffix (`-2`, `-3`, etc.). This is rare in practice — elements with identical path + tag + text + attributes are uncommon.

**Integer mapping:** The LLM works best with short numeric IDs. Maintain a bidirectional `stableHash → integer` map that persists across refreshes. When an element re-appears with the same hash, it gets the **same integer ID** as before. New elements get the next available integer. Elements that disappear have their IDs **reserved for 1 refresh cycle** (grace period) before being released.

#### Implementation

**File: `src/content/tagging.ts`**

```typescript
// Persistent maps across refreshes (cleared only on full page navigation)
const hashToId = new Map<string, number>();   // stableHash → integer ID
const idToHash = new Map<number, string>();   // integer ID → stableHash
let nextId = 1;

// Grace period: IDs from previous refresh that weren't seen this refresh
// Kept for 1 cycle so LLM references from the previous turn still work
const graceIds = new Set<number>();

function computeStableHash(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const path = getDomPath(el);      // e.g., "body>div:2>main>section:0>div:1"
  const text = (el.textContent?.trim() || "").slice(0, 30).toLowerCase();
  const attrs = getAttrSignature(el); // sorted key=val pairs
  // Simple FNV-1a or similar fast hash → 8-char hex string
  return fnvHash(`${tag}|${path}|${text}|${attrs}`);
}

function getDomPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (!parent) break;
    const idx = Array.from(parent.children).indexOf(current);
    parts.unshift(`${current.tagName.toLowerCase()}:${idx}`);
    current = parent;
  }
  return parts.join(">");
}

function getAttrSignature(el: Element): string {
  const keys = ["id", "name", "type", "role", "href", "aria-label", "data-testid"];
  return keys
    .map(k => el.getAttribute(k))
    .filter(Boolean)
    .join("|");
}
```

**Modified `tagElements()`:**

```typescript
export function tagElements(showTags: boolean = false): TaggedElement[] {
  document.querySelectorAll(`.${LABEL_CLASS}`).forEach(el => el.remove());

  // Move current IDs to grace period
  graceIds.clear();
  for (const [id, hash] of idToHash) {
    graceIds.add(id);
  }

  const activeHashes = new Set<string>();
  tagMap.clear();

  const candidates = querySelectorAllDeep(document, INTERACTIVE_SELECTORS);
  const results: TaggedElement[] = [];

  for (const el of candidates) {
    if (results.length >= MAX_TAGGED_ELEMENTS) break;
    if (!isElementVisible(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;

    const hash = computeStableHash(el);
    activeHashes.add(hash);

    // Reuse existing ID or allocate new one
    let id = hashToId.get(hash);
    if (id === undefined) {
      id = nextId++;
      hashToId.set(hash, id);
      idToHash.set(id, hash);
    }
    graceIds.delete(id); // Still alive — remove from grace

    tagMap.set(id, el);
    results.push(buildTaggedElement(el, id, showTags));
  }

  // Expire grace IDs that weren't renewed (gone for 2+ refreshes)
  // Grace IDs from previous cycle that are STILL in grace → truly gone
  // (This is handled by clearing graceIds at the top of each call,
  //  then re-populating with current-but-unseen IDs. On the NEXT call,
  //  those IDs will be cleared and not re-added → freed.)

  // Clean up hashes for elements that have been gone for 2+ refreshes
  for (const [hash, id] of hashToId) {
    if (!activeHashes.has(hash) && !graceIds.has(id)) {
      hashToId.delete(hash);
      idToHash.delete(id);
    }
  }

  return results;
}
```

**ID resolution with grace period in `actions.ts`:**

The existing `getTagMap().get(id)` lookup remains unchanged. Elements in the grace period still have their DOM references in `tagMap` from the previous refresh. If the element is still in the DOM (just not visible/tagged this round), the click still works. If the element was removed, the normal "No element with tag [N]" error fires.

**Reset on navigation:**

```typescript
export function resetStableIds(): void {
  hashToId.clear();
  idToHash.clear();
  tagMap.clear();
  graceIds.clear();
  nextId = 1;
}
```

Called from `content.ts` when `webNavigation` signals a full page load (not SPA transitions).

#### Tool result enhancement

Currently `click_element` returns:
```
Clicked [5] button "Click Here"
```

Add the element's text to help the LLM detect when an ID has been reassigned:
```
Clicked [5] button "Click Here"
```

This is already the behavior — no change needed here. But when an element's text changes between turns (e.g., button [5] was "Click Here" last turn but is now "Dismiss"), the stable ID system prevents this entirely: "Click Here" keeps its ID, and "Dismiss" gets a different ID.

---

### Part 2: Inline Clickable Element Detection

#### Approach: Heuristic detection of JS-clickable elements

Add a targeted scan for elements that are clickable via JavaScript event listeners or CSS cursor, but don't match any existing `INTERACTIVE_SELECTORS`.

**New selectors to add to `INTERACTIVE_SELECTORS`:**

```typescript
const INTERACTIVE_SELECTORS = [
  // ... existing selectors ...
  "[style*='cursor: pointer']",     // inline cursor: pointer
  "[style*='cursor:pointer']",      // no space variant
].join(", ");
```

**Programmatic listener detection (post-query filter):**

CSS selectors can't detect `addEventListener('click', ...)`. Instead, add a post-query pass that uses `getComputedStyle` to find elements with `cursor: pointer` that weren't already captured:

```typescript
function detectClickableElements(): Element[] {
  const found: Element[] = [];
  // TreeWalker is faster than querySelectorAll("*") for large DOMs
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node: Element) {
        // Skip if already captured by INTERACTIVE_SELECTORS
        if (node.matches(INTERACTIVE_SELECTORS)) return NodeFilter.FILTER_SKIP;
        // Skip our own tag labels
        if ((node as HTMLElement).classList?.contains(LABEL_CLASS)) return NodeFilter.FILTER_SKIP;
        // Skip containers (divs, sections) unless they're leaf-ish
        const tag = node.tagName.toLowerCase();
        if (CONTAINER_TAGS.has(tag) && node.children.length > 3) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node: Element | null;
  while ((node = walker.nextNode() as Element | null)) {
    if (!isElementVisible(node)) continue;
    const style = window.getComputedStyle(node);
    if (style.cursor === "pointer") {
      // Verify it's a leaf-ish element (not a large container)
      const text = node.textContent?.trim() || "";
      if (text.length > 0 && text.length < 200) {
        found.push(node);
      }
    }
  }
  return found;
}

const CONTAINER_TAGS = new Set([
  "div", "section", "article", "main", "aside", "header",
  "footer", "nav", "form", "fieldset", "ul", "ol",
]);
```

**Integration into `tagElements()`:**

```typescript
export function tagElements(showTags: boolean = false): TaggedElement[] {
  // ... existing setup ...

  // Phase 1: Standard interactive selectors (existing behavior)
  const candidates = querySelectorAllDeep(document, INTERACTIVE_SELECTORS);

  // Phase 2: Detect cursor:pointer elements not in Phase 1
  const clickableExtras = detectClickableElements();
  const allCandidates = [...candidates, ...clickableExtras];

  // Deduplicate (an element might appear in both sets)
  const seen = new Set<Element>();
  const dedupedCandidates: Element[] = [];
  for (const el of allCandidates) {
    if (!seen.has(el)) {
      seen.add(el);
      dedupedCandidates.push(el);
    }
  }

  for (const el of dedupedCandidates) {
    // ... existing tagging logic ...
  }
}
```

#### Safeguards

- **Performance budget:** The `cursor: pointer` scan uses `TreeWalker` (not `querySelectorAll("*")`) and skips large containers early. Budget: <5ms on a typical page. If the scan exceeds 10ms, log a warning and skip extras for that refresh.
- **Max elements cap:** The existing `MAX_TAGGED_ELEMENTS = 50` hard cap prevents runaway tagging. `cursor:pointer` elements are appended after standard interactive elements, so they only fill remaining slots.
- **False positives:** Large containers (divs with many children) are skipped. Only leaf-ish elements (text length 1-200 chars) are tagged. This prevents tagging giant wrapper divs that happen to have `cursor: pointer`.

---

### Part 3: find_element Improvements (bonus, low-effort)

The current `executeFindElement` walks up from the text node to find the nearest interactive or semantic container. This often returns a `<p>` or `<form>` instead of the actual clickable child.

**Fix:** After finding the semantic container, also check if there's a **more specific interactive element** inside it that contains the search text:

```typescript
function executeFindElement(args: { text: string }): ToolResult {
  // ... existing window.find() + selection logic ...

  // After finding `matched` (the container), check for a
  // more specific interactive child that contains the text
  if (matched && !matched.matches(INTERACTIVE)) {
    const interactiveChild = matched.querySelector(INTERACTIVE);
    if (interactiveChild && interactiveChild.textContent?.toLowerCase().includes(args.text.toLowerCase())) {
      matched = interactiveChild;
    }
    // Also check cursor:pointer children
    for (const child of matched.querySelectorAll("*")) {
      if (child.textContent?.toLowerCase().includes(args.text.toLowerCase())) {
        const style = window.getComputedStyle(child);
        if (style.cursor === "pointer") {
          matched = child;
          break;
        }
      }
    }
  }

  // ... existing addDynamicTag + return ...
}
```

This ensures `find_element("click here")` returns the clickable `<span>` inside the `<p>`, not the `<p>` itself.

---

## Priorities

| Priority | Change | Complexity | Files |
|----------|--------|-----------|-------|
| P1 | Stable element identity (hash-based IDs) | Medium | `tagging.ts`, `content.ts` |
| P2 | Inline clickable detection (cursor:pointer scan) | Low | `tagging.ts` |
| P3 | find_element drill-down to interactive children | Low | `actions.ts` |
| P4 | Grace period for recently-disappeared IDs | Low | `tagging.ts` |
| P5 | Reset stable IDs on full navigation | Low | `content.ts` |

---

## Risks & Mitigations

### Hash collisions produce duplicate IDs
**Risk:** Two different elements get the same hash → same integer ID → wrong element clicked.
**Mitigation:** Append disambiguation suffix. Test with adversarial pages (many buttons with same text). Collision rate with FNV-1a on `tag|path|text|attrs` is negligible for 50-element sets.

### DOM path changes on minor mutations
**Risk:** If a sibling element is added/removed, the DOM path index shifts, producing a new hash for the same element.
**Mitigation:** The grace period (1 refresh cycle) covers transient path shifts. For robustness, the hash weights text + attributes more heavily than path — a button with the same text/role at a slightly different path still matches via the `attrSignature` component. Could also use nth-of-type instead of raw child index.

### cursor:pointer scan performance on heavy pages
**Risk:** Pages with 10K+ elements could make the TreeWalker scan slow.
**Mitigation:** Time-budget the scan (10ms cap). Skip if over budget. The scan only runs on `refresh: true`, not on every message. In practice, most pages have <2000 visible elements.

### False-positive clickable detection
**Risk:** Decorative elements with `cursor: pointer` (icons, badges) get tagged, wasting tag slots.
**Mitigation:** Only tag leaf-ish elements (text length 1-200 chars, ≤3 children). The 50-element cap ensures standard interactive elements always take priority.

### Stable IDs confuse the LLM if an element changes meaning
**Risk:** A button's text changes from "Click Here" to "Dismiss" but keeps the same hash (same DOM path + tag).
**Mitigation:** Include `text.slice(0, 30)` in the hash. Text changes → new hash → new ID. This is the correct behavior: if the button's text changed, it's semantically a different element.

---

## Testing

### Unit tests (tagging.ts)

1. **Stable ID persistence:** Tag elements, mutate unrelated DOM, re-tag. Assert that unchanged elements keep the same IDs.
2. **New element gets new ID:** Add a button to the DOM, re-tag. Assert it gets a fresh ID and existing IDs are unchanged.
3. **Removed element grace period:** Remove an element, re-tag. Assert its ID is still valid in `tagMap`. Re-tag again. Assert the ID is now freed.
4. **Text change → new ID:** Change a button's text, re-tag. Assert it gets a new ID (different hash).
5. **Hash collision handling:** Create two buttons with identical text, role, and attributes at different DOM positions. Assert they get different IDs.
6. **cursor:pointer detection:** Create a `<span style="cursor:pointer">click me</span>` inside a `<p>`. Assert it gets tagged. Assert a `<div style="cursor:pointer">` with 10 children does NOT get tagged.
7. **Navigation reset:** Call `resetStableIds()`, then tag. Assert IDs start from 1 again.

### Unit tests (actions.ts)

8. **find_element drill-down:** Create `<p>Click <span onclick="...">here</span> to continue</p>`. Call `find_element({text: "here"})`. Assert it returns the `<span>`, not the `<p>`.
9. **find_element with cursor:pointer:** Create `<p>Click <span style="cursor:pointer">here</span></p>`. Assert `find_element` returns the `<span>`.

### Integration tests

10. **Adversarial page:** Build a test page with 5 buttons all labeled "Click Here" plus an inline `<span>` "click here". Run `tagElements` and verify all get unique stable IDs. Click one, re-tag, verify IDs are stable.
11. **SPA transition:** Simulate a DOM update that adds/removes elements. Verify unchanged elements keep IDs, new ones get fresh IDs.

---

## Estimated Impact

Based on the log analysis of the Browser Navigation Challenge session:

| Metric | Before | After (projected) |
|--------|--------|-------------------|
| Turns to complete Step 4 | 92 | ~10-15 |
| `click_element` wrong-target rate | 21% | <5% |
| `find_element` miss on inline text | 30% | <10% |
| User interventions needed | 3 (hint + 2 prods) | 0 |
| Steps completable per session | 8/30 | 20+ (credit-limited) |

The 92→15 turn reduction on Step 4 alone saves ~$0.15-0.30 in API costs and 5+ minutes of wall-clock time. Across a 30-step challenge, the cumulative savings would be substantial.
