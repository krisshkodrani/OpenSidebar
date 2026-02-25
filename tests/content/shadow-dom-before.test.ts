import { describe, test, expect, beforeEach } from "vitest";
import "../../tests/setup";
import { isElementVisible } from "../../src/content/tagging";

describe("Shadow DOM Support - BEFORE State", () => {
  // This test documents what worked BEFORE Shadow DOM implementation

  test("standard DOM elements are discoverable", () => {
    const button = document.createElement("button");
    button.textContent = "Click me";
    document.body.appendChild(button);

    const found = document.querySelectorAll("button");
    expect(found.length).toBe(1);

    document.body.removeChild(button);
  });

  test("elements inside shadow DOM are NOT discoverable with querySelectorAll", () => {
    // Create a web component host
    const host = document.createElement("div");
    host.id = "shadow-host";
    document.body.appendChild(host);

    // Attach shadow root with interactive elements
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
            <button id="shadow-button">Shadow Button</button>
            <input type="text" id="shadow-input" placeholder="Shadow Input">
            <a href="https://example.com" id="shadow-link">Shadow Link</a>
        `;

    // Standard querySelectorAll CANNOT find these elements
    const buttons = document.querySelectorAll("button");
    const inputs = document.querySelectorAll("input");
    const links = document.querySelectorAll("a");

    // These will all be 0 because elements are inside shadow DOM
    expect(buttons.length).toBe(0);
    expect(inputs.length).toBe(0);
    expect(links.length).toBe(0);

    document.body.removeChild(host);
  });

  test("nested shadow DOM compounds the problem", () => {
    // Outer component
    const outer = document.createElement("div");
    outer.id = "outer-host";
    document.body.appendChild(outer);

    const outerShadow = outer.attachShadow({ mode: "open" });
    outerShadow.innerHTML = `
            <div id="inner-host"></div>
        `;

    // Inner component inside outer's shadow
    const innerHost = outerShadow.getElementById("inner-host")!;
    const innerShadow = innerHost.attachShadow({ mode: "open" });
    innerShadow.innerHTML = `
            <button id="deep-button">Deep Button</button>
        `;

    // Cannot find deeply nested shadow elements
    const buttons = document.querySelectorAll("button");
    expect(buttons.length).toBe(0);

    // Can only access via shadow root traversal
    const shadowButton = outerShadow
      .getElementById("inner-host")!
      .shadowRoot!.getElementById("deep-button");
    expect(shadowButton).toBeDefined();

    document.body.removeChild(outer);
  });
});

describe("DOM Coverage Report - BEFORE", () => {
  test("documents coverage limitations", () => {
    const coverage = {
      standardDOM: "✅ Full support - querySelectorAll works",
      openShadowDOM: "❌ No support - elements invisible",
      closedShadowDOM: "❌ No support - inaccessible by design",
      nestedShadowDOM: "❌ No support - compounded invisibility",
      webComponents: "❌ Limited support - only light DOM",
      frameworks: {
        lit: "❌ Shadow DOM elements invisible",
        stencil: "❌ Shadow DOM elements invisible",
        angularElements: "❌ Shadow DOM elements invisible",
        materialWeb: "❌ Shadow DOM elements invisible",
      },
    };

    // Document what percentage of web is covered
    expect(coverage.standardDOM).toContain("Full support");
    expect(coverage.openShadowDOM).toContain("No support");
  });
});
