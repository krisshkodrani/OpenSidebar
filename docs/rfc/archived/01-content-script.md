# Phase 1 — Content Script (DOM Distillation & Action Execution)

> **Goal:** Build the content script that tags interactive elements with numeric labels (Vimium-style), produces a distilled DOM snapshot for the LLM, and executes DOM actions (click, type, scroll, read, navigate).

---

## Background

The content script is the agent's "eyes and hands." It runs in every tab's renderer process and has full DOM access. The LLM never sees raw HTML — it receives a structured `DomSnapshot` (see [`types-reference.md`](./types-reference.md)) and issues tool calls that the content script executes11. **Key constraint:** Content scripts are destroyed on navigation. The service worker must re-inject or rely on `manifest.json` `content_scripts` auto-injection. State that must survive navigation is navigation is managed by the Navigation Bridge (Phase 4), not the content script.
 
12. **Anti-Modal:** The content script includes a "Janitor" routine that attempts to close common cookie banners and overlays on page load to clear the view for the agent.
 
---

## Design

### File: `src/content/content.ts`

Single file, ~400 lines. No imports from `background/` or `sidepanel/` — only from `src/types/`.

### Responsibilities

1. **Tag interactive elements** with visual `[N]` labels.
24. **Build a `DomSnapshot`** on demand.
25. **Execute DOM actions** dispatched by the service worker (with safety checks).
26. **Report results** back via `chrome.runtime.sendMessage`.
27. **Run heuristics** to cleanup the page (auto-close modals).
 
---

## Implementation Details

### 1. Element Discovery & Tagging

#### Which elements are "interactive"?

An element is tagged if it matches ANY of these criteria:

```typescript
const INTERACTIVE_SELECTORS = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='combobox']",
  "[contenteditable='true']",
  "summary",
  "details",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");
```

#### Visibility Detection

An element is considered **visible** if ALL conditions hold:

```typescript
function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);

  // Must have non-zero dimensions
  if (rect.width === 0 || rect.height === 0) return false;

  // Must not be hidden via CSS
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;

  // Must not be clipped entirely
  if (style.clip === "rect(0px, 0px, 0px, 0px)") return false;

  // Must be within the document bounds (not scrolled off-screen entirely)
  const docHeight = document.documentElement.scrollHeight;
  const docWidth = document.documentElement.scrollWidth;
  if (rect.bottom < 0 || rect.top > docHeight) return false;
  if (rect.right < 0 || rect.left > docWidth) return false;

  return true;
}
```

#### Tagging Algorithm

```typescript
/** Global tag counter — resets on each snapshot refresh */
let tagCounter = 0;

/** Maps tag number → DOM element (for action execution) */
const tagMap = new Map<number, Element>();

/** CSS class for the injected label overlay */
const LABEL_CLASS = "qsidebar-tag";

function tagElements(): TaggedElement[] {
  // 1. Remove old tags
  document.querySelectorAll(`.${LABEL_CLASS}`).forEach(el => el.remove());
  tagMap.clear();
  tagCounter = 0;

  // 2. Query all interactive elements
  const candidates = document.querySelectorAll(INTERACTIVE_SELECTORS);
  const results: TaggedElement[] = [];

  for (const el of candidates) {
    if (results.length >= MAX_TAGGED_ELEMENTS) break;
    if (!isElementVisible(el)) continue;

    tagCounter++;
    const tag = tagCounter;
    tagMap.set(tag, el);

    // 3. Inject visual label
    const label = document.createElement("span");
    label.className = LABEL_CLASS;
    label.textContent = `[${tag}]`;
    label.style.cssText = `
      position: absolute;
      z-index: 2147483647;
      background: #fbbf24;
      color: #000;
      font: bold 11px/1 monospace;
      padding: 1px 3px;
      border-radius: 2px;
      pointer-events: none;
      white-space: nowrap;
    `;

    // Position the label at the element's top-left
    const rect = el.getBoundingClientRect();
    label.style.top = `${rect.top + window.scrollY}px`;
    label.style.left = `${Math.max(0, rect.left + window.scrollX - 20)}px`;
    document.body.appendChild(label);

    // 4. Build TaggedElement
    results.push({
      tag,
      tagName: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || inferRole(el),
      text: getVisibleText(el).slice(0, 80),
      attributes: extractAttributes(el),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      isVisible: true,
      isDisabled: isDisabled(el),
    });
  }

  return results;
}
```

#### Helper Functions

```typescript
function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "input") return (el as HTMLInputElement).type || "textbox";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  return tag;
}

function getVisibleText(el: Element): string {
  // Prefer aria-label > textContent > value > placeholder
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const text = el.textContent?.trim();
  if (text) return text;

  if (el instanceof HTMLInputElement) {
    return el.value || el.placeholder || "";
  }

  return "";
}

function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  const keep = ["href", "placeholder", "aria-label", "type", "name", "value", "title", "alt"];
  for (const name of keep) {
    const val = el.getAttribute(name);
    if (val) attrs[name] = val.slice(0, 100);
  }
  return attrs;
}

function isDisabled(el: Element): boolean {
  return (
    el.hasAttribute("disabled") ||
    el.getAttribute("aria-disabled") === "true"
  );
}
```

