import { describe, expect, test } from "vitest";
import { getIncompleteDoneSummaryReason } from "../../src/background/agent/summary-completeness";

describe("done summary completeness guard", () => {
  test("rejects long summarize outputs that end mid-sentence", () => {
    const summary =
      "Wikipedia Homepage Summary\nOverview The Wikipedia homepage serves as the central portal for accessing Wikipedia in multiple languages and discovering related Wikimedia projects.\nKey Sections\nHeader & Search - Title: Wikipedia - The Free Encyclopedia - Search functionality: Central search input with a blue Search button, allowing users to search Wikipedia directly\nLanguage Options The homepage prominently displays links to the top 10 Wikipedia language";

    expect(
      getIncompleteDoneSummaryReason({
        summary,
        taskContext: "Read and summarize this page",
      }),
    ).toBe("summary does not end as a complete sentence");
  });

  test("allows complete long summarize outputs", () => {
    const summary =
      "Wikipedia Homepage Summary. The homepage is a multilingual portal with search, major language links, and Wikimedia project links. It lets users search Wikipedia directly and choose a language edition.";

    expect(
      getIncompleteDoneSummaryReason({
        summary,
        taskContext: "Read and summarize this page",
      }),
    ).toBeNull();
  });
});
