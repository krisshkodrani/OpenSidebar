/**
 * React Toolkit — On-demand tools for React-powered pages.
 *
 * All four tools execute via `chrome.scripting.executeScript` in the MAIN world
 * so they can access React's fiber tree and internal hooks on `window`.
 * Elements are located via `data-os-tag` attributes set during tagging.
 *
 * These tools are registered at startup but gated behind `disabledTools`
 * until the content script detects React on the page (see `FrameworkInfo`).
 */

import { ToolName, ToolDefinition } from "../../types";
import { ToolRegistry } from "./registry";
import { logger } from "../../utils";

// ---------------------------------------------------------------------------
// Tool Names (must match ToolName enum values)
// ---------------------------------------------------------------------------

/** Tools gated behind React detection — removed from disabledTools when React is found. */
export const REACT_TOOL_NAMES: ReadonlySet<ToolName> = new Set([
  ToolName.INSPECT_REACT,
  ToolName.REACT_SET_INPUT,
  ToolName.INSPECT_REACT_TREE,
  ToolName.WAIT_FOR_REACT,
]);

// ---------------------------------------------------------------------------
// Tool Definitions (OpenAI function-calling schema)
// ---------------------------------------------------------------------------

const INSPECT_REACT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.INSPECT_REACT,
    description:
      "Read React component name, props, and state for a tagged element. " +
      "Use when data isn't visible in the DOM — hidden values, form state, loading flags, " +
      "or values stored in useState/useReducer.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID of the element to inspect.",
        },
        depth: {
          type: "integer",
          description:
            "How many parent components to traverse (default 3, max 8).",
        },
      },
      required: ["id"],
    },
  },
};

const REACT_SET_INPUT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.REACT_SET_INPUT,
    description:
      "Set a React controlled input value. Use when type_text doesn't update the field " +
      "(React controlled components ignore direct DOM writes). " +
      "Falls back to standard input events if React isn't managing this element.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "Tag ID of the input element.",
        },
        value: {
          type: "string",
          description: "The value to set.",
        },
        submit: {
          type: "boolean",
          description: "Press Enter after setting value (default false).",
        },
      },
      required: ["id", "value"],
    },
  },
};

const INSPECT_REACT_TREE_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.INSPECT_REACT_TREE,
    description:
      "Show the React component tree structure with state summaries. " +
      "Use to understand page organization when the DOM structure is unclear.",
    parameters: {
      type: "object",
      properties: {
        depth: {
          type: "integer",
          description: "Max tree depth to traverse (default 5, max 10).",
        },
        filter: {
          type: "string",
          description:
            "Only show components whose name contains this string (case-insensitive).",
        },
      },
    },
  },
};