### 2. DOM Snapshot Generation

```typescript
function buildSnapshot(includeText: boolean, refresh: boolean): DomSnapshot {
  const elements = refresh ? tagElements() : getCachedElements();

  let viewportText = "";
  if (includeText) {
    viewportText = extractViewportText();
  }

  return {
    title: document.title,
    url: window.location.href,
    elements,
    viewportText,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
      maxY: document.documentElement.scrollHeight - window.innerHeight,
    },
  };
}

function extractViewportText(): string {
  // Use TreeWalker for efficiency — only text nodes in the viewport
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Skip hidden elements, scripts, styles
        const tag = parent.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "noscript") {
          return NodeFilter.FILTER_REJECT;
        }
        const style = window.getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const chunks: string[] = [];
  let totalLength = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.trim();
    if (!text) continue;
    chunks.push(text);
    totalLength += text.length;
    if (totalLength > MAX_VIEWPORT_TEXT_LENGTH) break;
  }

  return chunks.join(" ").slice(0, MAX_VIEWPORT_TEXT_LENGTH);
}
```

### 3. Action Execution

```typescript
async function executeAction(
  toolName: ToolName,
  args: Record<string, unknown>
): Promise<{ success: boolean; result: string; navigated: boolean }> {
  switch (toolName) {
    case ToolName.CLICK_ELEMENT:
      return executeClick(args as unknown as ClickElementArgs);
    case ToolName.TYPE_TEXT:
      return executeType(args as unknown as TypeTextArgs);
    case ToolName.SCROLL_PAGE:
      return executeScroll(args as unknown as ScrollPageArgs);
    case ToolName.READ_PAGE:
      return executeRead();
    case ToolName.TAKE_SCREENSHOT:
      return { success: true, result: "Screenshot handled by service worker", navigated: false };
    case ToolName.HOVER_ELEMENT:
      return executeHover(args as unknown as { id: number });
    case ToolName.FIND_ELEMENT:
      return executeFindElement(args as unknown as { text: string });
    default:
      return { success: false, result: `Unknown tool: ${toolName}`, navigated: false };
  }
}
```

#### `click_element`

```typescript
function executeClick(args: ClickElementArgs): { success: boolean; result: string; navigated: boolean } {
  const el = tagMap.get(args.id);
  if (!el) {
    return { success: false, result: `No element with tag [${args.id}]`, navigated: false };
  }

  // Scroll into view if needed
  el.scrollIntoView({ behavior: "instant", block: "center" });
  
  // Z-Index Check: Is the element actually clickable?
  // We check the center point of the rect
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const topEl = document.elementFromPoint(x, y);
  
  if (topEl && !el.contains(topEl) && !topEl.contains(el)) {
     // Overlaid by something else (e.g. cookie banner)
     return { 
        success: false, 
        result: `Click intercepted! Element [${args.id}] is covered by <${topEl.tagName.toLowerCase()} class="${topEl.className}">. Try closing the overlay first.`, 
        navigated: false 
     };
  }

  // Determine if this click will navigate
  const willNavigate = (
    (el.tagName === "A" && el.hasAttribute("href") && !(el as HTMLAnchorElement).target) ||
    el.closest("form")?.querySelector("[type='submit']") === el
  );

  // Dispatch real click events
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

  // Also call .click() for elements that handle it natively
  if (el instanceof HTMLElement) {
    el.click();
  }

  return {
    success: true,
    result: `Clicked [${args.id}] ${el.tagName.toLowerCase()} "${getVisibleText(el).slice(0, 40)}"`,
    navigated: willNavigate,
  };
}
```

#### `type_text`

```typescript
function executeType(args: TypeTextArgs): { success: boolean; result: string; navigated: boolean } {
  const el = tagMap.get(args.id);
  if (!el) {
    return { success: false, result: `No element with tag [${args.id}]`, navigated: false };
  }

  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) {
    return { success: false, result: `Element [${args.id}] is not a text input`, navigated: false };
  }

  // Focus the element
  if (el instanceof HTMLElement) el.focus();

  // Clear existing value
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Type character by character for SPA frameworks that listen to input events
  for (const char of args.text) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value += char;
    } else {
      el.textContent = (el.textContent || "") + char;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));

  // Press Enter if requested
  let navigated = false;
  if (args.pressEnter) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));

    // Check if the input is inside a form — Enter may submit it
    const form = el.closest("form");
    if (form) {
      form.requestSubmit();
      navigated = true;
    }
  }

  return {
    success: true,
    result: `Typed "${args.text}" into [${args.id}]${args.pressEnter ? " and pressed Enter" : ""}`,
    navigated,
  };
}
```

#### `scroll_page`

