import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import { __reactToolkitTestHooks } from "../../src/background/tools/react";

describe("React Toolkit Internals", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  });

  test("getRootFibers reads roots from DevTools hook function", () => {
    const fiberRoot = { current: { type: { name: "App" } } };
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map([[1, { version: "18.2.0" }]]),
      getFiberRoots: (rendererId: number) =>
        rendererId === 1 ? new Set([fiberRoot]) : new Set(),
    };

    const roots = __reactToolkitTestHooks.getRootFibers();
    expect(roots.length).toBe(1);
    expect(roots[0]).toBe(fiberRoot.current);
  });

  test("snapshotFiberFingerprint returns null when no roots exist", () => {
    const fp = __reactToolkitTestHooks.snapshotFiberFingerprint();
    expect(fp).toBeNull();
  });

  test("findNearestFiber resolves from ancestor when target node has no fiber key", () => {
    const container = document.createElement("div");
    (container as any).__reactFiber$abc = { type: { name: "Parent" } };
    const child = document.createElement("span");
    container.appendChild(child);
    document.body.appendChild(container);

    const fiber = __reactToolkitTestHooks.findNearestFiber(child);
    expect(fiber).toBeDefined();
    expect((fiber as any).type?.name).toBe("Parent");
  });
});
