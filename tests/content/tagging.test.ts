import { describe, test, expect, beforeEach } from "bun:test";
import {
  tagElements,
  isElementVisible,
  isRandomHash,
  truncateText,
} from "../../src/content/tagging";
import "../../tests/setup";

describe("tagElements", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("tags visible buttons", () => {
    const btn = document.createElement("button");
    btn.textContent = "Click Me";
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].tagName).toBe("button");
    expect(tagged[0].tag).toBe(1);
    expect(tagged[0].text).toBe("Click Me");
  });

  test("skips hidden elements", () => {
    const btn = document.createElement("button");
    btn.style.display = "none";
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(0);
  });

  test("tags inputs with correct role", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Hello";
    document.body.appendChild(input);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].role).toBe("text");
    expect(tagged[0].text).toBe("Hello");
  });

  test("respects MAX_TAGGED_ELEMENTS cap of 50", () => {
    // Create 60 visible buttons
    for (let i = 0; i < 60; i++) {
      const btn = document.createElement("button");
      btn.textContent = `Button ${i}`;
      document.body.appendChild(btn);
    }

    const tagged = tagElements();
    expect(tagged.length).toBeLessThanOrEqual(50);
  });

  test("extracts priority attributes", () => {
    const link = document.createElement("a");
    link.href = "https://example.com";
    link.textContent = "Example";
    link.setAttribute("data-testid", "example-link");
    document.body.appendChild(link);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["href"]).toContain("example.com");
    expect(tagged[0].attributes["data-testid"]).toBe("example-link");
  });

  test("includes state attributes when non-default", () => {
    const btn = document.createElement("button");
    btn.textContent = "Expand";
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("disabled", "");
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["aria-expanded"]).toBe("true");
    expect(tagged[0].attributes["disabled"]).toBe("true");
    expect(tagged[0].isDisabled).toBe(true);
  });

  test("filters random hash IDs from attributes", () => {
    const btn = document.createElement("button");
    btn.textContent = "Test";
    btn.id = "css-1q2w3e4r";
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    // The random hash ID should be filtered out
    expect(tagged[0].attributes["id"]).toBeUndefined();
  });

  test("keeps human-readable IDs in attributes", () => {
    const btn = document.createElement("button");
    btn.textContent = "Login";
    btn.id = "login-button";
    document.body.appendChild(btn);

    const tagged = tagElements();
    expect(tagged.length).toBe(1);
    expect(tagged[0].attributes["id"]).toBe("login-button");
  });
});

describe("isElementVisible", () => {
  test("returns false for display:none", () => {
    const div = document.createElement("div");
    div.style.display = "none";
    document.body.appendChild(div);
    expect(isElementVisible(div)).toBe(false);
  });

  // Note: The global mock returns {top:0, left:0, bottom:100, right:100, width:100, height:100}
  // which is within the viewport, so elements are visible by default in tests.
  test("returns true for element within viewport (default mock)", () => {
    const btn = document.createElement("button");
    btn.textContent = "Visible";
    document.body.appendChild(btn);
    expect(isElementVisible(btn)).toBe(true);
  });

  test("returns false for visibility:hidden", () => {
    const div = document.createElement("div");
    div.style.visibility = "hidden";
    document.body.appendChild(div);
    expect(isElementVisible(div)).toBe(false);
  });
});

describe("isRandomHash", () => {
  test("detects CSS module hashes", () => {
    expect(isRandomHash("css-1q2w3e4")).toBe(true);
    expect(isRandomHash("Button_root__2dKj")).toBe(true);
  });

  test("detects React-generated IDs", () => {
    expect(isRandomHash("u_0_j_8W0000")).toBe(true);
  });

  test("detects pure alphanumeric hashes without words", () => {
    expect(isRandomHash("AABBCCDD")).toBe(true);
    expect(isRandomHash("A1B2C3D4")).toBe(true);
  });

  test("preserves human-readable IDs", () => {
    expect(isRandomHash("login-button")).toBe(false);
    expect(isRandomHash("search-input")).toBe(false);
    expect(isRandomHash("main-nav")).toBe(false);
    expect(isRandomHash("header")).toBe(false);
    expect(isRandomHash("content")).toBe(false);
  });

  test("preserves short IDs", () => {
    expect(isRandomHash("nav")).toBe(false);
    expect(isRandomHash("btn")).toBe(false);
    expect(isRandomHash("app")).toBe(false);
  });

  test("preserves IDs with readable words even if long", () => {
    expect(isRandomHash("username")).toBe(false);
    expect(isRandomHash("password")).toBe(false);
    expect(isRandomHash("submitbutton")).toBe(false);
  });
});

describe("truncateText", () => {
  test("preserves short text unchanged", () => {
    expect(truncateText("Hello", 80)).toBe("Hello");
  });

  test("preserves text exactly at maxLength", () => {
    const exact = "A".repeat(80);
    expect(truncateText(exact, 80)).toBe(exact);
  });

  test("truncates with head/tail retention", () => {
    const long = "A".repeat(100);
    const result = truncateText(long, 80);
    expect(result.length).toBe(80);
    expect(result).toContain("...");
    // Head = 64 chars, tail = 13 chars, ellipsis = 3 chars = 80
    expect(result.startsWith("A".repeat(64))).toBe(true);
    expect(result.endsWith("A".repeat(13))).toBe(true);
  });

  test("preserves meaningful head and tail", () => {
    const text =
      "Add to Cart - Limited Time Offer - Free Shipping Available - Buy Now Before Stock Runs Out Today";
    const result = truncateText(text, 80);
    expect(result.length).toBe(80);
    // Head should preserve the beginning
    expect(result.startsWith("Add to Cart")).toBe(true);
    // Tail should preserve the end
    expect(result.endsWith("Today")).toBe(true);
  });

  test("returns empty string for empty input", () => {
    expect(truncateText("", 80)).toBe("");
  });
});