```typescript
function executeScroll(args: ScrollPageArgs): { success: boolean; result: string; navigated: boolean } {
  const amount = args.amount ?? 500;
  const delta = args.direction === ScrollDirection.UP ? -amount : amount;

  window.scrollBy({ top: delta, behavior: "instant" });

  return {
    success: true,
    result: `Scrolled ${args.direction} by ${amount}px. New position: ${window.scrollY}/${document.documentElement.scrollHeight - window.innerHeight}`,
    navigated: false,
  };
}
```

#### `read_page`

```typescript
function executeRead(): { success: boolean; result: string; navigated: boolean } {
  const snapshot = buildSnapshot(true, true);

  // Format for the LLM
  const lines: string[] = [
    `Page: ${snapshot.title}`,
    `URL: ${snapshot.url}`,
    `Scroll: ${snapshot.scroll.y}/${snapshot.scroll.maxY}`,
    "",
    "Interactive elements:",
  ];

  for (const el of snapshot.elements) {
    const attrs = Object.entries(el.attributes).map(([k, v]) => `${k}="${v}"`).join(" ");
    lines.push(`  [${el.tag}] <${el.tagName}${attrs ? " " + attrs : ""}> "${el.text}"`);
  }

  if (snapshot.viewportText) {
    lines.push("", "Page text:", snapshot.viewportText);
  }

  return {
    success: true,
    result: lines.join("\n"),
    navigated: false,
  };
}
```

### 4. Anti-Modal Heuristics ("Janitor")
 
Run automatically on `document_idle` or when specific common modal patterns are detected.
 
```typescript
function runJanitor() {
  const COMMON_selectors = [
      "button[aria-label='Accept all']",
      "button[aria-label='Reject all']",
      ".cookie-banner button.primary",
      "#onetrust-accept-btn-handler", // OneTrust
      ".fc-cta-consent" // Google Funding Choices
  ];
  
  for (const sel of COMMON_selectors) {
      const el = document.querySelector(sel);
      if (el && isElementVisible(el)) {
          (el as HTMLElement).click();
          console.log("[QSidebar] Auto-clicked cookie banner:", sel);
      }
  }
}
```
 
### 5. Message Listener

```typescript
chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "DOM_SNAPSHOT_REQUEST") {
    const start = performance.now();
    const snapshot = buildSnapshot(
      message.payload.includeText,
      message.payload.refresh
    );
    sendResponse({
      type: "DOM_SNAPSHOT_RESPONSE",
      requestId: message.requestId,
      source: MessageSource.CONTENT,
      payload: {
        snapshot,
        durationMs: Math.round(performance.now() - start),
      },
    });
    return true;
  }

  if (message.type === "TOOL_EXECUTE") {
    const { toolName, args, toolCallId } = message.payload;
    const result = executeAction(toolName, args);
    Promise.resolve(result).then(res => {
      sendResponse({
        type: "TOOL_RESULT",
        requestId: message.requestId,
        source: MessageSource.CONTENT,
        payload: { toolCallId, ...res },
      });
    });
    return true;
  }
});
```

---

## Edge Cases

### iframes
Content scripts do NOT penetrate iframes. If the page has important interactive elements inside iframes, they will be invisible to the agent. This is an accepted limitation — cross-origin iframe access is blocked by the browser anyway. Same-origin iframes could be supported in a future version by recursively querying `iframe.contentDocument`.

### Shadow DOM
`document.querySelectorAll` does not pierce shadow DOM by default. For elements in open shadow roots, we recursively walk `element.shadowRoot`:

```typescript
function querySelectorAllDeep(root: ParentNode, selector: string): Element[] {
  const results = Array.from(root.querySelectorAll(selector));
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      results.push(...querySelectorAllDeep(el.shadowRoot, selector));
    }
  }
  return results;
}
```

Use `querySelectorAllDeep` instead of `document.querySelectorAll` in the tagging function.

### SPAs (Single-Page Applications)
SPAs change the page content without full navigation. The content script survives, but the tagged elements may be stale. The agent loop handles this by requesting a fresh snapshot (`refresh: true`) before each tool call.

### Dynamic content (lazy loading, infinite scroll)
Elements that load after the snapshot is taken are invisible. The `scroll_page` tool triggers a re-tag, which captures newly loaded elements.

### Overlapping elements (modals, dropdowns)
The tagging algorithm tags ALL visible interactive elements, including those in modals. The LLM sees them in the element list and can interact with them. Z-order is not communicated to the LLM — this is rarely a problem because the text labels are sufficient for disambiguation.

---

## File Paths

| File | Purpose |
|---|---|
| `src/content/content.ts` | All content script logic (single file) |
| `src/types/index.ts` | Type imports (`DomSnapshot`, `TaggedElement`, `ToolName`, etc.) |

---

## Testing

See [`08-testing-polish.md`](./08-testing-polish.md) for the full test strategy. Key tests for this phase:

- `tests/content/tagging.test.ts` — element discovery, visibility filtering, tag assignment
- `tests/content/actions.test.ts` — click, type, scroll, read execution
- `tests/content/snapshot.test.ts` — snapshot generation, text extraction

All tests use JSDOM (via Bun's built-in DOM support) with mock HTML documents.

---

## Open Questions

None — all decisions are final.
