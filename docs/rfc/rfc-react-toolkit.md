# RFC: On-Demand React Toolkit (Auto-Detect + Inject)

## Status

Proposed

## Problem

React powers the majority of modern web apps, including the Browser Navigation Challenge site. The agent's current tool set operates purely at the DOM level — it can click elements, read text, and inspect CSS-hidden nodes, but it cannot see or interact with React's component layer. This creates three systematic failure modes:

### 1. Invisible state

React components hold state (`useState`, `useReducer`, context) that drives rendering. A challenge step that sets `setCode("X7K2M9")` with a 3-second delay stores the code in fiber state before it ever hits the DOM. The agent has no way to read it early, so it either waits blindly or calls `execute_js` with a hand-crafted script that may or may not guess the right variable name.

More broadly on real-world sites: form validation errors, auth state, loading flags, feature toggles, and shopping cart contents all live in React state and are invisible to `read_page`.

### 2. Controlled input failure

React controlled components (`<input value={state} onChange={handler}>`) intercept DOM value writes. The agent's `type_text` tool dispatches `InputEvent` and `Event('change')`, but React's synthetic event system requires the native value setter trick to properly trigger `onChange`. When this fails, the agent sees the field is still empty, retries, escalates — wasting 3-5 turns on what should be 1.

This is the #1 automation failure on React forms across the web, not just the challenge.

### 3. Opaque component structure

`read_page` returns a flat list of DOM elements. On a React SPA, the meaningful structure is the component tree — `App > Router > ChallengePage > CodeRevealer > CodeInput`. Component names are self-documenting in ways that `<div class="css-1a2b3c">` is not. Without this structure, the agent wastes turns on exploratory `read_page` and `find_element` calls trying to understand the page.

### Why not just use `execute_js`?

The agent *can* use `execute_js` to probe React internals, but it has to:
1. Know that React is present (no signal in the current snapshot)
2. Guess the correct fiber key pattern (`__reactFiber$`, `__reactInternalInstance$`, etc.)
3. Write correct JS to walk the fiber tree, handle edge cases, and format output
4. Do this fresh every time because the conversation compresses away previous attempts

A dedicated tool encapsulates this complexity and makes the capability discoverable via the tool description.

## Design

### Detection: Content Script Probes for React on Every Snapshot

When the content script builds a DOM snapshot (`DOM_SNAPSHOT_REQUEST`), it runs a lightweight detection check and includes the result in the snapshot payload. The background then conditionally enables React tools for that session.

**Detection logic (content script):**

```typescript
function detectFramework(): FrameworkInfo | null {
  // React 16+ (fiber)
  const reactRoot = document.getElementById("root") ?? document.getElementById("__next") ?? document.querySelector("[data-reactroot]");
  if (reactRoot) {
    const fiberKey = Object.keys(reactRoot).find(k =>
      k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    if (fiberKey) {
      const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const version = hook?.renderers?.values().next().value?.version ?? "unknown";
      return { name: "react", version, fiberKey };
    }
  }
  // Future: Vue, Angular, Svelte detection would go here
  return null;
}
```

**Cost:** ~0.1ms. One `getElementById` + one `Object.keys` scan. Runs once per snapshot, not per element.

### Snapshot Payload Extension

```typescript
// In DomSnapshot (src/types/index.ts)
export interface DomSnapshot {
  // ... existing fields ...
  framework?: FrameworkInfo | null;
}

export interface FrameworkInfo {
  name: string;       // "react"
  version: string;    // "18.2.0" or "unknown"
  fiberKey: string;   // "__reactFiber$abc123" — needed by tools
}
```

### Tool Gating: Background Conditionally Enables React Tools

The agent loop reads `snapshot.framework` after the first snapshot refresh and toggles a `reactToolsEnabled` flag. React tool definitions are always registered in `ToolRegistry`, but excluded by default via `disabledTools`.

**In `loop.ts`, inside the main loop after `refreshSnapshot()`:**

```typescript
// After first snapshot, check for React
if (!reactToolsEnabled && this.context.getSnapshot()?.framework?.name === "react") {
  reactToolsEnabled = true;
  this.disabledTools.delete(ToolName.INSPECT_REACT);
  this.disabledTools.delete(ToolName.REACT_SET_INPUT);
  this.disabledTools.delete(ToolName.INSPECT_REACT_TREE);
  this.disabledTools.delete(ToolName.WAIT_FOR_REACT);
  logger.info("agent", "React detected, enabling React toolkit", {
    version: this.context.getSnapshot()!.framework!.version,
  });
}
```

