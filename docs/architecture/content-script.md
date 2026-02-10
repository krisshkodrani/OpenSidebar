# Content Script

The content script is OpenSidebar's "eyes and hands" — it runs in every tab and provides DOM access for the agent.

## Architecture

**Location:** `src/content/`

**Files:**

- `content.ts` - Main entry, message handling
- `snapshot.ts` - DOM snapshot generation
- `tagging.ts` - Element discovery and tagging
- `actions.ts` - Tool execution (click, type, scroll, etc.)
- `janitor.ts` - Cookie banner auto-dismiss

## DOM Snapshot

The content script produces a `DomSnapshot` that the LLM uses to understand the page:

```typescript
interface DomSnapshot {
  title: string; // Page title
  url: string; // Current URL
  elements: TaggedElement[]; // Interactive elements with tags
  viewportText: string; // Visible text content
  viewport: { width: number; height: number };
  scroll: { x: number; y: number; maxY: number };
}

interface TaggedElement {
  tag: number; // Numeric ID like [1], [2]
  tagName: string; // HTML tag
  role: string; // ARIA role or inferred
  text: string; // Visible text (truncated)
  attributes: Record<string, string>; // href, placeholder, etc.
  rect: ElementRect; // Position and size
  isVisible: boolean;
  isDisabled: boolean;
}
```

## Element Discovery

### Interactive Element Selectors

The content script tags 18 types of interactive elements:

```typescript
const INTERACTIVE_SELECTORS = [
  "a[href]", // Links
  "button", // Buttons
  "input:not([type='hidden'])", // Input fields
  "textarea", // Text areas
  "select", // Dropdowns
  "[role='button']", // ARIA buttons
  "[role='link']", // ARIA links
  "[role='tab']", // Tabs
  "[role='menuitem']", // Menu items
  "[role='checkbox']", // Checkboxes
  "[role='radio']", // Radio buttons
  "[role='switch']", // Switches
  "[role='combobox']", // Comboboxes
  "[contenteditable='true']", // Editable areas
  "summary", // Details summaries
  "details", // Details elements
  "[onclick]", // Click handlers
  "[tabindex]:not([tabindex='-1'])", // Focusable elements
];
```

### Visibility Detection

Elements are only tagged if they pass all visibility checks:

1. **Non-zero dimensions** - `width > 0 && height > 0`
2. **Not hidden via CSS** - `display !== "none"`, `visibility !== "hidden"`, `opacity !== "0"`
3. **Not clipped** - `clip !== "rect(0px, 0px, 0px, 0px)"`
4. **In document bounds** - Not scrolled entirely off-screen

### Tagging Algorithm

1. Clear old tags from previous snapshot
2. Query all matching elements
3. Filter by visibility
4. Assign incremental tags [1], [2], [3]...
5. Inject visual labels (yellow badges)
6. Build `TaggedElement` objects

**Maximum tags:** 200 elements (to keep context manageable)

## Actions

The content script executes these DOM actions:

### click_element

Clicks an element by its tag ID with safety checks:

1. **Scroll into view** - Ensures element is visible
2. **Z-index check** - Verifies element isn't covered by overlay
3. **Navigation detection** - Checks if click will navigate
4. **Event dispatch** - Fires mousedown, mouseup, click events
5. **Native click** - Calls `.click()` for native handling

```typescript
// Example
click_element({ id: 5 });
// Clicks element with tag [5]
```

### type_text

Types text into an input field:

1. **Focus** element
2. **Clear** existing value
3. **Type character by character** - Triggers input events for SPAs
4. **Dispatch change event**
5. **Optional Enter key** - Submits forms if requested

```typescript
// Example
type_text({ id: 12, text: "hello", pressEnter: true });
```

### scroll_page

Scrolls the page up or down:

```typescript
scroll_page({ direction: "down", amount: 500 });
```

### read_page

Returns a formatted snapshot:

```
Page: Example Title
URL: https://example.com
Scroll: 0/5000

Interactive elements:
  [1] <button> "Submit"
  [2] <input type="text" placeholder="Search"> ""
  [3] <a href="/about"> "About Us"

Page text:
Welcome to Example. This is the main content...
```