const WAIT_FOR_REACT_DEF: ToolDefinition = {
  type: "function",
  function: {
    name: ToolName.WAIT_FOR_REACT,
    description:
      "Wait for React to finish rendering (pending state updates, Suspense, transitions). " +
      "Use after an action that triggers async state changes instead of a blind wait.",
    parameters: {
      type: "object",
      properties: {
        timeout: {
          type: "integer",
          description: "Max wait time in ms (default 3000, max 10000).",
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// MAIN-world shared helpers
// ---------------------------------------------------------------------------

/**
 * Find the React fiber key on a DOM element (`__reactFiber$…` or `__reactInternalInstance$…`).
 * Returns `null` if the element is not managed by React.
 */
function findFiberKey(el: Element): string | null {
  return (
    Object.keys(el).find(
      (k) =>
        k.startsWith("__reactFiber$") ||
        k.startsWith("__reactInternalInstance$"),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// MAIN-world executor functions
// ---------------------------------------------------------------------------

/**
 * MAIN-world function: inspect React component state/props for a tagged element.
 * Walks up the fiber tree from the element, collecting named components.
 */
function inspectReactMainWorld(id: number, maxDepth: number): string {
  const el = document.querySelector(`[data-os-tag="${id}"]`);
  if (!el) return `Error: No element with tag [${id}]`;

  const fiberKey = findFiberKey(el);
  if (!fiberKey) return "No React fiber found on this element.";

  let fiber = (el as any)[fiberKey];
  if (!fiber) return "React fiber key exists but fiber is null.";

  const components: { component: string; props: any; state: any[] }[] = [];
  let walked = 0;

  while (fiber && walked < maxDepth) {
    const name =
      fiber.elementType?.displayName ??
      fiber.elementType?.name ??
      fiber.type?.displayName ??
      fiber.type?.name;

    // Only collect user-defined components (capitalized names)
    if (name && typeof name === "string" && name[0] === name[0].toUpperCase()) {
      const state = extractHooksState(fiber.memoizedState);
      const props = sanitizeProps(fiber.memoizedProps);
      components.push({ component: name, props, state });
      walked++;
    }
    fiber = fiber.return;
  }

  if (components.length === 0) {
    return "No React components with state found above this element.";
  }
  return JSON.stringify(components, null, 2);
}

/**
 * Extract serializable values from React's hooks linked list.
 * Skips functions, effects, and refs to functions.
 */
function extractHooksState(memoizedState: any): any[] {
  const values: any[] = [];
  let hook = memoizedState;
  let safety = 0;
  while (hook && safety < 20) {
    safety++;
    const val = hook.memoizedState;
    if (val !== undefined && val !== null && typeof val !== "function") {
      // useRef — include if primitive
      if (
        typeof val === "object" &&
        val !== null &&
        "current" in val &&
        Object.keys(val).length === 1
      ) {
        if (typeof val.current !== "function") {
          values.push({ ref: val.current });
        }
      } else {
        // Attempt safe serialization
        try {
          JSON.stringify(val);
          values.push(val);
        } catch {
          values.push("[complex object]");
        }
      }
    }
    hook = hook.next;
  }
  return values;
}

/**
 * Strip functions and children from props, truncate long strings.
 */
function sanitizeProps(props: any): Record<string, any> {
  if (!props || typeof props !== "object") return {};
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === "children") continue;
    if (typeof v === "function") {
      clean[k] = "[function]";
      continue;
    }
    if (typeof v === "string") {
      clean[k] = v.length > 100 ? v.slice(0, 100) + "..." : v;
      continue;
    }
    if (typeof v === "object" && v !== null) {
      try {
        const serialized = JSON.stringify(v);
        clean[k] = serialized.length > 200 ? "[object]" : JSON.parse(serialized);
      } catch {
        clean[k] = "[object]";
      }
      continue;
    }
    clean[k] = v;
  }
  return clean;
}

/**
 * MAIN-world function: set a React controlled input value using the
 * native value setter trick + synthetic event dispatch.
 */
function reactSetInputMainWorld(
  id: number,
  value: string,
  submit: boolean,
): string {
  const el = document.querySelector(`[data-os-tag="${id}"]`);
  if (!el) return `Error: No element with tag [${id}]`;

  if (
    !(
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
    )
  ) {
    return `Error: Element [${id}] is <${el.tagName.toLowerCase()}>, not an input.`;
  }

  // Focus the element first
  el.focus();

  // Use the native value setter to bypass React's controlled component guard.
  // React installs its own property descriptor on input.value — the native
  // HTMLInputElement.prototype.value setter triggers the internal change tracking.
  const descriptor =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ??
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value; // Fallback for non-React
  }

  // Dispatch the events React listens for
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));

  // Optional: submit by pressing Enter
  if (submit) {
    const keyOpts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
    el.dispatchEvent(new KeyboardEvent("keypress", keyOpts));
    el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));
  }

  const preview = value.length > 50 ? value.slice(0, 50) + "..." : value;
  return `Set [${id}] value to "${preview}"${submit ? " and pressed Enter" : ""}`;
}

/**
 * MAIN-world function: walk the React fiber tree and return a compact
 * component hierarchy with state summaries.
 */
function inspectReactTreeMainWorld(
  maxDepth: number,
  filter: string | null,
): string {
  // 1. Locate the React root fiber
  let rootFiber: any = null;

  // Try DevTools hook first
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook?.getFiberRoots) {
    try {
      for (const [, roots] of hook.getFiberRoots) {
        for (const root of roots) {
          rootFiber = root.current;
          break;
        }
        if (rootFiber) break;
      }
    } catch {
      // getFiberRoots may not be iterable on all React versions
    }
  }

  // Fallback: find fiber from a known root element
  if (!rootFiber) {
    const rootIds = ["root", "__next", "app", "__nuxt"];
    for (const id of rootIds) {
      const el = document.getElementById(id);
      if (el) {
        const key = findFiberKey(el);
        if (key) {
          rootFiber = (el as any)[key];
          break;
        }
      }
    }
  }

  if (!rootFiber) return "No React root found.";

  const lines: string[] = [];
  walkFiber(rootFiber, 0, maxDepth, filter, lines);

  if (lines.length === 0 && filter) {
    return `No components matching "${filter}" found.`;
  }
  if (lines.length === 0) {
    return "React root found but no named components in tree.";
  }

  return lines.join("\n");
}