**Why gate by default?** Non-React pages should never see these tools. 4 tool schemas × ~50 tokens each = ~200 tokens wasted per turn on every non-React page. Gating keeps the token budget at zero for the common case.

**Why not unregister/re-register dynamically?** The registry is a singleton shared across workspaces. Conditional inclusion via `disabledTools` (already used for other purposes) is simpler and workspace-safe.

### Tool Execution: `chrome.scripting.executeScript` (MAIN World)

All four React tools execute in the page's MAIN world (not the isolated content script world) because React's fiber tree and `__REACT_DEVTOOLS_GLOBAL_HOOK__` live on the page's `window` object. This is the same pattern used by `inspect_hidden`.

```typescript
// Background executor pattern (same as inspect_hidden)
async (args, tabId) => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: inspectReactFunc,   // serialized function
    args: [args],
  });
  return result.result as string;
}
```

This avoids the content script bridge entirely — `chrome.scripting.executeScript` runs directly in the page context.

## The Four Tools

### 1. `inspect_react` — Read component state/props for a tagged element

**Purpose:** Given a tagged element ID, walk up the fiber tree to the nearest component with meaningful state and return its name, props, and state values.

**Schema:**

```typescript
{
  name: "inspect_react",
  description: "Read React component name, props, and state for a tagged element. Use when you need to see data that isn't visible in the DOM (hidden values, form state, loading flags).",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "integer",
        description: "Tag ID of the element to inspect."
      },
      depth: {
        type: "integer",
        description: "How many parent components to traverse (default 3)."
      }
    },
    required: ["id"]
  }
}
```

**Execution (MAIN world):**

```typescript
function inspectReactFunc(args: { id: number; depth?: number }): string {
  const maxDepth = args.depth ?? 3;

  // Find the DOM element by tag label
  const label = document.querySelector(`[data-os-tag="${args.id}"]`);
  const el = label?.previousElementSibling ?? document.querySelector(`[data-tag-id="${args.id}"]`);
  if (!el) return `Error: No element with tag [${args.id}]`;

  // Find React fiber
  const fiberKey = Object.keys(el).find(k =>
    k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
  );
  if (!fiberKey) return "No React fiber found on this element.";

  let fiber = (el as any)[fiberKey];
  const components: any[] = [];
  let walked = 0;

  // Walk up fiber tree to find components with state
  while (fiber && walked < maxDepth) {
    if (fiber.memoizedState !== null || fiber.memoizedProps) {
      const name = fiber.elementType?.displayName
        ?? fiber.elementType?.name
        ?? fiber.type?.displayName
        ?? fiber.type?.name;
      if (name && typeof name === "string" && name[0] === name[0].toUpperCase()) {
        // Extract state from hooks chain
        const state = extractHooksState(fiber.memoizedState);
        const props = sanitizeProps(fiber.memoizedProps);
        components.push({ component: name, props, state });
        walked++;
      }
    }
    fiber = fiber.return;
  }

  if (components.length === 0) return "No React components with state found above this element.";
  return JSON.stringify(components, null, 2);
}

function extractHooksState(memoizedState: any): any[] {
  // React hooks are a linked list: { memoizedState, next }
  const values: any[] = [];
  let hook = memoizedState;
  while (hook && values.length < 10) {
    const val = hook.memoizedState;
    // Skip functions, refs, effects — keep primitives, objects, arrays
    if (val !== undefined && typeof val !== "function") {
      if (val?.current !== undefined) {
        // useRef — include if primitive
        if (typeof val.current !== "function") values.push({ ref: val.current });
      } else if (val?.queue !== undefined) {
        // useState/useReducer internal shape
        values.push(val.memoizedState ?? val);
      } else {
        values.push(val);
      }
    }
    hook = hook.next;
  }
  return values;
}

function sanitizeProps(props: any): Record<string, any> {
  if (!props || typeof props !== "object") return {};
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === "children") continue;  // Too noisy
    if (typeof v === "function") { clean[k] = "[function]"; continue; }
    if (typeof v === "object" && v !== null) {
      try { clean[k] = JSON.parse(JSON.stringify(v)); } catch { clean[k] = "[object]"; }
      continue;
    }
    clean[k] = v;
  }
  return clean;
}
```

