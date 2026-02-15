/**
 * Framework detection for on-demand toolkit injection.
 *
 * Probes the DOM for framework-specific internals (React fiber keys,
 * DevTools hooks, etc.) and returns a {@link FrameworkInfo} descriptor
 * when a supported framework is found.
 *
 * Cost: ~0.1 ms — one getElementById + one Object.keys scan.
 * Called once per snapshot, not per element.
 */

import type { FrameworkInfo } from "../types";

/** Common root element IDs used by React apps and meta-frameworks. */
const REACT_ROOT_IDS = ["root", "__next", "app", "__nuxt"] as const;

/**
 * Detect the front-end framework powering the current page.
 *
 * Currently supports React 16+ (fiber architecture).
 * Returns `null` if no supported framework is detected.
 */
export function detectFramework(): FrameworkInfo | null {
  return detectReact();
}

/**
 * Probe for React 16+ by locating a fiber key on a root element
 * or by checking the React DevTools global hook.
 */
function detectReact(): FrameworkInfo | null {
  // 1. Try known root IDs
  for (const id of REACT_ROOT_IDS) {
    const el = document.getElementById(id);
    if (el) {
      const fiberKey = findFiberKey(el);
      if (fiberKey) {
        return { name: "react", version: getReactVersion(), fiberKey };
      }
    }
  }

  // 2. Try [data-reactroot] attribute (older CRA apps)
  const reactRootEl = document.querySelector("[data-reactroot]");
  if (reactRootEl) {
    const fiberKey = findFiberKey(reactRootEl);
    if (fiberKey) {
      return { name: "react", version: getReactVersion(), fiberKey };
    }
  }

  // 3. Last resort: scan first few body children
  const bodyChildren = document.body?.children;
  if (bodyChildren) {
    const limit = Math.min(bodyChildren.length, 5);
    for (let i = 0; i < limit; i++) {
      const fiberKey = findFiberKey(bodyChildren[i]);
      if (fiberKey) {
        return { name: "react", version: getReactVersion(), fiberKey };
      }
    }
  }

  return null;
}

/**
 * Search an element's own properties for a React fiber key.
 * React 16+ attaches `__reactFiber$<hash>` or `__reactInternalInstance$<hash>`.
 */
function findFiberKey(el: Element): string | null {
  try {
    const keys = Object.keys(el);
    for (const k of keys) {
      if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) {
        return k;
      }
    }
  } catch {
    // Sandboxed iframes or cross-origin elements — safe to ignore
  }
  return null;
}

/**
 * Attempt to read the React version from the DevTools global hook.
 * Falls back to "unknown" if unavailable.
 */
function getReactVersion(): string {
  try {
    const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (hook?.renderers) {
      for (const renderer of hook.renderers.values()) {
        if (renderer?.version) return renderer.version;
      }
    }
  } catch {
    // DevTools hook not available — not an error
  }
  return "unknown";
}
