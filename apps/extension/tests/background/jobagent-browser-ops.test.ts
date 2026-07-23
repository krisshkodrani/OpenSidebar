/**
 * JobAgent browser ops (RFC LP-22) — extraction parsing against a fake bridge.
 *
 * These two functions are the seam where model output becomes fact: whatever
 * they return is treated downstream as the posting's real fields and the
 * form's real questions. So the cases that matter most are the malformed ones
 * — a near-miss shape must degrade to a clear error, never to a confident
 * wrong value.
 */
import { describe, expect, test } from "vitest";

import type { BrowserToolResponse } from "../../../../scripts/browser-mcp/bridge";
import {
  ExtractionError,
  extractListing,
  extractQuestions,
  type BridgeCall,
} from "../../../../scripts/jobagent-console/browser-ops";

/** A bridge that replies with `response` and records what it was asked. */
function fakeBridge(response: BrowserToolResponse): {
  call: BridgeCall;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    call: async (request) => {
      calls.push({ tool: request.tool, args: request.args });
      return response;
    },
  };
}

const okResult = (result: unknown): BrowserToolResponse => ({ status: "ok", result });

describe("extractListing", () => {
  test("reads the listing fields and defaults applyUrl to the posting URL", async () => {
    const bridge = fakeBridge(
      okResult({
        title: " Senior AI Engineer ",
        company: "Acme",
        location: "Remote (EU)",
        snippet: "Build things.",
        applyUrl: "",
      }),
    );
    const listing = await extractListing(bridge.call, "https://board.example/jobs/1");

    expect(listing).toEqual({
      title: "Senior AI Engineer",
      company: "Acme",
      location: "Remote (EU)",
      snippet: "Build things.",
      applyUrl: "https://board.example/jobs/1",
    });
  });

  test("the extraction instruction forbids acting on the page", async () => {
    const bridge = fakeBridge(okResult({ title: "T", company: "C" }));
    await extractListing(bridge.call, "https://board.example/jobs/1");

    expect(bridge.calls[0].tool).toBe("browser_extract_structured");
    expect(bridge.calls[0].args.url).toBe("https://board.example/jobs/1");
    const instruction = String(bridge.calls[0].args.instruction);
    expect(instruction).toContain("Do not click");
    expect(instruction).toContain("do not fill");
  });

  test("parses a JSON string result (the extractor returns either shape)", async () => {
    const bridge = fakeBridge(okResult('{"title":"AI Engineer","company":"Acme"}'));
    const listing = await extractListing(bridge.call, "https://b.example/1");
    expect(listing.title).toBe("AI Engineer");
  });

  test("parses JSON wrapped in a markdown code fence", async () => {
    // Observed live: the extractor wraps its JSON in ```json … ``` often enough
    // that treating it as unparseable fails a real run.
    const bridge = fakeBridge(
      okResult('```json\n{"title":"AI Engineer","company":"Acme"}\n```'),
    );
    const listing = await extractListing(bridge.call, "https://b.example/1");
    expect(listing.title).toBe("AI Engineer");
    expect(listing.company).toBe("Acme");
  });

  test("missing fields become empty strings, never invented values", async () => {
    const bridge = fakeBridge(okResult({ title: "AI Engineer" }));
    const listing = await extractListing(bridge.call, "https://b.example/1");
    expect(listing.company).toBe("");
    expect(listing.location).toBe("");
  });

  test("a relative applyUrl is resolved against the posting URL", async () => {
    // Observed live: the same link came back absolute once and relative the
    // next time. Stored relative, it becomes a formUrl the fill cannot open.
    const bridge = fakeBridge(
      okResult({ title: "T", company: "C", applyUrl: "/ashby-job-application?job=sr-fe-1" }),
    );
    const listing = await extractListing(
      bridge.call,
      "http://localhost:3333/job-board?job=sr-fe-1",
    );
    expect(listing.applyUrl).toBe(
      "http://localhost:3333/ashby-job-application?job=sr-fe-1",
    );
  });

  test("an absolute applyUrl is left alone", async () => {
    const bridge = fakeBridge(
      okResult({ title: "T", company: "C", applyUrl: "https://ats.example/apply/1" }),
    );
    const listing = await extractListing(bridge.call, "http://board.example/jobs/1");
    expect(listing.applyUrl).toBe("https://ats.example/apply/1");
  });

  test("a non-ok bridge response surfaces its reason", async () => {
    const bridge = fakeBridge({ status: "error", reason: "tab crashed" });
    await expect(extractListing(bridge.call, "https://b.example/1")).rejects.toThrow(
      /tab crashed/,
    );
  });

  test("unparseable text is an error, not a guess", async () => {
    const bridge = fakeBridge(okResult("I could not read that page, sorry"));
    await expect(extractListing(bridge.call, "https://b.example/1")).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });
});

describe("extractQuestions", () => {
  const form = {
    questions: [
      { label: "Name *", kind: "text", required: true },
      { label: "Salary Expectation", kind: "text", required: true },
      { label: "EU Work Permit", kind: "select", required: true, options: ["Yes", "No"] },
      { label: "Why Do You Care About Acme?", kind: "longtext", required: true },
    ],
    morePages: false,
    pageNote: "",
  };

  test("maps labels, kinds, required-ness, and options", async () => {
    const bridge = fakeBridge(okResult(form));
    const result = await extractQuestions(bridge.call, "https://b.example/apply");

    expect(result.partial).toBe(false);
    expect(result.questions).toHaveLength(4);
    expect(result.questions[0]).toEqual({ label: "Name *", kind: "text", required: true });
    expect(result.questions[2].options).toEqual(["Yes", "No"]);
    expect(result.questions[3].kind).toBe("longtext");
  });

  test("an unrecognised kind is dropped rather than passed through", async () => {
    const bridge = fakeBridge(
      okResult({ questions: [{ label: "Birthday", kind: "date-picker" }] }),
    );
    const result = await extractQuestions(bridge.call, "https://b.example/apply");
    expect(result.questions[0]).toEqual({ label: "Birthday" });
  });

  test("fields with no label are skipped — an unnameable field is unanswerable", async () => {
    const bridge = fakeBridge(
      okResult({ questions: [{ label: "Email" }, { label: "   " }, { kind: "text" }] }),
    );
    const result = await extractQuestions(bridge.call, "https://b.example/apply");
    expect(result.questions.map((q) => q.label)).toEqual(["Email"]);
  });

  test("a multi-page form reports partial with its evidence", async () => {
    const bridge = fakeBridge(
      okResult({
        questions: [{ label: "Name" }],
        morePages: true,
        pageNote: "Step 1 of 3",
      }),
    );
    const result = await extractQuestions(bridge.call, "https://b.example/apply");
    expect(result.partial).toBe(true);
    expect(result.pageNote).toBe("Step 1 of 3");
  });

  test("a form with no labelled fields is an error, not an empty kit", async () => {
    const bridge = fakeBridge(okResult({ questions: [] }));
    await expect(
      extractQuestions(bridge.call, "https://b.example/apply"),
    ).rejects.toThrow(/no labelled fields/);
  });

  test("the instruction forbids answering the questions it reads", async () => {
    const bridge = fakeBridge(okResult(form));
    await extractQuestions(bridge.call, "https://b.example/apply");
    const instruction = String(bridge.calls[0].args.instruction);
    expect(instruction).toContain("do not rephrase, translate, or answer them");
    expect(instruction).toContain("Do NOT fill, click, or submit");
  });
});