**Output example:**

```json
[
  {
    "component": "CodeRevealer",
    "props": { "delay": 3000, "step": 7 },
    "state": [{ "code": "X7K2M9", "revealed": false }]
  },
  {
    "component": "ChallengePage",
    "props": { "stepNumber": 7 },
    "state": [{ "timer": 234, "completed": false }]
  }
]
```

**Metadata:** `{ risk: RiskLevel.LOW, domModifying: false, sequential: false }`

**Discovery tool:** Yes — add to `DISCOVERY_TOOLS` in `context.ts` (gets 500-char compression limit).

### 2. `react_set_input` — Properly update React controlled inputs

**Purpose:** Set a React controlled input's value using the native value setter + synthetic event dispatch. This is the canonical workaround for React's controlled component pattern.

**Schema:**

```typescript
{
  name: "react_set_input",
  description: "Set a React controlled input value. Use when type_text doesn't update the field (React controlled components ignore direct DOM writes). Falls back to standard input events if React is not managing this element.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "integer",
        description: "Tag ID of the input element."
      },
      value: {
        type: "string",
        description: "The value to set."
      },
      submit: {
        type: "boolean",
        description: "Press Enter after setting value (default false)."
      }
    },
    required: ["id", "value"]
  }
}
```

**Execution (MAIN world):**

```typescript
function reactSetInputFunc(args: { id: number; value: string; submit?: boolean }): string {
  const label = document.querySelector(`[data-os-tag="${args.id}"]`);
  const el = label?.previousElementSibling ?? document.querySelector(`[data-tag-id="${args.id}"]`);
  if (!el) return `Error: No element with tag [${args.id}]`;

  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    return `Error: Element [${args.id}] is not an input (${el.tagName.toLowerCase()})`;
  }

  // Focus the element
  el.focus();

  // Use native value setter to bypass React's controlled component guard
  const descriptor =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ??
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(el, args.value);
  } else {
    el.value = args.value;  // Fallback for non-React
  }

  // Dispatch events React listens for
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));

  // Optional: submit by pressing Enter
  if (args.submit) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }

  return `Set [${args.id}] value to "${args.value.slice(0, 50)}"${args.submit ? " and pressed Enter" : ""}`;
}
```

**Metadata:** `{ risk: RiskLevel.MEDIUM, domModifying: true, sequential: false }`

### 3. `inspect_react_tree` — Component tree overview

**Purpose:** Walk the React fiber tree from the root, returning a compact component hierarchy. Gives the agent a "table of contents" for the page in one call.

**Schema:**

```typescript
{
  name: "inspect_react_tree",
  description: "Show the React component tree structure with state summaries. Use to understand page organization when the DOM structure is unclear.",
  parameters: {
    type: "object",
    properties: {
      depth: {
        type: "integer",
        description: "Max tree depth to traverse (default 5, max 10)."
      },
      filter: {
        type: "string",
        description: "Only show components whose name contains this string (case-insensitive)."
      }
    }
  }
}
```

**Execution (MAIN world):**

