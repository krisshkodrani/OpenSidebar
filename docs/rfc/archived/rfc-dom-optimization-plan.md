# DOM Context Optimization — Implementation Plan v2.0

> **Status: DONE** — Archived 2026-02-14. Phases 1 & 3 fully implemented (viewport filtering, attribute whitelisting, scroll indicator, progressive compression, context metrics). Phase 2 (visual debugging) partially shipped (settings toggle exists, screenshot display deferred).

## Overview

**Problem:** The current DOM context pipeline sends up to 200 interactive elements with full attributes into the system prompt, regularly exceeding 10,000 tokens and triggering "system prompt too large" warnings. On complex SPAs (Gmail, Notion, Google Docs), this saturates the context window, degrades reasoning via the "lost-in-the-middle" phenomenon, and increases latency and API cost.

**Solution:** A phased optimization reducing system prompt size by ~70% while improving agent grounding through viewport-aware filtering, attribute whitelisting, scroll-position awareness, and action trace summarization — all backed by findings from AgentOccam, Browser-Use, Stagehand, and the Lemon Agent progressive compression paper.

### Corrected Performance Expectations

| Metric | Before | After (Phase 1) | Notes |
|---|---|---|---|
| Element count in prompt | ~200 | ~15-30 | Viewport + 500px expansion |
| Avg chars per element | ~150 | ~60 | Attribute whitelist + truncation |
| System prompt tokens | ~12,000 | ~2,500-3,500 | 70-77% reduction |
| "System prompt too large" warnings | Frequent | Rare (< 5%) | On standard pages |
| Context utilization | 85%+ | 45-60% | Leaves room for history |
| TTFT reduction | — | Provider-dependent | Smaller prompts → faster prefill, but TTFT is dominated by provider queue times |

> **Note:** Element click success rate and cost-per-task are not directly improved by context reduction alone. Click accuracy depends on element identification quality (addressed by better attributes). Cost reduction is proportional to token reduction.

---

## Phase 1: Core Optimizations

### 1.1 Viewport-Only Element Filtering

**File:** `src/content/tagging.ts`

The single highest-impact change. Currently `isElementVisible()` checks document bounds (entire scrollable page). Switching to viewport-relative filtering immediately cuts element count from ~200 to ~15-30.

**Modify `isElementVisible()`:**

```typescript
export function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);

  // Existing visibility checks (unchanged)
  if (rect.width === 0 || rect.height === 0) return false;
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;
  if (style.clip === "rect(0px, 0px, 0px, 0px)") return false;

  // NEW: Viewport-relative filtering with expansion margin
  // Uses getBoundingClientRect() which returns viewport-relative coords
  const expansion = VIEWPORT_EXPANSION;
  const viewportTop = -expansion;
  const viewportBottom = window.innerHeight + expansion;
  const viewportLeft = 0;
  const viewportRight = window.innerWidth;

  if (rect.bottom < viewportTop || rect.top > viewportBottom) return false;
  if (rect.right < viewportLeft || rect.left > viewportRight) return false;

  return true;
}
```

**Constants (top of file):**

```typescript
/** Pixels above/below viewport to include (peripheral vision) */
const VIEWPORT_EXPANSION = 500;

/** Hard cap on tagged elements per snapshot */
export const MAX_TAGGED_ELEMENTS = 50; // was 200
```

These are internal constants, not user-facing settings. The `VIEWPORT_EXPANSION` value of 500px provides ~2 screens of look-ahead, mitigating "tunnel vision" per Browser-Use research (Section 5.2 of research doc). The cap of 50 is a safety net — viewport filtering should naturally yield 15-30 elements.

**Expected Impact:**
- Before: ~200 elements (entire page)
- After: ~15-30 elements (viewport + 500px)
- Token reduction: ~70% of element section alone (~3,000+ tokens saved)

### 1.2 Attribute Whitelisting

**File:** `src/content/tagging.ts`

Restructure `extractAttributes()` to use a priority whitelist informed by AgentOccam's attribute hierarchy (research doc Section 3.2). The key change from the original plan: **keep existing useful attrs** (`name`, `value`, `title`, `alt`) and **add missing ones** (`id` with hash filtering, `data-testid`, `role`, `aria-expanded`, `aria-selected`, `disabled`). Reduce per-attribute truncation from 100 to 60 chars.

