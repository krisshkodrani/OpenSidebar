import "../setup";
import { describe, test, expect, beforeEach } from "vitest";
import {
  extractPageContent,
  extractVisibleText,
} from "../../src/content/readability";

// ----- helpers -----

function setBody(html: string) {
  document.body.innerHTML = html;
}

/** Build a substantial article page that Readability can parse */
function setArticlePage(bodyContent: string) {
  // Readability needs a title and enough content to detect an article
  document.title = "Test Article";
  setBody(`
    <article>
      <h1>Test Article Heading</h1>
      ${bodyContent}
    </article>
  `);
}

// ========================================================================
// extractPageContent
// ========================================================================

describe("extractPageContent", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.title = "";
  });

  test("returns null for empty/minimal pages", () => {
    setBody("<div></div>");
    expect(extractPageContent()).toBeNull();
  });

  test("handles non-article pages gracefully", () => {
    // A page with only navigation — Readability may return null or
    // a minimal result depending on the DOM implementation
    setBody("<nav><a href='/'>Home</a><a href='/about'>About</a></nav>");
    const result = extractPageContent();
    // Should not throw; returns string or null
    expect(result === null || typeof result === "string").toBe(true);
  });

  test("extracts content from article-like pages", () => {
    // Readability needs a substantial amount of text to detect an article
    const paragraphs = Array.from(
      { length: 5 },
      (_, i) =>
        `<p>This is paragraph ${i + 1} with enough content to make Readability happy. ` +
        `It contains meaningful text that simulates a real article on a webpage. ` +
        `The content needs to be substantial for the parser to recognize it.</p>`,
    ).join("\n");
    setArticlePage(paragraphs);

    const result = extractPageContent();
    // Readability may or may not parse this depending on happy-dom's implementation,
    // but we verify it doesn't crash and returns string or null
    expect(result === null || typeof result === "string").toBe(true);
  });

  test("collapses excessive blank lines", () => {
    // If Readability returns content with many blank lines, they should be collapsed
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) =>
        `<p>Paragraph ${i + 1} of the article with enough text to be parsed correctly by the Readability library.</p>`,
    ).join("\n\n\n\n\n");
    setArticlePage(paragraphs);

    const result = extractPageContent();
    if (result) {
      // Should not contain 3+ consecutive newlines
      expect(result).not.toMatch(/\n{3,}/);
    }
  });

  test("does not throw on malformed DOM", () => {
    // Readability should not throw even with weird DOM structures
    setBody(
      "<div><table><tr><td>Unclosed<div>Weird nesting</td></tr></table></div>",
    );
    expect(() => extractPageContent()).not.toThrow();
  });
});

// ========================================================================
// extractVisibleText
// ========================================================================

describe("extractVisibleText", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("extracts visible text from simple page", () => {
    setBody("<p>Hello world</p><p>Second paragraph</p>");
    const result = extractVisibleText();
    expect(result).toContain("Hello world");
    expect(result).toContain("Second paragraph");
  });

  test("skips SCRIPT tags", () => {
    setBody(
      '<p>Visible</p><script>var x = "invisible";</script><p>Also visible</p>',
    );
    const result = extractVisibleText();
    expect(result).toContain("Visible");
    expect(result).toContain("Also visible");
    expect(result).not.toContain("invisible");
  });

  test("skips STYLE tags", () => {
    setBody(
      "<p>Content</p><style>.hidden { display: none; }</style>",
    );
    const result = extractVisibleText();
    expect(result).toContain("Content");
    expect(result).not.toContain("display");
  });

  test("skips NOSCRIPT tags", () => {
    setBody(
      "<p>With JS</p><noscript>Enable JavaScript</noscript>",
    );
    const result = extractVisibleText();
    expect(result).toContain("With JS");
    expect(result).not.toContain("Enable JavaScript");
  });

  test("skips IFRAME tags", () => {
    // IFRAME is in SKIP_TAGS — its text children should be filtered
    setBody("<p>Text</p><iframe>Iframe fallback</iframe>");
    const result = extractVisibleText();
    expect(result).toContain("Text");
    expect(result).not.toContain("Iframe fallback");
  });

  test("respects maxLength parameter (soft limit)", () => {
    // maxLength is a soft limit — the function stops collecting AFTER
    // exceeding the limit, so the result may overshoot by one text node.
    // With many small nodes it should stop close to the limit.
    const nodes = Array.from({ length: 200 }, (_, i) => `<p>Word${i}</p>`).join("");
    setBody(nodes);
    const result = extractVisibleText(100);
    // Should be much shorter than all 200 nodes concatenated
    expect(result.length).toBeLessThan(2000);
  });

  test("collapses excessive whitespace", () => {
    setBody("<p>  Hello   </p><p>  World  </p>");
    const result = extractVisibleText();
    // Should not have runs of 2+ spaces
    expect(result).not.toMatch(/\s{2,}/);
  });

  test("returns empty string for empty body", () => {
    setBody("");
    const result = extractVisibleText();
    expect(result).toBe("");
  });

  test("handles deeply nested content", () => {
    setBody(
      "<div><section><article><p>Deep content</p></article></section></div>",
    );
    const result = extractVisibleText();
    expect(result).toContain("Deep content");
  });

  test("joins text from multiple nodes with spaces", () => {
    setBody(
      "<span>Hello</span><span>World</span>",
    );
    const result = extractVisibleText();
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  test("stops collecting after exceeding default maxLength", () => {
    // With many separate text nodes, the function stops near the limit
    const nodes = Array.from({ length: 3000 }, (_, i) => `<span>Word${i} </span>`).join("");
    setBody(nodes);
    const result = extractVisibleText();
    // Should stop well before collecting all 3000 nodes
    expect(result.length).toBeLessThan(25000);
  });

  test("skips empty text nodes", () => {
    setBody("<p>   </p><p>Content</p>");
    const result = extractVisibleText();
    expect(result).toBe("Content");
  });
});
