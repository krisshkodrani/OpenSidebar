# RFC-020: Advanced Interaction Primitives (Drag, Hover, Visual Click)

* **Status:** Draft
* **Created:** 2026-02-15
* **Context:** Solves interaction gaps identified in the "30-step browser automation challenge" (sliders, hover menus, and non-DOM elements).

## 1. Summary

This RFC proposes adding three new interaction capabilities to the agent's toolset:

1. **`drag_element`**: A tool to simulate complex drag-and-drop sequences.
2. **`hover_element`**: A tool to trigger visibility changes for hover-dependent menus.
3. **`click_coordinates`**: A fallback tool for interacting with non-tagged UI elements (Canvas, games, obfuscated divs) using VLM-derived coordinates.

## 2. Motivation

The current `click_element` and `type_text` tools rely strictly on semantic DOM tagging. This fails in three common scenarios found in modern "Agent Benchmarks":

* **Kanban/Sliders:** Moving an item from "Todo" to "Done" or adjusting a price slider requires a continuous mouse event sequence (`mousedown`  `mousemove`  `mouseup`), which a simple `click` does not provide.
* **Mega-Menus:** Links often live inside `<div>`s that have `display: none` until a parent element is hovered. The agent currently cannot "see" these links because the snapshot filters out hidden elements.
* **Anti-Bot/Canvas UI:** Some applications use `<canvas>` for rendering (e.g., Google Maps, Games) or obscure event listeners that standard tagging misses. The agent can "see" the button in the screenshot but cannot click it because there is no `[ID]`.

## 3. Technical Design

### 3.1 New Content Script Actions (`src/content/actions.ts`)

We will export two new functions to handle the low-level event dispatching.

#### `dragElement(fromId: number, toId: number)`

Unlike a simple drag event, modern frameworks (React DnD, Vue Draggable) often track mouse coordinates. We must simulate the interpolation.

```typescript
export function dragElement(fromId: number, toId: number): void {
  const fromEl = tagMap.get(fromId);
  const toEl = tagMap.get(toId);
  if (!fromEl || !toEl) throw new Error(`Element not found: ${fromId} or ${toId}`);

  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();

  const startX = fromRect.left + fromRect.width / 2;
  const startY = fromRect.top + fromRect.height / 2;
  const endX = toRect.left + toRect.width / 2;
  const endY = toRect.top + toRect.height / 2;

  // 1. Mousedown on source
  fromEl.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true, cancelable: true, view: window, buttons: 1,
    clientX: startX, clientY: startY
  }));

  // 2. Fire generic dragstart (for native HTML5 DnD)
  const dataTransfer = new DataTransfer();
  fromEl.dispatchEvent(new DragEvent("dragstart", {
    bubbles: true, cancelable: true, view: window, dataTransfer
  }));

  // 3. Mousemove interpolation (10 steps)
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const curX = startX + (endX - startX) * t;
    const curY = startY + (endY - startY) * t;

    document.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true, cancelable: true, view: window, buttons: 1,
      clientX: curX, clientY: curY
    }));

    // Optional: Sleep 5-10ms between frames if possible, though sync is safer for consistency
  }

  // 4. Dragover/Drop on target
  toEl.dispatchEvent(new DragEvent("dragover", {
    bubbles: true, cancelable: true, view: window, dataTransfer,
    clientX: endX, clientY: endY
  }));

  toEl.dispatchEvent(new DragEvent("drop", {
    bubbles: true, cancelable: true, view: window, dataTransfer,
    clientX: endX, clientY: endY
  }));

  // 5. Mouseup on target
  toEl.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true, cancelable: true, view: window, buttons: 0,
    clientX: endX, clientY: endY
  }));
}

```

#### `hoverElement(tagId: number)`

Triggers the standard hover cascade.

```typescript
export function hoverElement(tagId: number): void {
  const el = tagMap.get(tagId);
  if (!el) throw new Error(`Element not found: ${tagId}`);

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const eventOpts = {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y
  };

  el.dispatchEvent(new MouseEvent("mouseover", eventOpts));
  el.dispatchEvent(new MouseEvent("mouseenter", eventOpts)); // No bubbles
  el.dispatchEvent(new MouseEvent("mousemove", eventOpts));
}

```

### 3.2 Tool Definitions (`src/background/tools/index.ts`)

Add the following schemas to the `WEB_TOOLS` array.

**1. `drag_element**`

```typescript
{
  name: "drag_element",
  description: "Drag an element and drop it onto another element. Use this for sorting lists, moving Kanban cards, or adjusting sliders.",
  parameters: {
    type: "object",
    properties: {
      sourceTag: { type: "integer", description: "The ID of the element to pick up" },
      targetTag: { type: "integer", description: "The ID of the element to drop onto" }
    },
    required: ["sourceTag", "targetTag"]
  }
}

```