**Replace `extractAttributes()`:**

```typescript
/** Priority attributes for agent identification (AgentOccam hierarchy) */
const PRIORITY_ATTRS = [
  // Identity
  "id",          // NEW — filtered by isRandomHash()
  "data-testid", // NEW — testing-friendly environments
  "name",        // Kept — form identification
  // Navigation
  "href",
  "src",
  // Input state
  "type",
  "placeholder",
  "value",       // Kept — current input state
  // Accessibility
  "role",        // NEW — semantic role
  "aria-label",
  "alt",         // Kept — image description
  "title",       // Kept — tooltip context
];

/** Max chars per attribute value */
const ATTR_TRUNCATION = 60; // was 100

function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const name of PRIORITY_ATTRS) {
    const val = el.getAttribute(name);
    if (!val || val.length === 0) continue;

    // Skip random hashes (low character-to-token ratio, per AgentOccam)
    if ((name === "id" || name === "name") && isRandomHash(val)) continue;

    attrs[name] = val.slice(0, ATTR_TRUNCATION);
  }

  // State attributes — only include when they indicate non-default state
  if (el.hasAttribute("disabled")) attrs["disabled"] = "true";
  if (el.getAttribute("aria-expanded") === "true") attrs["aria-expanded"] = "true";
  if (el.getAttribute("aria-selected") === "true") attrs["aria-selected"] = "true";

  return attrs;
}

/**
 * Detect random hash/generated ID strings that waste tokens.
 * Patterns: u_0_j_8W, css-1q2w3e4, Button_root__2dKj, react-select-2-input
 */
function isRandomHash(value: string): boolean {
  // Trailing hash suffix (CSS modules, React IDs)
  if (/[_-][a-zA-Z0-9]{6,}$/.test(value)) return true;
  // Pure alphanumeric with no readable word (>= 3 consecutive lowercase)
  if (/^[a-zA-Z0-9]{8,}$/.test(value) && !/[a-z]{3,}/.test(value)) return true;
  return false;
}
```

**What we DROP vs. the current code:**
- `class` was never included (correct — Tailwind hashes are pure noise)

**What we ADD:**
- `id` (with hash filter), `data-testid`, `role`, `aria-expanded`, `aria-selected`, `disabled`

**Expected Impact:**
- Before: ~150 chars per element (8 attrs × ~19 chars avg, 100 char cap)
- After: ~60 chars per element (selective attrs, 60 char cap, hash filtering)

### 1.3 Text Truncation — Keep at 80 Characters

**File:** `src/content/tagging.ts`

The original plan proposed reducing text truncation from 80 to 50 chars. **This is not worth the risk.** With ~25 elements post-viewport-filtering, the difference is:

- 25 elements × 30 fewer chars = 750 chars ≈ 190 tokens saved
- Meanwhile viewport filtering saves ~3,000+ tokens

The 80→50 reduction provides negligible benefit and risks cutting off meaningful element labels (e.g., "Add to Cart - Limited Time Offer" becomes "Add to Cart - Limited Ti..."). **Keep the current 80-char limit.**

The only change: add head/tail smart truncation instead of hard cutoff.

**Modify the truncation in `tagElements()`:**

```typescript
// In tagElements(), change:
//   text: getVisibleText(el).slice(0, 80),
// To:
    text: truncateText(getVisibleText(el), 80),
```

**Add helper:**

```typescript
/** Smart truncation preserving head + tail for context */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const head = Math.floor(maxLength * 0.8); // 64 chars
  const tail = maxLength - head - 3;        // 13 chars
  return text.slice(0, head) + "..." + text.slice(-tail);
}
```

### 1.4 Scroll Position Indicator

**File:** `src/background/agent/context.ts`

A new addition not in the original plan. When the agent only sees viewport elements, it suffers from "tunnel vision" — it doesn't know where it is on the page or whether more content exists below. The `DomSnapshot` already includes `scroll: { x, y, maxY }`, so we can cheaply add a scroll indicator to the system prompt.

**Add to `SYSTEM_PROMPT_TEMPLATE`** (between `## Page Context` and `## Visible Elements`):

