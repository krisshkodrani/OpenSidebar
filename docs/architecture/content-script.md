# Content Script

The content script is OpenSidebar's "eyes and hands" — it runs in every tab and provides DOM access for the agent.

## Architecture

**Location:** `src/content/`

**Files:**

- `content.ts` - Main entry, message handling, Janitor for cookie banner auto-dismiss
- `snapshot.ts` - DOM snapshot generation
- `tagging.ts` - Element discovery, tagging, label association, dynamic tagging
- `actions.ts` - Tool execution (click, type, scroll, select, press_key, drag, hide, etc.)

## DOM Snapshot

The content script produces a `DomSnapshot` that the LLM uses to understand the page:

```typescript
interface DomSnapshot {
  title: string; // Page title
  url: string; // Current URL
  elements: TaggedElement[]; // Interactive elements with tags
  visibleContent: string; // Visible text content
  viewport: { width: number; height: number };
  scroll: { x: number; y: number; maxY: number };
  survivingOverlays?: { tagId: number; coveragePercent: number }[];
  capturedTexts?: string[];
}

interface TaggedElement {
  tag: number; // Numeric ID like [1], [2]
  tagName: string; // HTML tag
  role: string; // ARIA role or inferred
  text: string; // Visible text (truncated)
  attributes: Record<string, string>; // href, placeholder, aria-label, type, name
  rect: ElementRect; // Position and size
  isVisible: boolean;
  isDisabled: boolean;
}
```

## Element Discovery

### Interactive Element Selectors

The content script tags 20+ types of interactive elements:

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
  "canvas", // Canvas elements
  "[draggable='true']", // Draggable elements (for drag_and_drop)
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
4. Score elements by task relevance (`scoreElement()` — form inputs +10, draggables +8, submit/file +8, canvas +6, named +5)
5. Sort candidates by score (highest first, stable sort)
6. Assign incremental tags [1], [2], [3]...
7. Inject visual labels (yellow badges)
8. Build `TaggedElement` objects

**Default cap:** 50 elements (75 on pages with draggable/dropzone elements)

### Dynamic Tag Pinning

Elements found via `find_element` are assigned dynamic tags through `addDynamicTag()`:

- **TTL**: Pinned for 3 snapshot refresh cycles (`cyclesRemaining`)
- **Overflow**: 5 extra slots beyond the effective element cap
- **Cleanup**: Elements removed from the DOM are cleaned up immediately
- **Near-identical collapse**: Groups similar elements (same tag + text), keeps max 2 per group

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
// or
scroll_page({ direction: "top" });
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

Hovers over an element to reveal tooltips or menus. Dispatches synthetic `mouseover`, `mouseenter`, and `mousemove` events (triggers JS handlers). Also forces CSS `:hover` styles by scanning stylesheets for matching `:hover` rules, rewriting them with a `.--os-hover-active` class selector, and applying the class to the element and its ancestors. This workaround is necessary because synthetic mouse events don't activate the CSS `:hover` pseudo-class — only real mouse input (or CDP `Input.dispatchMouseEvent`) does.

### find_element

Finds text on the page using `window.find()`, then walks up the DOM from the matched text node to find the nearest interactive or semantic container element. Assigns a dynamic tag ID via `addDynamicTag()` so the agent can interact with the found element.

Returns: `Found "text" near [tagId] <tagname> "context". Use tag [tagId] to interact with it.`

Walk-up strategy:

1. Check each ancestor against interactive selectors (`a[href]`, `button`, `input`, etc.)
2. Check semantic containers (`p`, `li`, `td`, `h1`-`h6`, `form`, etc.)
3. Fallback to direct parent element

### select_option

Selects an option from a `<select>` dropdown by matching text or value.

### press_key

Dispatches `keydown` + `keyup` events on `window` for the specified key. Supports optional modifier keys (`ctrl`, `shift`, `alt`, `meta`).

### drag_and_drop

