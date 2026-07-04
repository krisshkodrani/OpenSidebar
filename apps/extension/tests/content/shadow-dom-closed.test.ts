import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { tagElements, resetStableIds } from "../../src/content/tagging";
import "../../tests/setup";

/**
 * RFC LP-12 Phase A: closed shadow roots are opened via the extension-only
 * chrome.dom.openOrClosedShadowRoot API. The test registers the API the way
 * Chrome exposes it to content scripts and verifies traversal reaches
 * elements inside a mode:"closed" root.
 */
describe("closed shadow root traversal (LP-12 Phase A)", () => {
  const closedRoots = new WeakMap<Element, ShadowRoot>();
  let chromeDom: { openOrClosedShadowRoot?: (el: Element) => ShadowRoot | null };

  beforeEach(() => {
    document.body.innerHTML = "";
    resetStableIds();
    chromeDom = {
      openOrClosedShadowRoot: (el: Element) => closedRoots.get(el) ?? null,
    };
    (globalThis.chrome as unknown as Record<string, unknown>).dom = chromeDom;
  });

  afterEach(() => {
    delete (globalThis.chrome as unknown as Record<string, unknown>).dom;
  });

  function makeClosedWidget(buttonLabel: string): HTMLElement {
    const host = document.createElement("closed-widget");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "closed" });
    closedRoots.set(host, root);
    const btn = document.createElement("button");
    btn.textContent = buttonLabel;
    root.appendChild(btn);
    return host;
  }

  test("tags interactive elements inside a closed shadow root", () => {
    makeClosedWidget("Hidden Submit");
    const tagged = tagElements();
    expect(tagged.some((el) => el.text === "Hidden Submit")).toBe(true);
  });

  test("skips closed-root lookup for non-custom elements", () => {
    let calls = 0;
    chromeDom.openOrClosedShadowRoot = () => {
      calls++;
      return null;
    };
    const div = document.createElement("div");
    const btn = document.createElement("button");
    btn.textContent = "Plain";
    div.appendChild(btn);
    document.body.appendChild(div);

    tagElements();
    expect(calls).toBe(0);
  });

  test("degrades silently when chrome.dom is unavailable", () => {
    delete (globalThis.chrome as unknown as Record<string, unknown>).dom;
    makeClosedWidget("Unreachable");
    const tagged = tagElements();
    // Closed root is invisible without the API — but tagging must not throw.
    expect(tagged.some((el) => el.text === "Unreachable")).toBe(false);
  });
});