```typescript
const SYSTEM_PROMPT_TEMPLATE = `
...existing content...

## Page Context
Title: {{title}}
URL: {{url}}
{{scrollIndicator}}

## Visible Elements
{{elements}}

## Viewport Text (Summary)
{{viewportText}}
`;
```

**Add formatting in `constructSystemMessage()`:**

```typescript
// After replacing {{url}}, add:
if (this.snapshot?.scroll) {
  const { y, maxY } = this.snapshot.scroll;
  const pct = maxY > 0 ? Math.round((y / maxY) * 100) : 0;
  const moreBelow = y < maxY - 10; // 10px tolerance
  const moreAbove = y > 10;

  let indicator = `Scroll: ${y}/${maxY}px (${pct}% down)`;
  if (moreBelow) indicator += " — more content below";
  if (moreAbove && !moreBelow) indicator += " — at bottom of page";
  if (!moreAbove && !moreBelow) indicator += " — all content visible";

  content = content.replace("{{scrollIndicator}}", indicator);
} else {
  content = content.replace("{{scrollIndicator}}", "");
}
```

**Cost:** ~15 tokens. **Value:** Prevents the agent from assuming it has seen the entire page, encouraging appropriate scroll actions.

### 1.5 Action Trace Summarization

**File:** `src/background/agent/context.ts`

After each tool execution, older (> 2 turns ago) tool call/result pairs should be compressed into one-line summaries in conversation history. This is Lemon Agent's "Intra-Round Adaptive Summarization" (research doc Section 7.1, Tier 2).

Currently, each tool call + result pair can be 500-2000 tokens (the tool result often contains a full DOM re-snapshot). Over a 10-step task, this accumulates 5,000-20,000 tokens of stale history.

**Add method to `ContextManager`:**

```typescript
/**
 * Compress old tool call/result pairs into one-line summaries.
 * Preserves the last `preserveRecent` tool interactions verbatim.
 * Called after each new tool result is added.
 */
private compressOldToolResults(preserveRecent: number = 2): void {
  let toolResultCount = 0;

  // Count tool results from the end
  for (let i = this.history.length - 1; i >= 0; i--) {
    if (this.history[i].role === "tool") {
      toolResultCount++;
    }
    // Once we've found the Nth most recent tool result, compress everything before it
    if (toolResultCount > preserveRecent) {
      // Found the boundary — compress tool results before index i
      this.compressToolResultsBeforeIndex(i);
      break;
    }
  }
}

private compressToolResultsBeforeIndex(beforeIndex: number): void {
  for (let i = 0; i < beforeIndex; i++) {
    const msg = this.history[i];
    if (msg.role === "tool" && msg.content && msg.content.length > 150) {
      // Extract a summary from the tool result
      // Tool results typically start with "Success: ..." or "Error: ..."
      const firstLine = msg.content.split("\n")[0].slice(0, 100);
      msg.content = firstLine + " [truncated]";
    }
  }
}
```

**Call site — in `addMessage()`:**

```typescript
public addMessage(message: LLMMessage) {
  this.history.push(message);

  // Compress old tool results to save context budget
  if (message.role === "tool") {
    this.compressOldToolResults(2);
  }

  // ...existing truncation and save logic...
}
```

**Expected Impact:**
- A 10-step task with verbose tool results: ~10,000 tokens → ~3,000 tokens of history
- Combined with viewport filtering: total context drops from ~22,000 to ~6,000 tokens

### 1.6 State Invalidation

**File:** `src/background/agent/context.ts`

The DOM snapshot is only valid at the moment it was captured. After any DOM-modifying action (click, type, select, hover), the snapshot may be stale. Currently, the auto-refresh feature (noted in MEMORY.md) re-captures the snapshot after DOM-modifying actions, which addresses the staleness problem at the tool execution layer.

The remaining concern: old snapshots lingering in conversation history as tool result text. **This is already handled by Section 1.5** (action trace summarization compresses old tool results).

Additional safeguard — if the snapshot is null when constructing the system message (e.g., after navigation before read_page is called), use a minimal placeholder:

```typescript
// Already handled in current code (lines 227-231 of context.ts)
// No changes needed — the existing else branch shows "No page loaded"
// which correctly signals the agent to call read_page
```

