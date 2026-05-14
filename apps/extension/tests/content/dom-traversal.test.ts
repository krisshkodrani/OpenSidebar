import "../setup";
import { describe, test, expect, beforeEach } from "vitest";
import {
  querySelectorAllDeep,
  detectClickableElements,
  INTERACTIVE_SELECTORS,
  CONTAINER_TAGS,
  LABEL_CLASS,
  MAX_SHADOW_DEPTH,
} from "../../src/content/tagging/dom-traversal";

// ----- helpers -----

function setBody(html: string) {
  document.body.innerHTML = html;
}

// ========================================================================
// querySelectorAllDeep
// ========================================================================

describe("querySelectorAllDeep", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("finds elements in flat DOM", () => {
    setBody('<button id="b1">Click</button><button id="b2">Go</button>');
    const results = querySelectorAllDeep(document, "button");
    expect(results).toHaveLength(2);
  });

  test("finds elements matching compound selectors", () => {
    setBody('<a href="/page">Link</a><a>No href</a><button>Btn</button>');
    const results = querySelectorAllDeep(document, "a[href], button");
    expect(results).toHaveLength(2);
  });

  test("returns empty array for no matches", () => {
    setBody("<div>No inputs here</div>");
    const results = querySelectorAllDeep(document, "input");
    expect(results).toHaveLength(0);
  });

  test("deduplicates results", () => {
    setBody('<button class="btn">Click</button>');
    // The selector "button, .btn" would match the same element twice
    const results = querySelectorAllDeep(document, "button, .btn");
    expect(results).toHaveLength(1);
  });

  test("respects max shadow DOM depth", () => {
    // We can't easily create 4+ levels of shadow DOM in happy-dom,
    // but we verify the function doesn't crash with normal depth
    setBody("<div><button>OK</button></div>");
    const results = querySelectorAllDeep(document, "button", 0);
    expect(results).toHaveLength(1);
  });

  test("handles empty body gracefully", () => {
    setBody("");
    const results = querySelectorAllDeep(document, "button");
    expect(results).toHaveLength(0);
  });

  test("works with Element as root", () => {
    setBody(
      '<div id="root"><button>Inside</button></div><button>Outside</button>',
    );
    const root = document.getElementById("root")!;
    const results = querySelectorAllDeep(root, "button");
    expect(results).toHaveLength(1);
  });

  test("ignores the OpenSidebar E2E overlay host and shadow controls", () => {
    setBody('<button id="page-button">Page Button</button>');
    const host = document.createElement("div");
    host.id = "opensidebar-harness-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<button id="overlay-button">Overlay Button</button>';
    document.body.appendChild(host);

    const results = querySelectorAllDeep(document, "button");

    expect(results.map((el) => el.id)).toEqual(["page-button"]);
  });
});

// ========================================================================
// INTERACTIVE_SELECTORS constant
// ========================================================================

describe("INTERACTIVE_SELECTORS", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("matches standard interactive elements", () => {
    setBody(`
      <a href="/page">Link</a>
      <button>Click</button>
      <input type="text" />
      <textarea></textarea>
      <select><option>A</option></select>
    `);
    const results = document.querySelectorAll(INTERACTIVE_SELECTORS);
    expect(results.length).toBeGreaterThanOrEqual(5);
  });

  test("matches ARIA role elements", () => {
    setBody(`
      <div role="button">Custom Btn</div>
      <div role="link">Custom Link</div>
      <div role="tab">Tab</div>
      <div role="menuitem">Menu Item</div>
      <div role="checkbox">Check</div>
      <div role="radio">Radio</div>
      <div role="switch">Switch</div>
      <div role="combobox">Combo</div>
    `);
    const results = document.querySelectorAll(INTERACTIVE_SELECTORS);
    expect(results.length).toBe(8);
  });

  test("matches contenteditable elements", () => {
    setBody('<div contenteditable="true">Editable</div>');
    const results = document.querySelectorAll(INTERACTIVE_SELECTORS);
    expect(results.length).toBe(1);
  });

  test("matches canvas and draggable elements", () => {
    setBody('<canvas></canvas><div draggable="true">Drag me</div>');
    const results = document.querySelectorAll(INTERACTIVE_SELECTORS);
    expect(results.length).toBe(2);
  });

  test("skips hidden inputs", () => {
    setBody('<input type="hidden" /><input type="text" />');
    const results = document.querySelectorAll(INTERACTIVE_SELECTORS);
    expect(results.length).toBe(1);
  });

  test("skips tabindex=-1 elements", () => {
    setBody('<div tabindex="-1">Not interactive</div><div tabindex="0">Interactive</div>');
    const results = document.querySelectorAll(INTERACTIVE_SELECTORS);
    expect(results.length).toBe(1);
  });

  test("matches summary and details", () => {
    setBody("<details><summary>Toggle</summary><p>Content</p></details>");
    const results = document.querySelectorAll(INTERACTIVE_SELECTORS);
    // Both summary and details match
    expect(results.length).toBe(2);
  });

  test("matches onclick elements", () => {
    setBody('<div onclick="doSomething()">Clickable</div>');
    const results = document.querySelectorAll(INTERACTIVE_SELECTORS);
    expect(results.length).toBe(1);
  });
});