Full drag sequence between two tagged elements: `dragstart` → `dragover` → `drop` → `dragend` with a `DataTransfer` object.

### hide_element

Sets `element.style.display = "none"` on a tagged element. Useful for dismissing overlay modals without clicking (which might trigger navigation).

### read_element

Reads a specific attribute (href, src, value) of an element. For visible text, check the page snapshot first.

### execute_js

Runs JavaScript code in the page context using `eval()`.

### right_click

Dispatches a contextmenu event on the element.

### set_checkbox

Sets checkbox/radio state to checked/unchecked, firing input and change events.

### click_coordinates

Clicks at specific viewport X/Y coordinates.

### inspect_hidden

Scans for hidden DOM elements (display:none, visibility:hidden, opacity:0, off-screen, etc.).

## Janitor (Modal Auto-Dismiss)

The `runJanitor()` function in `content.ts` automatically dismisses common cookie consent banners, overlay modals, and notification popups on page load. It uses heuristic selectors for common frameworks:

- OneTrust: `#onetrust-accept-btn-handler`
- Google Funding Choices: `.fc-cta-consent`
- Generic: `.cookie-banner button.primary`, `button[aria-label='Accept all']`

**Broadened overlay detection (Sprint 3):**

- `[aria-modal='true']`, `dialog[open]`, `<dialog>` elements
- `[data-modal]`, `[data-overlay]`, `[data-popup]` data attributes
- `.lightbox`, `.notification`, `.toast`, `.backdrop` class patterns
- Viewport coverage threshold lowered from 30% to 15%

The background can also trigger dismissal via the `DISMISS_MODALS` message.

### Surviving Overlays

If auto-dismiss cannot remove a viewport-covering overlay, it's included in the DOM snapshot as `survivingOverlays`, telling the agent to handle it manually.

## Extension Element Filtering

The tagging pipeline excludes elements injected by the extension itself (e.g., the floating Stop button, legacy label overlays). `isOwnElement()` in `dom-traversal.ts` checks element IDs and CSS classes against a known set. This prevents the agent from targeting its own UI as if it were part of the page.

## Label Association

The `extractAttributes()` function in `tagging.ts` resolves label associations for form elements:

- **Explicit**: `<label for="id">` matches by element ID
- **Implicit**: `<label>` wrapper around the element
- **ARIA**: `aria-labelledby` attribute reference

Resolved labels appear as `label="..."` in `TaggedElement.attributes`.

## Message Protocol

### DOM_SNAPSHOT_REQUEST

Background requests a fresh snapshot:

```typescript
{
    type: "DOM_SNAPSHOT_REQUEST",
    requestId: string,
    source: "background",
    payload: {
        includeText: boolean,  // Include visible content?
        refresh: boolean,     // Re-tag elements?
        showTags?: boolean    // Render visual [N] overlays?
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
   : `TOOL }
}
```

Response_RESULT` with success/failure and result text.

### DISMISS_MODALS

Background triggers manual modal dismissal:

```typescript
{
    type: "DISMISS_MODALS",
    requestId: string,
    source: "background",
    payload: {}
}
```

Response: `DISMISS_MODALS_RESPONSE` with dismissed count, remaining overlay info, and captured texts.

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

### SPAs (Single-Page Applications)

Content script survives navigation, but tags become stale. The agent loop always requests fresh snapshots (`refresh: true`) before taking action.

### Dynamic Content

Elements loading after initial snapshot (lazy loading, infinite scroll) are captured on the next `read_page` or `scroll_page` call.

## Testing

**tests/content/tagging.test.ts** - Element discovery and visibility
**tests/content/snapshot.test.ts** - Snapshot generation
**tests/content/actions.test.ts** - Action execution
**tests/content/overlay-detection.test.ts** - Overlay detection broadening
**tests/background/sprint3-loop.test.ts** - Dead-end detection

Tests use Happy DOM with mock HTML documents.
