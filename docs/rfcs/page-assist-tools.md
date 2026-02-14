# RFC: Page Assist Tools (`xray_page`, `fast_forward`)

## Problem

Pages with hidden elements, delayed reveals, and CSS-obscured content force the agent into slow multi-turn discovery loops (hover, wait, screenshot, execute_js). The Browser Navigation Challenge is a clear example: codes hidden behind `display:none`, `opacity:0`, and `setTimeout` delays waste 30-50% of turns.

These are generic DOM patterns — any site can hide content behind CSS or timers.

## Proposal

Add two new tools the agent can call when it decides the page is hiding content:

### `xray_page` — Reveal hidden DOM content

Injects a `<style>` that overrides common hiding patterns:

```css
* {
  visibility: visible !important;
  opacity: 1 !important;
}
[hidden], .hidden, [aria-hidden="true"] {
  display: block !important;
}
```

**Toggle behavior:** First call enables xray, second call disables it (removes the injected style). Returns current state ("enabled" / "disabled").

- The injected style has a unique `data-xray` attribute for reliable removal
- Does NOT persist across navigations (style is lost on page load)
- A fresh DOM snapshot is taken after toggling so the agent sees newly-revealed elements

### `fast_forward` — Accelerate page timers

Monkey-patches `setTimeout` and `setInterval` to fire at 10x speed (delay clamped to `Math.min(original, 10)`):

```js
const _setTimeout = window.setTimeout;
const _setInterval = window.setInterval;
window.setTimeout = (fn, delay, ...a) => _setTimeout(fn, Math.min(delay || 0, 10), ...a);
window.setInterval = (fn, delay, ...a) => _setInterval(fn, Math.max(Math.min(delay || 0, 10), 1), ...a);
```

**Toggle behavior:** First call enables, second call restores originals. Returns current state.

- Stores original functions on a namespaced global (`__osb_origTimers`) for clean restore
- Does NOT persist across navigations
- Fires all pending delayed content essentially immediately

## Implementation

### 1. Types (`src/types/index.ts`)

```ts
// Add to ToolName enum:
XRAY_PAGE = "xray_page",
FAST_FORWARD = "fast_forward",

// Add arg types:
export interface XrayPageArgs {}
export interface FastForwardArgs {}

// Add to ToolArgsMap:
[ToolName.XRAY_PAGE]: XrayPageArgs;
[ToolName.FAST_FORWARD]: FastForwardArgs;
```

No parameters needed — both are simple toggles.

### 2. Tool Definitions & Registration (`src/background/tools/index.ts`)

```ts
const XRAY_PAGE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.XRAY_PAGE,
    description: "Toggle X-ray mode: forces all hidden elements visible (overrides display:none, opacity:0, visibility:hidden). Call again to disable. Use when you suspect content is hidden by CSS.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const FAST_FORWARD_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.FAST_FORWARD,
    description: "Toggle fast-forward mode: accelerates all page timers (setTimeout/setInterval) to fire instantly. Use when content appears after a countdown or timed delay. Call again to restore normal timing.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};
```

Both execute via `chrome.scripting.executeScript` with `world: "MAIN"` (same as `execute_js`), not through the content script bridge. This ensures they run in the page's JS context where `setTimeout`/`setInterval` live.

```ts
toolRegistry.register(ToolName.XRAY_PAGE, XRAY_PAGE_DEF, async (_args, tabId) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as any,
    func: () => {
      const existing = document.querySelector('style[data-osb-xray]');
      if (existing) {
        existing.remove();
        return "X-ray disabled. Hidden elements are hidden again.";
      }
      const s = document.createElement('style');
      s.setAttribute('data-osb-xray', 'true');
      s.textContent = `
        * { visibility: visible !important; opacity: 1 !important; }
        [hidden], .hidden, [aria-hidden="true"] { display: block !important; }
      `;
      document.head.appendChild(s);
      return "X-ray enabled. All hidden elements are now visible. Call read_page to see them.";
    },
  });
  return results?.[0]?.result ?? "X-ray toggled.";
});

toolRegistry.register(ToolName.FAST_FORWARD, FAST_FORWARD_DEF, async (_args, tabId) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as any,
    func: () => {
      const g = globalThis as any;
      if (g.__osb_origTimers) {
        // Restore originals
        window.setTimeout = g.__osb_origTimers.setTimeout;
        window.setInterval = g.__osb_origTimers.setInterval;
        delete g.__osb_origTimers;
        return "Fast-forward disabled. Timers restored to normal speed.";
      }
      // Save originals and patch
      g.__osb_origTimers = {
        setTimeout: window.setTimeout.bind(window),
        setInterval: window.setInterval.bind(window),
      };
      const origST = g.__osb_origTimers.setTimeout;
      const origSI = g.__osb_origTimers.setInterval;
      (window as any).setTimeout = (fn: any, delay?: number, ...a: any[]) =>
        origST(fn, Math.min(delay || 0, 10), ...a);
      (window as any).setInterval = (fn: any, delay?: number, ...a: any[]) =>
        origSI(fn, Math.max(Math.min(delay || 0, 10), 1), ...a);
      return "Fast-forward enabled. All timers now fire instantly.";
    },
  });
  return results?.[0]?.result ?? "Fast-forward toggled.";
});
```