/** Hard cap on output lines to prevent runaway output. */
const MAX_TREE_LINES = 60;

/**
 * Recursively walk the fiber tree, collecting named components.
 */
function walkFiber(
  fiber: any,
  depth: number,
  maxDepth: number,
  filter: string | null,
  lines: string[],
): void {
  if (!fiber || depth > maxDepth || lines.length >= MAX_TREE_LINES) return;

  const name =
    fiber.elementType?.displayName ??
    fiber.elementType?.name ??
    fiber.type?.displayName ??
    fiber.type?.name;

  const isNamedComponent =
    name && typeof name === "string" && name[0] === name[0].toUpperCase();

  if (isNamedComponent) {
    const matchesFilter =
      !filter || name.toLowerCase().includes(filter.toLowerCase());
    if (matchesFilter) {
      const indent = "  ".repeat(depth);
      const stateHint = fiber.memoizedState
        ? summarizeState(fiber.memoizedState)
        : "";
      const propsHint = summarizePropsCompact(fiber.memoizedProps);
      lines.push(`${indent}${name}${propsHint}${stateHint}`);
    }
  }

  // Recurse: child first, then sibling
  walkFiber(
    fiber.child,
    isNamedComponent ? depth + 1 : depth,
    maxDepth,
    filter,
    lines,
  );
  walkFiber(fiber.sibling, depth, maxDepth, filter, lines);
}

/**
 * Summarize React hooks state into a compact hint string.
 */
function summarizeState(memoizedState: any): string {
  const vals: string[] = [];
  let hook = memoizedState;
  let safety = 0;
  while (hook && vals.length < 4 && safety < 20) {
    safety++;
    const v = hook.memoizedState;
    if (v !== undefined && v !== null && typeof v !== "function") {
      if (typeof v === "string") vals.push(`"${v.slice(0, 20)}"`);
      else if (typeof v === "number" || typeof v === "boolean")
        vals.push(String(v));
      else if (Array.isArray(v)) vals.push(`[${v.length}]`);
    }
    hook = hook.next;
  }
  return vals.length > 0 ? ` state=[${vals.join(", ")}]` : "";
}

/**
 * Summarize React props into a compact hint string (max 3 keys).
 */
function summarizePropsCompact(props: any): string {
  if (!props || typeof props !== "object") return "";
  const hints: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (hints.length >= 3) break;
    if (k === "children" || typeof v === "function") continue;
    if (typeof v === "string")
      hints.push(`${k}="${v.length > 15 ? v.slice(0, 15) + "..." : v}"`);
    else if (typeof v === "number" || typeof v === "boolean")
      hints.push(`${k}=${v}`);
  }
  return hints.length > 0 ? ` (${hints.join(", ")})` : "";
}

/**
 * MAIN-world function: poll until the React fiber tree stabilizes.
 * Returns when the tree fingerprint is unchanged for 3 consecutive polls
 * or when the timeout expires.
 */