**2. `hover_element**`

```typescript
{
  name: "hover_element",
  description: "Hover over an element. Use this to reveal dropdown menus, tooltips, or hidden buttons that only appear on hover.",
  parameters: {
    type: "object",
    properties: {
      tag: { type: "integer", description: "The ID of the element to hover over" }
    },
    required: ["tag"]
  }
}

```

**3. `click_coordinates**`

```typescript
{
  name: "click_coordinates",
  description: "Click specific X/Y coordinates on the screen. ONLY use this as a fallback if the element you want to click has no numeric tag [x].",
  parameters: {
    type: "object",
    properties: {
      x: { type: "number", description: "X coordinate in pixels" },
      y: { type: "number", description: "Y coordinate in pixels" },
      description: { type: "string", description: "What you are trying to click (for logging)" }
    },
    required: ["x", "y"]
  }
}

```

### 3.3 Visual Fallback Workflow (The "Blind" Click)

The `click_coordinates` tool is dangerous if the agent guesses coordinates blindly. We will introduce a **Visual Helper** pattern.

If the agent invokes `click_coordinates`, we ideally want it to be based on data. Since we cannot easily pass coordinates *into* the prompt for every pixel, we recommend the agent use a specific flow for Canvas/Games:

1. **Agent Logic:** "I see a 'Start Game' button in the screenshot, but there is no tag."
2. **Action:** Agent calls `click_coordinates` (attempting a guess) OR we provide a helper tool `look_and_click(description: string)`.

*Recommendation for this RFC:* Start with raw `click_coordinates`. The agent (specifically models like Claude 3.5 Sonnet or Grok 4.1 Vision) is surprisingly good at guessing relative coordinates if we provide `window.innerWidth/Height` in the system prompt.

**Update to `src/background/agent/loop.ts**`:
When `click_coordinates` is called:

1. Pass `x, y` to the content script.
2. Content script executes:
```typescript
document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent("click", ...));

```



## 4. Risks & Trade-offs

* **Drag Reliability:** React DnD and specific libraries often rely on internal state, not just DOM events. If `dragElement` fails, we may need to implement a more invasive `simulateDrag` that uses `DataTransfer` mocks.
* **Hover Persistence:** Hover effects usually disappear as soon as the mouse "leaves." The agent works in discrete steps. If step 1 is "hover menu" and step 2 is "click item," the menu might close between steps.
* *Mitigation:* The `hover_element` tool should NOT trigger a snapshot refresh immediately if we can avoid it, or we must ensure the `mousemove` position persists in the browser state during the snapshot.


* **Coordinate Drift:** Screen resolution changes between the VLM processing the image and the action execution (rare but possible).

## 5. Implementation Plan

1. **Modify `src/content/actions.ts**`: Add `dragElement` and `hoverElement`.
2. **Modify `src/content/content.ts**`: Add message listeners for `DRAG_ELEMENT` and `HOVER_ELEMENT`.
3. **Update `registry.ts**`: Wire up the new tools to the content script message passing.
4. **System Prompt Update**: Explicitly instruct the agent: *"If you need to move an item, use drag_element. If a menu is hidden, use hover_element."*

---

## Review & Status (2026-02-15)

### DONE

- **`drag_element` → `drag_and_drop`**: Fully implemented with dual-strategy approach in `actions.ts:723-840`. Uses pointer events (mousedown→mousemove interpolation→mouseup) as primary, with HTML5 DnD (dragstart→dragover→drop) as fallback. More robust than the RFC's single-strategy proposal.
- **`hover_element`**: Implemented in `actions.ts:478-497`. Dispatches mouseover→mouseenter→mousemove sequence as proposed.
- **Parameter naming**: The actual implementation correctly uses `id` for element references (matching project convention), not `sourceTag`/`targetTag` as proposed in this RFC.

### REMAINING: `click_coordinates`

The RFC's approach is sound but needs additional safeguards before implementation:

1. **Require `take_screenshot` first** — guard against blind coordinate guessing. The agent should only use `click_coordinates` after taking a screenshot to verify the visual target.
2. **Try `document.elementFromPoint()` first** — before dispatching a raw click, attempt to resolve the coordinates to a real DOM element. If found, prefer using the standard click path.
3. **Viewport dimensions in context** — already available in the DOM snapshot (scroll position, viewport size). No extra work needed.
4. **Risk level**: LOW for tool param naming (`x`, `y`, `description` as proposed). MEDIUM for misuse without screenshot guard.

### NOTES

- **Hover persistence gap**: The RFC correctly identified this issue (menu closes between hover step and click step). No good solution exists for discrete-step agents — the content script cannot hold hover state across async tool calls. Acceptable trade-off for now.
- **Drag reliability**: The dual-strategy implementation handles both React DnD-style (pointer events) and native HTML5 DnD apps, which is better than the RFC anticipated.