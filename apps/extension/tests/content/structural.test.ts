import { describe, test, expect, beforeEach } from "vitest";
import { extractPageSkeleton } from "../../src/content/tagging/structural";
import "../../tests/setup";

describe("extractPageSkeleton", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("extracts headings with correct level and text", () => {
    document.body.innerHTML = `
      <h1>Main Title</h1>
      <h2>Subtitle</h2>
      <h3>Section Three</h3>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(3);
    expect(skeleton[0]).toMatchObject({
      tagName: "h1",
      role: "heading",
      level: 1,
      text: "Main Title",
    });
    expect(skeleton[1]).toMatchObject({
      tagName: "h2",
      role: "heading",
      level: 2,
      text: "Subtitle",
    });
    expect(skeleton[2]).toMatchObject({
      tagName: "h3",
      role: "heading",
      level: 3,
      text: "Section Three",
    });
  });

  test("extracts landmarks (nav, main, header, footer)", () => {
    document.body.innerHTML = `
      <header>Site Header Content</header>
      <nav>Navigation Links Here</nav>
      <main>Main Content Area</main>
      <footer>Footer Information</footer>
    `;

    const skeleton = extractPageSkeleton();
    const tagNames = skeleton.map((n) => n.tagName);
    expect(tagNames).toContain("header");
    expect(tagNames).toContain("nav");
    expect(tagNames).toContain("main");
    expect(tagNames).toContain("footer");
  });

  test("extracts status and alert elements", () => {
    document.body.innerHTML = `
      <div role="status">Loading complete</div>
      <div role="alert">Error: something went wrong!</div>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(2);
    expect(skeleton[0]).toMatchObject({ role: "status" });
    expect(skeleton[1]).toMatchObject({ role: "alert" });
  });

  test("extracts text nodes with >= 10 chars", () => {
    document.body.innerHTML = `
      <p>This is a long paragraph with useful content.</p>
      <p>Short</p>
      <span>Another long span element with content.</span>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(2);
    expect(skeleton[0].tagName).toBe("p");
    expect(skeleton[0].text).toBe(
      "This is a long paragraph with useful content.",
    );
    expect(skeleton[1].tagName).toBe("span");
  });

  test("skips text nodes with < 10 chars", () => {
    document.body.innerHTML = `<p>Tiny</p>`;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(0);
  });

  test("keeps headings with >= 3 chars but < 10 chars", () => {
    document.body.innerHTML = `<h1>FAQ</h1>`;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].text).toBe("FAQ");
  });

  test("deduplicates against interactive element texts", () => {
    document.body.innerHTML = `
      <h1>Submit Order</h1>
      <h2>Unique Heading</h2>
      <p>Submit Order</p>
    `;

    const interactiveTexts = new Set(["Submit Order"]);
    const skeleton = extractPageSkeleton(interactiveTexts);
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].text).toBe("Unique Heading");
  });

  test("deduplicates within skeleton (same text appears twice)", () => {
    document.body.innerHTML = `
      <h1>Welcome Page</h1>
      <h2>Welcome Page</h2>
    `;

    const skeleton = extractPageSkeleton();
    // Only the first occurrence should be kept
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].tagName).toBe("h1");
  });

  test("caps at 30 nodes with headings prioritized", () => {
    let html = "";
    // 10 headings
    for (let i = 0; i < 10; i++) {
      html += `<h2>Heading ${i}</h2>`;
    }
    // 35 text paragraphs
    for (let i = 0; i < 35; i++) {
      html += `<p>Paragraph number ${i} with enough text to pass the threshold.</p>`;
    }
    document.body.innerHTML = html;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(30);

    // All 10 headings should be included
    const headings = skeleton.filter((n) => n.tagName === "h2");
    expect(headings.length).toBe(10);

    // Remaining 20 should be text nodes
    const paragraphs = skeleton.filter((n) => n.tagName === "p");
    expect(paragraphs.length).toBe(20);
  });

  test("preserves DOM order in output", () => {
    document.body.innerHTML = `
      <p>First paragraph with enough text.</p>
      <h1>Main Heading</h1>
      <p>Second paragraph with enough text.</p>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(3);
    // h1 is tier HEADING so gets selected first, but output is DOM-ordered
    expect(skeleton[0].tagName).toBe("p");
    expect(skeleton[1].tagName).toBe("h1");
    expect(skeleton[2].tagName).toBe("p");
  });

  test("filters out invisible elements", () => {
    document.body.innerHTML = `
      <h1 style="display: none;">Hidden Heading</h1>
      <h2>Visible Heading</h2>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].text).toBe("Visible Heading");
  });

  test("computes depth from body", () => {
    document.body.innerHTML = `
      <div>
        <section>
          <h1>Nested Heading</h1>
        </section>
      </div>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    // div(1) > section(2) = depth 2
    expect(skeleton[0].depth).toBe(2);
  });

  test("caps depth at 4", () => {
    document.body.innerHTML = `
      <div><div><div><div><div><div>
        <h1>Very Deeply Nested</h1>
      </div></div></div></div></div></div>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].depth).toBe(4);
  });

  test("truncates long text to 120 chars", () => {
    const longText = "A".repeat(200);
    document.body.innerHTML = `<h1>${longText}</h1>`;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].text.length).toBeLessThanOrEqual(120);
    expect(skeleton[0].text).toContain("...");
  });

  test("extracts role=heading with aria-level", () => {
    document.body.innerHTML = `
      <div role="heading" aria-level="2">Custom Heading</div>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    expect(skeleton[0]).toMatchObject({
      role: "heading",
      level: 2,
      text: "Custom Heading",
    });
  });

  test("extracts role=region with aria-label as landmark", () => {
    document.body.innerHTML = `
      <div role="region" aria-label="Search results">Some results content here</div>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].role).toBe("region");
  });

  test("extracts aside as landmark", () => {
    document.body.innerHTML = `
      <aside>Sidebar content with information</aside>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].role).toBe("complementary");
  });

  test("extracts aria-live region", () => {
    document.body.innerHTML = `
      <div aria-live="polite">Step 4 of 30</div>
    `;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(1);
    expect(skeleton[0].text).toBe("Step 4 of 30");
  });

  test("returns empty array for empty page", () => {
    const skeleton = extractPageSkeleton();
    expect(skeleton).toEqual([]);
  });

  test("priority: all headings + landmarks + status before text", () => {
    let html = "";
    // 5 headings
    for (let i = 0; i < 5; i++) {
      html += `<h2>Heading ${i}</h2>`;
    }
    // 5 landmarks
    for (let i = 0; i < 5; i++) {
      html += `<nav>Navigation set ${i} with links</nav>`;
    }
    // 5 status
    for (let i = 0; i < 5; i++) {
      html += `<div role="status">Status update number ${i}</div>`;
    }
    // 20 text nodes (more than remaining budget of 15)
    for (let i = 0; i < 20; i++) {
      html += `<p>Text paragraph number ${i} with sufficient content.</p>`;
    }
    document.body.innerHTML = html;

    const skeleton = extractPageSkeleton();
    expect(skeleton.length).toBe(30);

    // All structural nodes should be present (5+5+5 = 15)
    const headings = skeleton.filter((n) => n.role === "heading");
    const navs = skeleton.filter((n) => n.role === "navigation");
    const statuses = skeleton.filter((n) => n.role === "status");
    expect(headings.length).toBe(5);
    expect(navs.length).toBe(5);
    expect(statuses.length).toBe(5);

    // Remaining 15 text nodes (out of 20)
    const texts = skeleton.filter((n) => n.tagName === "p");
    expect(texts.length).toBe(15);
  });
});