```typescript
function inspectReactTreeFunc(args: { depth?: number; filter?: string }): string {
  const maxDepth = Math.min(args.depth ?? 5, 10);
  const filter = args.filter?.toLowerCase() ?? null;

  // Find React root
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  let rootFiber: any = null;

  if (hook?.getFiberRoots) {
    for (const [, roots] of hook.getFiberRoots) {
      for (const root of roots) {
        rootFiber = root.current;
        break;
      }
      if (rootFiber) break;
    }
  }

  // Fallback: find fiber from a known root element
  if (!rootFiber) {
    const rootEl = document.getElementById("root") ?? document.getElementById("__next");
    if (rootEl) {
      const key = Object.keys(rootEl).find(k => k.startsWith("__reactFiber$"));
      if (key) rootFiber = (rootEl as any)[key];
    }
  }

  if (!rootFiber) return "No React root found.";

  const lines: string[] = [];
  walkFiber(rootFiber, 0, maxDepth, filter, lines);

  if (lines.length === 0 && filter) return `No components matching "${args.filter}" found.`;
  if (lines.length === 0) return "React root found but no named components in tree.";

  return lines.join("\n");
}

function walkFiber(
  fiber: any, depth: number, maxDepth: number,
  filter: string | null, lines: string[]
): void {
  if (!fiber || depth > maxDepth || lines.length > 60) return;

  const name = fiber.elementType?.displayName
    ?? fiber.elementType?.name
    ?? fiber.type?.displayName
    ?? fiber.type?.name;

  const isNamedComponent = name && typeof name === "string" && name[0] === name[0].toUpperCase();

  if (isNamedComponent) {
    const matchesFilter = !filter || name.toLowerCase().includes(filter);
    if (matchesFilter) {
      const indent = "  ".repeat(depth);
      const stateHint = fiber.memoizedState ? summarizeState(fiber.memoizedState) : "";
      const propsHint = summarizeProps(fiber.memoizedProps);
      lines.push(`${indent}${name}${propsHint}${stateHint}`);
    }
  }

  // Recurse: child first, then sibling
  walkFiber(fiber.child, isNamedComponent ? depth + 1 : depth, maxDepth, filter, lines);
  walkFiber(fiber.sibling, depth, maxDepth, filter, lines);
}

function summarizeState(memoizedState: any): string {
  const vals: string[] = [];
  let hook = memoizedState;
  while (hook && vals.length < 4) {
    const v = hook.memoizedState;
    if (v !== undefined && v !== null && typeof v !== "function") {
      if (typeof v === "string") vals.push(`"${v.slice(0, 20)}"`);
      else if (typeof v === "number" || typeof v === "boolean") vals.push(String(v));
      else if (Array.isArray(v)) vals.push(`[${v.length}]`);
    }
    hook = hook.next;
  }
  return vals.length > 0 ? ` state=[${vals.join(", ")}]` : "";
}

function summarizeProps(props: any): string {
  if (!props || typeof props !== "object") return "";
  const keys = Object.keys(props).filter(k =>
    k !== "children" && typeof props[k] !== "function"
  );
  if (keys.length === 0) return "";
  const hints = keys.slice(0, 3).map(k => {
    const v = props[k];
    if (typeof v === "string") return `${k}="${v.slice(0, 15)}"`;
    if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
    return null;
  }).filter(Boolean);
  return hints.length > 0 ? ` (${hints.join(", ")})` : "";
}
```

**Output example:**

```
App
  BrowserRouter
    Routes
      ChallengePage (stepNumber=7)
        Header (title="Step 7") state=["Timer: 234s"]
        CodeRevealer (delay=3000) state=["X7K2M9", false]
        CodeInput state=[""]
        SubmitButton (disabled=false)
        StepIndicator (total=30, current=7)
```

**Metadata:** `{ risk: RiskLevel.LOW, domModifying: false, sequential: false }`

**Discovery tool:** Yes — add to `DISCOVERY_TOOLS` in `context.ts`.

### 4. `wait_for_react` — Wait for renders to settle

**Purpose:** Poll until React has no pending state updates, Suspense boundaries have resolved, and the fiber tree is stable. Replaces blind `wait({ seconds: 1 })` with a semantic "wait until React is done."

**Schema:**

```typescript
{
  name: "wait_for_react",
  description: "Wait for React to finish rendering (pending state updates, Suspense, transitions). Use after an action that triggers async state changes instead of a blind wait.",
  parameters: {
    type: "object",
    properties: {
      timeout: {
        type: "integer",
        description: "Max wait time in ms (default 3000, max 10000)."
      }
    }
  }
}
```

**Execution (MAIN world):**

```typescript
async function waitForReactFunc(args: { timeout?: number }): Promise<string> {
  const timeout = Math.min(args.timeout ?? 3000, 10000);
  const start = Date.now();
  let lastTree = "";
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const currentTree = snapshotFiberIds();

    if (currentTree === lastTree) {
      stableCount++;
      if (stableCount >= 3) {
        // Fiber tree unchanged for 3 consecutive polls → stable
        return `React idle after ${Date.now() - start}ms`;
      }
    } else {
      stableCount = 0;
      lastTree = currentTree;
    }

    await new Promise(r => setTimeout(r, 100));
  }

  return `React may still be updating (timed out after ${timeout}ms)`;
}

function snapshotFiberIds(): string {
  // Quick fingerprint of the fiber tree — just count named components + their state hashes
  const rootEl = document.getElementById("root") ?? document.getElementById("__next");
  if (!rootEl) return "";
  const key = Object.keys(rootEl).find(k => k.startsWith("__reactFiber$"));
  if (!key) return "";

  const parts: string[] = [];
  let fiber = (rootEl as any)[key];
  const stack = [fiber];
  let visited = 0;

  while (stack.length > 0 && visited < 200) {
    const f = stack.pop();
    if (!f) continue;
    visited++;

    const name = f.elementType?.name ?? f.type?.name;
    if (name && typeof name === "string") {
      const stateKey = f.memoizedState ? String(f.memoizedState.memoizedState).slice(0, 20) : "";
      parts.push(`${name}:${stateKey}`);
    }
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }

  return parts.join("|");
}
```

