/**
 * Framework Detection Tests
 *
 * Verifies that detectFramework() correctly identifies React on the page
 * and returns null when no supported framework is present.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import "../setup";
import { detectFramework } from "../../src/content/framework-detect";

describe("detectFramework", () => {
  beforeEach(() => {
    // Clean up any test elements from previous runs
    document.body.innerHTML = "";
  });

  test("returns null when no framework is present", () => {
    const result = detectFramework();
    expect(result).toBeNull();
  });

  test("detects React 18+ via __reactFiber$ key on #root", () => {
    const root = document.createElement("div");
    root.id = "root";
    // Simulate React attaching a fiber key
    (root as any)["__reactFiber$abc123"] = { tag: 3 };
    document.body.appendChild(root);

    const result = detectFramework();
    expect(result).not.toBeNull();
    expect(result!.name).toBe("react");
    expect(result!.fiberKey).toBe("__reactFiber$abc123");
  });

  test("detects React via __reactInternalInstance$ key (React 16)", () => {
    const root = document.createElement("div");
    root.id = "root";
    (root as any)["__reactInternalInstance$xyz789"] = { tag: 3 };
    document.body.appendChild(root);

    const result = detectFramework();
    expect(result).not.toBeNull();
    expect(result!.name).toBe("react");
    expect(result!.fiberKey).toBe("__reactInternalInstance$xyz789");
  });

  test("detects React on Next.js apps via #__next", () => {
    const root = document.createElement("div");
    root.id = "__next";
    (root as any)["__reactFiber$next456"] = { tag: 3 };
    document.body.appendChild(root);

    const result = detectFramework();
    expect(result).not.toBeNull();
    expect(result!.name).toBe("react");
  });

  test("detects React via [data-reactroot] attribute", () => {
    const root = document.createElement("div");
    root.setAttribute("data-reactroot", "");
    (root as any)["__reactFiber$dataroot"] = { tag: 3 };
    document.body.appendChild(root);

    const result = detectFramework();
    expect(result).not.toBeNull();
    expect(result!.name).toBe("react");
  });

  test("detects React on body children fallback", () => {
    const child = document.createElement("div");
    (child as any)["__reactFiber$fallback"] = { tag: 3 };
    document.body.appendChild(child);

    const result = detectFramework();
    expect(result).not.toBeNull();
    expect(result!.name).toBe("react");
    expect(result!.fiberKey).toBe("__reactFiber$fallback");
  });

  test("returns version 'unknown' when DevTools hook is absent", () => {
    const root = document.createElement("div");
    root.id = "root";
    (root as any)["__reactFiber$ver"] = { tag: 3 };
    document.body.appendChild(root);

    const result = detectFramework();
    expect(result).not.toBeNull();
    expect(result!.version).toBe("unknown");
  });

  test("reads version from __REACT_DEVTOOLS_GLOBAL_HOOK__", () => {
    const root = document.createElement("div");
    root.id = "root";
    (root as any)["__reactFiber$hook"] = { tag: 3 };
    document.body.appendChild(root);

    // Mock DevTools hook
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map([[1, { version: "18.2.0" }]]),
    };

    try {
      const result = detectFramework();
      expect(result).not.toBeNull();
      expect(result!.version).toBe("18.2.0");
    } finally {
      delete (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    }
  });

  test("ignores elements without fiber keys", () => {
    const root = document.createElement("div");
    root.id = "root";
    // No fiber key set — just a regular element
    document.body.appendChild(root);

    const result = detectFramework();
    expect(result).toBeNull();
  });
});