### 1.7 Relaxed `isPivotalElement()` (Optional Filter)

**File:** `src/content/tagging.ts`

The original plan included an `isPivotalElement()` filter that required minimum element dimensions (40×20px) and visible text content. The minimum size threshold is **too aggressive** — it would filter out icon buttons (common: 24×24px close buttons, 32×32px social icons). The text requirement would filter out icon-only buttons that have no aria-label.

**Recommended approach:** Do NOT add `isPivotalElement()` in Phase 1. Viewport filtering + `MAX_TAGGED_ELEMENTS = 50` already constrains the element count sufficiently. If post-implementation testing shows element counts still too high on specific pages, add a relaxed version:

```typescript
// ONLY add if needed after Phase 1 testing:
function isPivotalElement(el: Element): boolean {
  // Must be interactive (already guaranteed by INTERACTIVE_SELECTORS)

  // Skip disabled elements
  if (isDisabled(el)) return false;

  // No minimum size — icon buttons can be small
  // No text requirement — icon-only buttons are valid targets

  return true;
}
```

### 1.8 Settings Changes

**File:** `src/types/index.ts`

The original plan proposed 5 new `UserSettings` fields. **This is over-engineered for Phase 1.** The viewport expansion and max elements are internal constants that don't need user configuration. The only user-facing toggle is visual tag debugging (Phase 2).

**No changes to `UserSettings` in Phase 1.** All optimization constants are internal to `tagging.ts` and `context.ts`.

---

## Phase 2: Visual Debugging System

Phase 2 is a **human debugging tool**, not an agent performance enhancement. Screenshots without a vision-capable model provide zero benefit to the text-based agent. This phase adds visual debugging aids for developers and users inspecting agent behavior.

### 2.1 Set-of-Mark (SoM) Screenshot for Sidebar Display

**Files:** `src/background/tools/screenshot.ts` (new), `src/content/tagging.ts`, `src/sidepanel/`

**Create `src/background/tools/screenshot.ts`:**

```typescript
import { logger } from "@/utils";

interface ScreenshotOptions {
  format: "jpeg" | "png";
  quality: number;
  includeTags: boolean;
}

export async function takeScreenshotWithTags(
  tabId: number,
  options: ScreenshotOptions = {
    format: "jpeg",
    quality: 80,
    includeTags: true,
  },
): Promise<{ dataUrl: string; success: boolean; error?: string }> {
  try {
    if (options.includeTags) {
      await chrome.tabs.sendMessage(tabId, {
        type: "ENABLE_SCREENSHOT_MODE",
        requestId: crypto.randomUUID(),
        source: "background",
        payload: { showTags: true },
      });
      // Wait for tag overlays to render
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // CORRECT API: captureVisibleTab takes windowId (optional), then options
    // It captures the visible area of the currently active tab in the given window.
    // We must get the windowId from the tab.
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: options.format,
      quality: options.quality,
    });

    if (options.includeTags) {
      await chrome.tabs.sendMessage(tabId, {
        type: "DISABLE_SCREENSHOT_MODE",
        requestId: crypto.randomUUID(),
        source: "background",
        payload: {},
      });
    }

    return { dataUrl, success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("screenshot", "Failed to capture screenshot", { error: msg });
    return { dataUrl: "", success: false, error: msg };
  }
}
```

> **API correction:** `chrome.tabs.captureVisibleTab(windowId?, options?)` — the first argument is `windowId`, not `tabId`. The function captures whatever tab is active in that window. We resolve the windowId via `chrome.tabs.get(tabId)`.

### 2.2 Visual Tag Toggle

**Files:** `src/types/index.ts`, `src/content/tagging.ts`

Add a single user setting for visual tag debugging:

```typescript
// In UserSettings:
export interface UserSettings {
  // ...existing fields...

  /** Show visual [N] tag overlays on page elements (debugging aid) */
  showElementTags: boolean; // Default: false
}
```

**Modify `tagElements()` in tagging.ts** to conditionally show/hide visual labels:

```typescript
export function tagElements(showVisualTags: boolean = false): TaggedElement[] {
  // 1. Remove old tags
  document.querySelectorAll(`.${LABEL_CLASS}`).forEach((el) => el.remove());
  tagMap.clear();
  tagCounter = 0;

  const candidates = querySelectorAllDeep(document, INTERACTIVE_SELECTORS);
  const results: TaggedElement[] = [];

  for (const el of candidates) {
    if (results.length >= MAX_TAGGED_ELEMENTS) break;
    if (!isElementVisible(el)) continue;

    tagCounter++;
    const tag = tagCounter;
    tagMap.set(tag, el);

    // Only inject visual labels when debugging is enabled
    if (showVisualTags) {
      const label = document.createElement("span");
      // ...existing label creation code...
      document.body.appendChild(label);
    }

    results.push({
      tag,
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || inferRole(el),
      text: truncateText(getVisibleText(el), 80),
      attributes: extractAttributes(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      isVisible: true,
      isDisabled: isDisabled(el),
    });
  }

  return results;
}
```

### 2.3 Screenshot Display in Sidebar

**File:** `src/sidepanel/App.tsx` (or a new `ScreenshotOverlay` component)

Add a floating overlay that displays debug screenshots when captured. Screenshots auto-dismiss after 30 seconds. This is purely a UI display — the screenshot is NOT sent to the LLM.

**New RuntimeMessage types needed:**

```typescript
// In src/types/index.ts, add to RuntimeMessage union:
| ScreenshotCapturedMessage

export interface ScreenshotCapturedMessage extends BaseMessage {
  type: "SCREENSHOT_CAPTURED";
  source: MessageSource.BACKGROUND;
  payload: {
    dataUrl: string;
    context: string;
    timestamp: number;
  };
}
```

### 2.4 Screenshot Triggering — On Failure Only

**File:** `src/background/tools/index.ts`

Screenshots are triggered only when an element action fails (e.g., "No element with tag [N]"). The screenshot is sent to the sidebar for human inspection, NOT to the LLM.

```typescript
// In the click_element executor:
if (!result.success && result.includes("No element with tag")) {
  const settings = await getSettings();
  if (settings.showElementTags) {
    // Only capture debug screenshots when visual debugging is enabled
    const screenshot = await takeScreenshotWithTags(tabId, {
      format: "jpeg",
      quality: 80,
      includeTags: true,
    });

    if (screenshot.success) {
      // Send to sidebar for human debugging display
      await chrome.runtime.sendMessage({
        type: "SCREENSHOT_CAPTURED",
        requestId: crypto.randomUUID(),
        source: "background",
        payload: {
          dataUrl: screenshot.dataUrl,
          context: `Failed to find element [${args.id}]`,
          timestamp: Date.now(),
        },
      });
    }
  }
}
```

> **No `storeScreenshot()` in Phase 2.** In-memory screenshot storage is deferred to Phase 3. Screenshots are ephemeral display-only.

---

## Phase 3: Advanced Features

### 3.1 Progressive Compression

**File:** `src/background/agent/context.ts`

Implement tiered compression based on context utilization. The key fix from the original plan: the "AGGRESSIVE" tier must NOT reduce to just element counts — that's useless information. Instead, it should keep the top-5 elements by proximity to the last interacted element, plus any elements matching common navigation patterns (submit buttons, nav links).

```typescript
enum CompressionLevel {
  NONE = "none",       // < 50% utilization
  LIGHT = "light",     // 50-70% utilization
  MEDIUM = "medium",   // 70-85% utilization
  HEAVY = "heavy",     // > 85% utilization
}

private getCompressionLevel(): CompressionLevel {
  const systemTokens = this.estimateMessageTokens(this.constructSystemMessage());
  const utilization = systemTokens / this.maxContextTokens;

  if (utilization < 0.5) return CompressionLevel.NONE;
  if (utilization < 0.7) return CompressionLevel.LIGHT;
  if (utilization < 0.85) return CompressionLevel.MEDIUM;
  return CompressionLevel.HEAVY;
}
```

**Compression tiers:**

| Level | Elements | Attributes | Text | Viewport Text |
|---|---|---|---|---|
| NONE | All viewport elements (full detail) | All priority attrs | 80 chars | Full |
| LIGHT | All viewport elements | All priority attrs | 40 chars | Truncated to 5000 chars |
| MEDIUM | All viewport elements | `id`, `role`, `type`, `href` only | 20 chars | Truncated to 2000 chars |
| HEAVY | Top 10 elements (by nav relevance) | `role`, `type` only | 15 chars | Removed |