**Metadata:** `{ risk: RiskLevel.LOW, domModifying: false, sequential: true }`

Note: sequential because the agent should wait for stability before acting, and the tool involves an async polling loop.

## Integration Points

### Files to modify

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `FrameworkInfo` interface, add `framework?` to `DomSnapshot`, add 4 `ToolName` enum members, add 4 arg interfaces, extend `ToolArgsMap` |
| `src/content/content.ts` | Call `detectFramework()` in `DOM_SNAPSHOT_REQUEST` handler, include in snapshot payload |
| `src/content/framework-detect.ts` | **New file.** `detectFramework()` function (~30 lines) |
| `src/background/tools/react.ts` | **New file.** 4 tool definitions + 4 MAIN-world executor functions |
| `src/background/tools/index.ts` | Import and register 4 React tools from `react.ts` |
| `src/background/tools/metadata.ts` | Add 4 entries to `TOOL_META` |
| `src/background/agent/loop.ts` | Add `reactToolsEnabled` flag, check `snapshot.framework` after first refresh, remove React tools from `disabledTools` when detected |
| `src/background/agent/context.ts` | Add `inspect_react` and `inspect_react_tree` to `DISCOVERY_TOOLS` |

### New files

**`src/content/framework-detect.ts`** (~30 lines) — Framework detection utility. Isolated so it can be tested independently and extended for Vue/Angular/Svelte later.

**`src/background/tools/react.ts`** (~250 lines) — All React tool definitions and executor functions. Keeps the main `tools/index.ts` from growing further. Follows the pattern of defining `ToolDefinition` objects and exporting a `registerReactTools(registry)` function.

### Initialization flow

```
Page load
  → content script injected
  → DOM_SNAPSHOT_REQUEST received
  → detectFramework() runs (~0.1ms)
  → snapshot.framework = { name: "react", version: "18.2.0", fiberKey: "__reactFiber$abc" }
  → background receives snapshot

Agent loop start
  → refreshSnapshot() → context.setSnapshot(snap)
  → if snap.framework?.name === "react":
      remove INSPECT_REACT, REACT_SET_INPUT, INSPECT_REACT_TREE, WAIT_FOR_REACT from disabledTools
  → toolRegistry.getDefinitions(disabledTools) now includes React tools
  → LLM sees React tools in its tool list
```

### System prompt awareness

Add one line to Tool Tips (after the Investigation line added in the discovery-tools RFC):

```
- React: When React is detected, inspect_react reads component state/props, react_set_input handles controlled inputs, inspect_react_tree shows the component hierarchy.
```

This line only adds ~30 tokens and teaches the agent *when* to reach for React tools. It's present even on non-React pages (static in the prompt template for prefix caching) but the tools themselves won't be in the tool list, so the agent can't call them — the line just primes it to recognize React patterns.

## Token Budget Impact

| Scenario | Extra prompt tokens |
|----------|-------------------|
| Non-React page | 0 (tools gated) + ~30 (Tool Tips line) |
| React page | ~200 (4 tool schemas) + ~30 (Tool Tips line) |

230 tokens on a 32K budget = 0.7%. Negligible.

## Challenge Impact Estimate

| Tool | Turns saved per task | Mechanism |
|------|---------------------|-----------|
| `inspect_react` | 3-5 | Read hidden codes from state instead of probing with execute_js |
| `react_set_input` | 2-4 | Eliminate silent controlled input failures + retry loops |
| `inspect_react_tree` | 1-2 | One-call page understanding vs exploratory read_page/find_element |
| `wait_for_react` | 1-2 | Semantic wait replaces blind retries after state transitions |