### hover_element

Hovers over an element to reveal tooltips or menus.

### find_element

Scrolls to and highlights an element containing specific text.

## Janitor (Anti-Modal)

Automatically dismisses common cookie banners on page load:

```typescript
const COMMON_SELECTORS = [
  "button[aria-label='Accept all']",
  "button[aria-label='Reject all']",
  ".cookie-banner button.primary",
  "#onetrust-accept-btn-handler", // OneTrust
  ".fc-cta-consent", // Google Funding Choices
];
```

The janitor runs on `document_idle` and clicks any visible matching elements.

## Message Protocol

### DOM_SNAPSHOT_REQUEST

Background requests a fresh snapshot:

```typescript
{
    type: "DOM_SNAPSHOT_REQUEST",
    requestId: string,
    source: "background",
    payload: {
        includeText: boolean,  // Include viewport text?
        refresh: boolean       // Re-tag elements?
    }
}
```

Response: `DOM_SNAPSHOT_RESPONSE` with the snapshot.

### TOOL_EXECUTE

Background requests action execution:

```typescript
{
    type: "TOOL_EXECUTE",
    requestId: string,
    source: "background",
    payload: {
        toolName: ToolName,
        args: Record<string, unknown>,
        toolCallId: string
    }
}
```

Response: `TOOL_RESULT` with success/failure and result text.

## Edge Cases

### iframes

Content scripts do not penetrate cross-origin iframes (browser security restriction). Same-origin iframes could be supported by recursively querying `iframe.contentDocument`.

### Shadow DOM

Standard `querySelectorAll` doesn't pierce shadow DOM. QSidebar uses a recursive deep query function to find elements inside open shadow roots:

```typescript
export function querySelectorAllDeep(
  root: Document | ShadowRoot | Element,
  selector: string,
  depth: number = 0,
): Element[] {
  // Prevent excessive recursion (max 3 levels)
  if (depth > MAX_SHADOW_DEPTH) return [];

  const results: Element[] = [];

  // Query in current root context
  results.push(...Array.from(root.querySelectorAll(selector)));

  // Find all elements that might have shadow roots
  const allElements = root.querySelectorAll("*");

  for (const el of allElements) {
    if (el.shadowRoot) {
      // Recursively query inside the shadow root
      const shadowResults = querySelectorAllDeep(
        el.shadowRoot,
        selector,
        depth + 1,
      );
      results.push(...shadowResults);
    }
  }

  // Remove duplicates
  return [...new Set(results)];
}
```

**Implementation Details:**

- **Depth Limiting:** Maximum 3 levels of shadow DOM nesting to prevent performance issues
- **Error Handling:** Gracefully handles closed shadow DOM (inaccessible by design)
- **Deduplication:** Removes duplicate elements found via multiple traversal paths
- **Performance:** Optimized to stop early if max elements (200) reached

**Supported Frameworks:**

- ✅ **Lit** - Full support for LitElement components
- ✅ **Stencil** - Full support for Ionic and Stencil apps
- ✅ **Angular Elements** - Full support for custom elements
- ✅ **Material Web** - Full support for MDC components
- ✅ **Vue 3** - Full support when using web components mode
- ⚠️ **Closed Shadow DOM** - Inaccessible by browser security design

**Coverage Impact:**

- **Before:** ~70% DOM coverage (standard DOM only)
- **After:** ~95% DOM coverage (includes open shadow DOM up to 3 levels)

See `docs/SHADOW_DOM_REPORT.md` for comprehensive implementation report.

### SPAs (Single-Page Applications)

Content script survives navigation, but tags become stale. The agent loop always requests fresh snapshots (`refresh: true`) before taking action.

### Dynamic Content

Elements loading after initial snapshot (lazy loading, infinite scroll) are captured on the next `read_page` or `scroll_page` call.

## Testing

**tests/content/tagging.test.ts** - Element discovery and visibility
**tests/content/snapshot.test.ts** - Snapshot generation
**tests/content/actions.test.ts** - Action execution

Tests use Happy DOM with mock HTML documents.
