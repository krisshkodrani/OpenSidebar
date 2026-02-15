# RFC-022: DOM Snapshot Token Budgeting

* **Status:** Draft
* **Created:** 2026-02-15
* **Context:** Optimizes the "30-step challenge" performance by reducing the token footprint of the DOM snapshot, which is the primary cost and latency driver.

## 1. Summary

This RFC proposes a "Tree Shaking" mechanism for the DOM snapshot generation. By intelligently pruning redundant attributes and limiting text capture based on interactivity, we aim to reduce the average snapshot size from **~4,000 tokens** to **~1,500 tokens** without losing semantic meaning.

## 2. Motivation

Currently, `snapshot.ts` and `tagging.ts` capture a significant amount of redundant information:

1. **Redundant Attributes:** An element often has `title`, `aria-label`, and inner text that all say the same thing (e.g., "Submit"). We send all three.
2. **Invisible/Irrelevant Text:** Long paragraphs of legal text or footer links are captured in full, even when the agent is focused on a specific form in the header.
3. **Token Cost:** On a 30-step run, saving 2,500 tokens per step  30 steps = 75,000 tokens saved. This directly translates to faster processing (lower TTFT) and lower costs.

## 3. Technical Design

### 3.1 Attribute Minification (`src/content/tagging.ts`)

We will modify `extractAttributes` to implement a "Semantic Hierarchy." If a higher-priority attribute exists, lower-priority ones are dropped.

**Hierarchy:** `aria-label` > `label` > `title` > `alt` > `placeholder`.

```typescript
// Modification in src/content/tagging.ts

function extractAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  
  // 1. Capture Critical Identity
  const explicitLabel = element.getAttribute('aria-label') || element.getAttribute('aria-description');
  
  if (explicitLabel) {
    attrs['label'] = explicitLabel;
    // SKIP: title, alt, placeholder if we have a clear aria-label
  } else {
    // Fallback chain
    const title = element.getAttribute('title');
    const alt = element.getAttribute('alt');
    const placeholder = element.getAttribute('placeholder');
    
    if (title) attrs['title'] = title;
    if (alt) attrs['alt'] = alt;
    if (placeholder) attrs['placeholder'] = placeholder;
  }

  // 2. State Attributes (Always Keep)
  if (element.getAttribute('aria-expanded')) attrs['expanded'] = element.getAttribute('aria-expanded')!;
  if (element.getAttribute('aria-checked')) attrs['checked'] = element.getAttribute('aria-checked')!;
  if ((element as HTMLInputElement).value) attrs['value'] = (element as HTMLInputElement).value.slice(0, 50); // Truncate values
  
  return attrs;
}

```

### 3.2 Text Node Tree Shaking (`src/content/snapshot.ts`)

We will modify `extractViewportText` to apply a "relevance filter."

**Logic:**

1. **Interactive Nodes:** Always keep full text of buttons, links, inputs.
2. **Content Nodes:** For non-interactive text tags (`p`, `span`, `div`):
* If the text is > 200 characters, truncate it to 200 chars + `...[more]`.
* *Exception:* If the element is within the "Focus Viewport" (the center 50% of the screen), keep up to 500 chars.



```typescript
// Modification in src/content/snapshot.ts

const MAX_TEXT_LENGTH_DEFAULT = 200;
const MAX_TEXT_LENGTH_FOCUSED = 500;

function processTextNode(node: Node, isInteractive: boolean): string {
  let text = node.textContent?.trim() || "";
  if (!text) return "";
  
  // If it's a button or link, keeping the exact text is crucial for matching
  if (isInteractive) return text;

  // Pruning logic for static content
  const limit = MAX_TEXT_LENGTH_DEFAULT; 
  if (text.length > limit) {
    return text.substring(0, limit) + `... [${text.length - limit} chars truncated]`;
  }
  
  return text;
}

```

### 3.3 JSON Output Compression

Instead of sending a verbose JSON array of objects, we will switch to a **Compact Tuple Format** for the LLM.

**Current Format:**

```json
[
  { "id": 12, "tag": "button", "text": "Submit", "attrs": { "title": "Submit Form" } }
]

```

*Token count: ~25*

**New "Simulated HTML" Format:**

```text
[12] <button title="Submit Form">Submit</button>

```

*Token count: ~10*

**Implementation:** Update `snapshot.ts` to return a string template literal instead of a raw object array. This "pseudo-HTML" is often better understood by models like Claude and GPT-4o than raw JSON.

## 4. Risks & Trade-offs

* **Over-Pruning:** Truncating text might hide the answer the agent is looking for (e.g., "Find the cancellation policy in this 5000-word document").
* *Mitigation:* Add a `read_full_content(elementId)` tool (already planned in other RFCs) that allows the agent to expand a truncated node.


* **Hallucination:** "Simulated HTML" might confuse the model if it looks too much like real code but isn't valid HTML.
* *Mitigation:* Use strict delimiters (e.g., `{{ element_12 }}`) or keep a simplified JSON format if testing shows degradation.



## 5. Implementation Plan

1. **Update `src/content/tagging.ts**`: Refactor `extractAttributes` to implement the priority hierarchy.
2. **Update `src/content/snapshot.ts**`:
* Implement text truncation logic.
* Refactor the final output generation to produce "Compact Format" (or minified JSON).


3. **Test**: Run against a "Terms of Service" page and verify the token count drops by >50%.

---

## Review & Status (2026-02-15)

### DONE

- **Compact element format**: Implemented in `context.ts`. Elements render as `[1] button#submit type=submit "Submit"` — achieving the same token savings as the proposed "Simulated HTML" format without the hallucination risk.
- **Text truncation**: Implemented via dynamic compression levels (NONE→LIGHT→MEDIUM→HEAVY) in `context.ts`. Element text truncated to 80 chars. Viewport text budgets: LIGHT→3000, MEDIUM→2000, HEAVY→0 chars.
- **Attribute whitelist**: Implemented via `PRIORITY_ATTRS` in `tagging.ts`. Only relevant attributes are captured.

### REMAINING (minor optimization)

- **Attribute hierarchy deduplication**: Specific suggestion for `extractAttributes()`:
  - If `aria-label` exists, skip `title` and `alt` (they're usually duplicates of the label text)
  - If `placeholder` exists on an input AND the element has text content, skip `placeholder`
  - Estimated savings: ~3-5 tokens per element, ~50-150 tokens per snapshot
  - Low priority — diminishing returns compared to what's already implemented

### NOT RECOMMENDED

- **Non-interactive text tree shaking**: Viewport text is already compressed by context.ts compression levels. The agent sometimes needs surrounding text for orientation (e.g., reading labels near form fields, understanding page context). Aggressive pruning hurts more than it helps.
- **"Simulated HTML" format**: The compact format (`[1] button#submit ...`) already achieves the same token savings without the risk of model confusion between pseudo-HTML and real HTML. Drop this proposal.

### OVERALL

This RFC is essentially complete. The remaining attribute hierarchy optimization is a minor win (~50-150 tokens/snapshot) and not transformative.