Conservative: **7-13 turns per task × 30 tasks = 210-390 turns saved.** Against the 246-turn baseline (5/30 tasks), this could push completion to 25-30/30 within the 5-minute timer.

## Risks & Mitigations

### React not using standard root IDs

**Risk:** Some apps use custom root IDs (not `root` or `__next`), so `detectFramework()` misses them.
**Mitigation:** Fall back to `document.querySelector("[data-reactroot]")` and scan first 5 `document.body.children` for fiber keys. Cover 99% of React apps.

### Minified component names in production builds

**Risk:** Production React bundles minify component names (`CodeRevealer` → `e`, `t`, `n`). `inspect_react_tree` output becomes useless.
**Mitigation:** Use `displayName` first (set by dev tooling, some libs keep it in prod). When names are single-letter, include a props hint instead: `e (delay=3000) state=["X7K2M9"]`. The state/props are the real value — component names are a bonus.

### Fiber tree structure varies across React versions

**Risk:** React 16, 17, 18, and 19 have slightly different fiber internals. `memoizedState` hook chain shape changed between 16 and 17.
**Mitigation:** The detection function captures the React version via `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Tools can branch on major version if needed. React 18+ is ~85% of production traffic; React 16-17 patterns are well-documented.

### `chrome.scripting.executeScript` MAIN world permissions

**Risk:** MAIN world scripts run in the page context and could theoretically be detected by the page.
**Mitigation:** Already an accepted pattern — `inspect_hidden` and `execute_js` both use MAIN world execution. The extension manifest already declares `scripting` permission. The React tools are read-only (except `react_set_input`, which is equivalent to user typing).

### Large fiber trees cause slow/oversized output

**Risk:** A complex React app might have 500+ components. `inspect_react_tree` at depth 10 could return multi-KB output.
**Mitigation:** Hard cap at 60 lines in `walkFiber`. The `depth` param defaults to 5. The `filter` param lets the agent narrow to specific component subtrees. Output is already token-efficient due to the compact tree format.

### State contains sensitive data

**Risk:** `inspect_react` might expose auth tokens, user data, or API keys stored in React state.
**Mitigation:** The agent already has `execute_js` which can read anything on the page. React tools don't expand the attack surface — they just make existing access more structured. The `sanitizeProps` function strips functions and truncates long strings.

## Testing

### Unit tests (`tests/background/react-tools.test.ts` — new)

1. **`detectFramework` finds React:** Mock DOM with `__reactFiber$` key on root element. Assert returns `{ name: "react", ... }`.
2. **`detectFramework` returns null on non-React:** Clean DOM. Assert returns null.
3. **Tool gating:** Create loop with `disabledTools` containing React tools. Set snapshot with `framework: { name: "react" }`. Assert React tools removed from `disabledTools`.
4. **Tool gating negative:** Set snapshot without `framework`. Assert React tools remain in `disabledTools`.

### Unit tests (`tests/content/framework-detect.test.ts` — new)

5. **React 18 detection:** Create root element with `__reactFiber$` key. Assert detected.
6. **React 16 detection:** Create root element with `__reactInternalInstance$` key. Assert detected.
7. **Next.js detection:** Create `__next` element with fiber key. Assert detected.
8. **No framework:** Clean DOM. Assert null returned.

### Integration verification

1. `npx bun run build` — clean build
2. `npx bun test` — no regressions
3. `npx bun run lint` — no new errors
4. Manual: load extension on a React site (e.g. the challenge), verify `inspect_react_tree` returns component tree, verify `react_set_input` updates controlled inputs, verify tools are absent on non-React pages.

## Future Extensions

This architecture supports additional framework toolkits without structural changes:

- **Vue toolkit:** `detectFramework` checks for `__vue__` / `__vue_app__`. Tools read `$data`, `$props`, component tree via `__vue_app__._instance`.
- **Angular toolkit:** Check for `ng.probe` / `getAllAngularRootElements()`. Read component metadata via `ng.getComponent()`.
- **Svelte toolkit:** Check for `__svelte_meta`. Read component state via `$capture_state()`.

Each would follow the same pattern: detect in content script → gate via `disabledTools` → execute via MAIN world scripts. The `FrameworkInfo.name` field already supports this.