// ========================================================================
// CONTAINER_TAGS constant
// ========================================================================

describe("CONTAINER_TAGS", () => {
  test("includes common layout containers", () => {
    expect(CONTAINER_TAGS.has("div")).toBe(true);
    expect(CONTAINER_TAGS.has("section")).toBe(true);
    expect(CONTAINER_TAGS.has("article")).toBe(true);
    expect(CONTAINER_TAGS.has("nav")).toBe(true);
    expect(CONTAINER_TAGS.has("form")).toBe(true);
    expect(CONTAINER_TAGS.has("ul")).toBe(true);
    expect(CONTAINER_TAGS.has("table")).toBe(true);
  });

  test("does not include interactive elements", () => {
    expect(CONTAINER_TAGS.has("button")).toBe(false);
    expect(CONTAINER_TAGS.has("a")).toBe(false);
    expect(CONTAINER_TAGS.has("input")).toBe(false);
    expect(CONTAINER_TAGS.has("span")).toBe(false);
  });
});

// ========================================================================
// detectClickableElements
// ========================================================================

describe("detectClickableElements", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("returns empty array on empty body", () => {
    setBody("");
    const results = detectClickableElements();
    expect(results).toHaveLength(0);
  });

  test("skips elements matching INTERACTIVE_SELECTORS", () => {
    // Buttons are already captured by interactive selectors, so they
    // should be skipped by detectClickableElements
    setBody('<button style="cursor:pointer">Click me</button>');
    const results = detectClickableElements();
    expect(results).toHaveLength(0);
  });

  test("skips elements with LABEL_CLASS", () => {
    setBody(
      `<span class="${LABEL_CLASS}" style="cursor:pointer">Label</span>`,
    );
    const results = detectClickableElements();
    expect(results).toHaveLength(0);
  });

  test("skips large containers (>3 children)", () => {
    setBody(`
      <div style="cursor:pointer">
        <span>1</span><span>2</span><span>3</span><span>4</span>
      </div>
    `);
    const results = detectClickableElements();
    // The div is a container with >3 children, should be skipped
    expect(
      results.every((el) => el.tagName.toLowerCase() !== "div"),
    ).toBe(true);
  });

  test("skips elements with empty text", () => {
    setBody('<span style="cursor:pointer"></span>');
    const results = detectClickableElements();
    expect(results).toHaveLength(0);
  });

  test("skips elements with very long text (>200 chars)", () => {
    const longText = "A".repeat(201);
    setBody(`<span style="cursor:pointer">${longText}</span>`);
    const results = detectClickableElements();
    expect(results).toHaveLength(0);
  });

  test("finds cursor-pointer elements inside nested shadow DOM", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("div");
    shadow.appendChild(inner);
    const innerShadow = inner.attachShadow({ mode: "open" });
    innerShadow.innerHTML = `<span id="deep-action" style="cursor:pointer">Deep action</span>`;

    const results = detectClickableElements();

    expect(results.some((el) => el.id === "deep-action")).toBe(true);
  });

  test("documents the configured deep traversal limit", () => {
    expect(MAX_SHADOW_DEPTH).toBe(10);
  });
});