**Heavy-tier element selection** (replaces the useless element-count-only approach):

```typescript
private selectHeavyTierElements(elements: TaggedElement[]): TaggedElement[] {
  // Priority: last-interacted neighbors, submit/nav buttons, inputs
  const scored = elements.map((el) => ({
    el,
    score: this.scoreElementRelevance(el),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10).map((s) => s.el);
}

private scoreElementRelevance(el: TaggedElement): number {
  let score = 0;
  // Boost submit-like buttons
  if (/submit|login|sign|search|next|continue/i.test(el.text)) score += 3;
  // Boost inputs (likely form fields)
  if (["input", "textarea", "select"].includes(el.tagName)) score += 2;
  // Boost navigation links
  if (el.tagName === "a" && el.attributes.href) score += 1;
  return score;
}
```

### 3.2 Accessibility Tree (AXTree) — Experimental

**Requires:** `debugger` permission in `manifest.json`

The AXTree is the single most impactful long-term optimization, offering 10-20x token reduction over DOM parsing (research doc Section 3.1). However, it requires the Chrome DevTools Protocol and the `debugger` permission, which shows a warning banner to users.

**Phase 3 scope:** Build an opt-in experimental feature behind a flag. Even prototype data will inform architectural decisions.

```typescript
// New file: src/content/axtree.ts (or src/background/axtree.ts via CDP)

/**
 * Capture the Accessibility Tree via Chrome DevTools Protocol.
 * Requires `debugger` permission in manifest.json.
 */
export async function captureAXTree(tabId: number): Promise<AXNode[]> {
  // Attach debugger
  await chrome.debugger.attach({ tabId }, "1.3");

  try {
    // Enable accessibility domain
    await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable");

    // Get full tree
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Accessibility.getFullAXTree",
    ) as { nodes: AXNode[] };

    return result.nodes.filter((n) => n.role?.value !== "none");
  } finally {
    await chrome.debugger.detach({ tabId });
  }
}

interface AXNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  properties?: Array<{ name: string; value: { value: unknown } }>;
  childIds?: string[];
}
```

**manifest.json addition:**

```json
{
  "permissions": ["debugger"]
}
```

> **User-facing:** Add a toggle in settings: "Experimental: Use Accessibility Tree (shows debugger warning)". Default: off.

### 3.3 Context Budget Monitoring

**File:** `src/background/agent/context.ts`

Add telemetry to track context utilization over time. This data informs compression tuning.

```typescript
interface ContextMetrics {
  systemTokens: number;
  historyTokens: number;
  totalTokens: number;
  maxTokens: number;
  utilization: number;
  elementCount: number;
  compressionLevel: CompressionLevel;
}

public getPromptMetrics(): ContextMetrics {
  const systemMessage = this.constructSystemMessage();
  const systemTokens = this.estimateMessageTokens(systemMessage);
  const historyTokens = this.history.reduce(
    (sum, msg) => sum + this.estimateMessageTokens(msg),
    0,
  );

  return {
    systemTokens,
    historyTokens,
    totalTokens: systemTokens + historyTokens,
    maxTokens: this.maxContextTokens,
    utilization: (systemTokens + historyTokens) / this.maxContextTokens,
    elementCount: this.snapshot?.elements.length || 0,
    compressionLevel: this.getCompressionLevel(),
  };
}
```

Emit metrics after each agent loop turn:

```typescript
// In AgentLoop, after each LLM call:
const metrics = this.context.getPromptMetrics();
logger.info("agent", "Context metrics", metrics);
```

### 3.4 Screenshot Storage (Phase 3, not Phase 2)

**File:** `src/background/screenshots/store.ts` (new)

In-memory ring buffer for recent screenshots. Deferred from Phase 2 because ephemeral display is sufficient for initial debugging needs.

