import { describe, expect, test } from "vitest";
import "../setup";
import {
  normalizeCompletionMarkdown,
  renderAssistantMarkdown,
} from "../../src/sidepanel/message-formatting";

describe("completion summary markdown normalization", () => {
  test("splits collapsed headings and key-value bullets", () => {
    const raw =
      "# AI Software Engineer (m/f/d) at pplwise -- Job Summary ## Role Overview - **Position:** AI Software Engineer (m/f/d) - **Company:** pplwise - **Location:** Vienna preferred";

    const normalized = normalizeCompletionMarkdown(raw);

    expect(normalized).toContain("Job Summary\n\n## Role Overview");
    expect(normalized).toContain("\n- **Position:** AI Software Engineer");
    expect(normalized).toContain("\n- **Company:** pplwise");
    expect(normalized).toContain("\n- **Location:** Vienna preferred");
  });

  test("renders enhanced key-value runs as a definition list", () => {
    const html = renderAssistantMarkdown(
      "**Role:** Engineer\n**Location:** Remote\n**Salary:** EUR 70,000",
      { enhanceKeyValueBlocks: true },
    );

    expect(html).toContain('class="completion-kv"');
    expect(html).toContain("<dt>Role</dt>");
    expect(html).toContain("<dd>Engineer</dd>");
  });
});
