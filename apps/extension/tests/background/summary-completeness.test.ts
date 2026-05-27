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

  test("allows summaries that end in a complete sentence wrapped in Markdown emphasis", () => {
    const summary =
      "Found Post #35 'The Secret Formula for Productivity' in the feed. " +
      "The answer to maximum productivity is the secret code CODE-OMEGA-42, " +
      'which unlocks the productivity dashboard. Most people overlook this simple insight."*';

    expect(
      getIncompleteDoneSummaryReason({
        summary,
        taskContext: "Find the post and read the secret code mentioned in it",
      }),
    ).toBeNull();
  });

  test("does not apply summarize punctuation checks to draft review tasks", () => {
    const summary =
      "- Drafted the German apology message in the composer\n" +
      "- Confirmed the composer contains the requested apology and job-search context\n" +
      "- Left unsent in the composer for your review - the Send button was not clicked";

    expect(
      getIncompleteDoneSummaryReason({
        summary,
        taskContext:
          "Type a German apology message in the composer and do NOT send, leave for user review.",
      }),
    ).toBeNull();
  });
});