```typescript
interface ScreenshotEntry {
  id: string;
  tabId: number;
  dataUrl: string;
  context: string;
  timestamp: number;
  url: string;
}

const MAX_SCREENSHOTS = 20;
const screenshotStore: ScreenshotEntry[] = [];

export function storeScreenshot(entry: Omit<ScreenshotEntry, "id">): string {
  const id = crypto.randomUUID();
  screenshotStore.push({ ...entry, id });
  if (screenshotStore.length > MAX_SCREENSHOTS) {
    screenshotStore.shift();
  }
  return id;
}

export function getScreenshots(): ScreenshotEntry[] {
  return [...screenshotStore];
}

export function clearScreenshots(): void {
  screenshotStore.length = 0;
}
```

---

## Future: Vision Model Integration Path

This section outlines the **architectural changes** needed to send screenshots to a vision-capable model (GPT-4o, Claude with vision, etc.). This is NOT part of Phases 1-3 — it requires a model that supports image inputs and changes to the LLM client.

### Prerequisites

1. **LLMMessage schema change:** Add multimodal content support.

```typescript
// In src/background/llm/types.ts:
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];  // Change from string-only
  // ...existing fields...
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } };
```

2. **Model selection:** Add a setting for which model handles vision tasks. The primary fast model (Cerebras) does not support images. Vision fallback would route to OpenRouter with a vision-capable model.

3. **SoM overlay for vision:** When sending a screenshot to a vision model, overlay numeric tags on the image (the same tags visible in the DOM snapshot). This is the Set-of-Mark technique (research doc Section 6.1). The LLM sees both the tagged image and the element list, enabling "Click element #42" style reasoning.

4. **Hybrid fallback:** Follow Stagehand's tiered pattern (research doc Section 6.2): DOM-first, vision-on-failure. Only escalate to vision when DOM analysis is ambiguous or an action fails.

> **Why defer?** Vision model calls are 10-100x more expensive than text-only calls, and add 2-5 seconds of latency per call. The text-based optimizations in Phases 1-3 should handle 90%+ of use cases. Vision is for the remaining edge cases (canvas apps, image-heavy UIs, visual discrimination tasks).

---

## Testing Strategy

### Unit Tests

**File:** `tests/content/tagging.test.ts`

```typescript
describe("isElementVisible — viewport filtering", () => {
  test("includes element within viewport", () => {
    // Mock getBoundingClientRect to return rect within viewport
  });

  test("includes element within 500px expansion below viewport", () => {
    // rect.top = window.innerHeight + 300 (within expansion)
  });

  test("excludes element far below viewport", () => {
    // rect.top = window.innerHeight + 600 (outside expansion)
  });

  test("excludes element above viewport", () => {
    // rect.bottom = -600
  });
});

describe("extractAttributes", () => {
  test("includes id when human-readable", () => {
    expect(isRandomHash("login-button")).toBe(false);
    expect(isRandomHash("search-input")).toBe(false);
    expect(isRandomHash("main-nav")).toBe(false);
  });

  test("filters random hash IDs", () => {
    expect(isRandomHash("u_0_j_8W")).toBe(true);
    expect(isRandomHash("css-1q2w3e4")).toBe(true);
    expect(isRandomHash("AABBCCDD")).toBe(true); // no lowercase word
  });

  test("includes data-testid", () => {
    // Create element with data-testid, verify it appears in output
  });

  test("truncates values at 60 chars", () => {
    // Create element with 100-char href, verify truncation
  });

  test("includes state attributes when non-default", () => {
    // Create disabled element, verify disabled="true" in output
    // Create expanded element, verify aria-expanded="true"
  });
});

describe("truncateText", () => {
  test("preserves short text", () => {
    expect(truncateText("Hello", 80)).toBe("Hello");
  });

  test("truncates with head/tail retention", () => {
    const long = "A".repeat(100);
    const result = truncateText(long, 80);
    expect(result.length).toBe(80);
    expect(result).toContain("...");
  });
});
```

**File:** `tests/background/context.test.ts`

```typescript
describe("ContextManager — scroll indicator", () => {
  test("shows 'more content below' when not at bottom", () => {
    // Set snapshot.scroll = { y: 500, maxY: 3000 }
    // Verify system prompt contains "more content below"
  });

  test("shows 'at bottom of page' when scrolled to end", () => {
    // Set snapshot.scroll = { y: 3000, maxY: 3000 }
  });
});

describe("ContextManager — action trace summarization", () => {
  test("compresses old tool results beyond 2 most recent", () => {
    // Add 5 tool results to history
    // Verify first 3 are truncated, last 2 are preserved
  });

  test("preserves recent tool results verbatim", () => {
    // Add 2 tool results
    // Verify both are preserved (under threshold)
  });
});
```