async function waitForReactMainWorld(timeout: number): Promise<string> {
  const start = Date.now();
  let lastFingerprint = "";
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const fp = snapshotFiberFingerprint();

    if (fp === lastFingerprint) {
      stableCount++;
      if (stableCount >= 3) {
        return `React idle after ${Date.now() - start}ms`;
      }
    } else {
      stableCount = 0;
      lastFingerprint = fp;
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  return `React may still be updating (timed out after ${timeout}ms)`;
}

/**
 * Quick fingerprint of the React fiber tree: count named components + hash their state.
 * Used by `waitForReactMainWorld` to detect when rendering settles.
 */
function snapshotFiberFingerprint(): string {
  const rootIds = ["root", "__next", "app", "__nuxt"];
  let rootFiber: any = null;

  for (const id of rootIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    const key = findFiberKey(el);
    if (key) {
      rootFiber = (el as any)[key];
      break;
    }
  }

  if (!rootFiber) return "";

  const parts: string[] = [];
  const stack = [rootFiber];
  let visited = 0;

  while (stack.length > 0 && visited < 200) {
    const f = stack.pop();
    if (!f) continue;
    visited++;

    const name = f.elementType?.name ?? f.type?.name;
    if (name && typeof name === "string") {
      const stateKey = f.memoizedState
        ? String(f.memoizedState.memoizedState).slice(0, 20)
        : "";
      parts.push(`${name}:${stateKey}`);
    }
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }

  return parts.join("|");
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all four React toolkit tools with the given registry.
 * Tools are gated behind `disabledTools` in the agent loop —
 * they only become available when React is detected on the page.
 */
export function registerReactTools(registry: ToolRegistry): void {
  // -- inspect_react --
  registry.register(
    ToolName.INSPECT_REACT,
    INSPECT_REACT_DEF,
    async (args, tabId) => {
      const id = args.id as number;
      const depth = Math.min(Math.max((args.depth as number) || 3, 1), 8);

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: inspectReactMainWorld,
          args: [id, depth],
        });
        return results[0]?.result ?? "No result from script execution.";
      } catch (e: any) {
        logger.error("tools", "inspect_react failed", { error: e.message });
        return `Error: ${e.message}`;
      }
    },
  );

  // -- react_set_input --
  registry.register(
    ToolName.REACT_SET_INPUT,
    REACT_SET_INPUT_DEF,
    async (args, tabId) => {
      const id = args.id as number;
      const value = args.value as string;
      const submit = (args.submit as boolean) ?? false;

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: reactSetInputMainWorld,
          args: [id, value, submit],
        });
        return results[0]?.result ?? "No result from script execution.";
      } catch (e: any) {
        logger.error("tools", "react_set_input failed", { error: e.message });
        return `Error: ${e.message}`;
      }
    },
  );

  // -- inspect_react_tree --
  registry.register(
    ToolName.INSPECT_REACT_TREE,
    INSPECT_REACT_TREE_DEF,
    async (args, tabId) => {
      const depth = Math.min(Math.max((args.depth as number) || 5, 1), 10);
      const filter = (args.filter as string) || null;

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: inspectReactTreeMainWorld,
          args: [depth, filter],
        });
        return results[0]?.result ?? "No result from script execution.";
      } catch (e: any) {
        logger.error("tools", "inspect_react_tree failed", {
          error: e.message,
        });
        return `Error: ${e.message}`;
      }
    },
  );

  // -- wait_for_react --
  registry.register(
    ToolName.WAIT_FOR_REACT,
    WAIT_FOR_REACT_DEF,
    async (args, tabId) => {
      const timeout = Math.min(
        Math.max((args.timeout as number) || 3000, 100),
        10000,
      );

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: waitForReactMainWorld,
          args: [timeout],
        });
        return results[0]?.result ?? "No result from script execution.";
      } catch (e: any) {
        logger.error("tools", "wait_for_react failed", { error: e.message });
        return `Error: ${e.message}`;
      }
    },
  );

  logger.info("tools", "React toolkit registered (gated until detection)");
}