### 3. Tool Metadata (`src/background/tools/metadata.ts`)

```ts
[ToolName.XRAY_PAGE]:     { risk: RiskLevel.LOW,  domModifying: true,  sequential: false },
[ToolName.FAST_FORWARD]:  { risk: RiskLevel.LOW,  domModifying: false, sequential: false },
```

- `xray_page` is `domModifying: true` so the loop refreshes the DOM snapshot after (reveals new elements to tag)
- `fast_forward` is `domModifying: false` — it changes timing behavior, not the DOM itself
- Both are LOW risk (reversible, page-local, no data leaves the browser)
- Neither is sequential — safe to call in parallel with other tools

### 4. Content Script — No changes needed

Both tools use `chrome.scripting.executeScript` directly from the service worker (like `execute_js`). They don't go through the content script message bridge.

## Restoration Without Page Refresh

A key requirement: the challenge page must **never** be refreshed — a refresh resets the timer and loses progress.

**Both tools restore cleanly without any page refresh:**

| Tool | Enable | Disable | Side effects after disable |
|------|--------|---------|---------------------------|
| `xray_page` | Appends `<style data-osb-xray>` | `element.remove()` — CSS is declarative, removing the stylesheet instantly restores original styles | None. DOM unchanged. |
| `fast_forward` | Monkey-patches `window.setTimeout`/`setInterval` | Restores originals from `__osb_origTimers` | Timers that already fired fast stay fired (that's the point — content was revealed). New timers run at normal speed. |

**What `domModifying: true` means for `xray_page`:** It does NOT reload the page. It tells the agent loop to request a fresh DOM snapshot from the content script (re-scans and re-tags elements). This is a lightweight in-memory operation — no navigation, no HTTP request, no page reload.

**No accidental refresh paths exist.** The only code that triggers a real page navigation is the `navigate` tool (`chrome.tabs.update(tabId, { url })`) and `go_back`/`go_forward`. The agent must explicitly call these tools — there's no implicit refresh anywhere in the snapshot or tagging pipeline.

## What This Doesn't Do

- **No settings toggle.** These are agent-callable tools, available like any other tool. The agent decides when to use them based on context.
- **No auto-activation.** The agent must explicitly call the tool — it won't run on page load.
- **No persistence.** Both reset on navigation. The agent re-applies if needed on a new page.

## File Changes

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `XRAY_PAGE`, `FAST_FORWARD` to `ToolName`, arg types, `ToolArgsMap` entries |
| `src/background/tools/index.ts` | Add definitions + registration (two `toolRegistry.register` calls) |
| `src/background/tools/metadata.ts` | Add metadata entries for both tools |

Tool count: 22 → 24.

## Risks

- **CSS conflicts:** `!important` overrides could break page layout (buttons misaligned, overlapping text). Mitigated by toggle — agent can disable if it breaks things.
- **Timer side effects:** Fast-forwarding timers could trigger rate-limited API calls or animation glitches on some sites. Mitigated by toggle + no persistence across navigation.
- **Token cost:** Two more tool definitions in every request. Minimal — ~80 tokens combined for both definitions.

## Future Extensions

- `xray_page` could accept an optional CSS selector to scope the override (e.g., only reveal elements inside a container)
- `fast_forward` could accept a speed multiplier instead of hard-clamping to 10ms
- A `freeze_page` tool could stop all timers/animations entirely (useful for flashing content)