### Integration Tests

```typescript
describe("Full snapshot pipeline", () => {
  test("complex page produces < 50 elements", () => {
    // Load a page with 500+ DOM nodes
    // Verify tagElements() returns ≤ 50 elements
  });

  test("system prompt stays under 4000 tokens", () => {
    // Build full snapshot → constructSystemMessage()
    // Verify estimateMessageTokens() < 4000
  });
});
```

### Manual Testing Checklist

- [ ] Gmail inbox: element count ≤ 50, no "system prompt too large" warning
- [ ] Google Docs: element count ≤ 50, scroll indicator shows position
- [ ] Amazon product page: key elements (Add to Cart, Buy Now) still tagged
- [ ] Login forms: username/password inputs correctly identified
- [ ] Icon-only buttons (close ×, hamburger menu) still tagged
- [ ] Scroll indicator updates after scroll_page action
- [ ] Action trace: 10-step task keeps total context under 8000 tokens

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Viewport filtering misses off-screen target elements | Medium | High | 500px expansion margin; scroll indicator prompts agent to scroll; `read_page` tool still available to re-snapshot |
| Attribute whitelisting removes info needed for disambiguation | Low | Medium | Kept all original attrs + added new ones; `isRandomHash()` only filters clearly generated strings |
| `isRandomHash()` false positive on legitimate short IDs | Low | Low | Only applied to `id` and `name` attrs; pattern requires 6+ trailing chars or 8+ pure alphanumeric |
| Action trace summarization loses critical context | Low | Medium | Preserves 2 most recent tool results verbatim; only truncates content, not the tool_call_id or role |
| Visual tag labels interfere with page functionality | Low | Low | `pointer-events: none`; opt-in via settings toggle; labels removed before screenshot capture |
| Progressive compression (Phase 3) makes wrong tier decision | Medium | Medium | Conservative thresholds; heavy tier still includes 10 elements with role/type |

---

## Implementation Checklist

### Phase 1: Core Optimizations

- [ ] `tagging.ts`: Change `isElementVisible()` to viewport-relative filtering
- [ ] `tagging.ts`: Reduce `MAX_TAGGED_ELEMENTS` from 200 to 50
- [ ] `tagging.ts`: Replace `extractAttributes()` with priority whitelist + `isRandomHash()`
- [ ] `tagging.ts`: Add `truncateText()` helper with head/tail retention
- [ ] `context.ts`: Add scroll position indicator to system prompt template
- [ ] `context.ts`: Add `compressOldToolResults()` for action trace summarization
- [ ] Write unit tests for viewport filtering
- [ ] Write unit tests for `isRandomHash()`
- [ ] Write unit tests for scroll indicator formatting
- [ ] Manual test on Gmail, Google Docs, Amazon

### Phase 2: Visual Debugging

- [ ] `types/index.ts`: Add `showElementTags` to `UserSettings`
- [ ] `types/index.ts`: Add `ScreenshotCapturedMessage` to `RuntimeMessage`
- [ ] `tools/screenshot.ts`: Implement `takeScreenshotWithTags()` with correct API
- [ ] `tagging.ts`: Make visual label injection conditional on `showElementTags`
- [ ] `sidepanel/`: Add screenshot overlay component
- [ ] `tools/index.ts`: Add screenshot-on-failure for click_element
- [ ] `SettingsDrawer.tsx`: Add toggle for visual tag debugging

### Phase 3: Advanced Features

- [ ] `context.ts`: Implement progressive compression tiers
- [ ] `context.ts`: Add `getPromptMetrics()` telemetry
- [ ] `screenshots/store.ts`: Implement screenshot ring buffer
- [ ] `axtree.ts`: Prototype AXTree capture via CDP (experimental)
- [ ] Add `debugger` permission to manifest.json (behind experimental flag)

---

_Document Version: 2.0_
_Last Updated: 2026-02-10_
_Based on: Research analysis in `docs/research/DOM Context Opts.md`_
_References: AgentOccam, Browser-Use, Stagehand, Lemon Agent, Playwright MCP, ScribeAgent_
