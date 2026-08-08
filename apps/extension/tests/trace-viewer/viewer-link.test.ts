import { describe, expect, test } from "vitest";
import {
  buildViewerUrl,
  parseViewerHash,
  serializeViewerHash,
} from "@observability-schema";

describe("viewer deep links", () => {
  test("round-trips a turn-specific session link", () => {
    const hash = serializeViewerHash({
      sessionId: "session with spaces",
      view: "turns",
      turn: 7,
    });
    expect(parseViewerHash(hash)).toMatchObject({
      sessionId: "session with spaces",
      view: "turns",
      turn: 7,
    });
  });

  test("round-trips a request-specific Model I/O link", () => {
    const hash = serializeViewerHash({
      sessionId: "session-1",
      view: "prompts",
      turn: 5,
      section: "request",
    });

    expect(hash).toBe(
      "#session=session-1&view=prompts&turn=5&section=request",
    );
    expect(parseViewerHash(hash)).toMatchObject({
      sessionId: "session-1",
      view: "prompts",
      turn: 5,
      section: "request",
    });
  });

  test("does not serialize a Model I/O section without a focused turn", () => {
    expect(
      serializeViewerHash({
        sessionId: "session-1",
        view: "prompts",
        section: "response",
      }),
    ).toBe("#session=session-1&view=prompts");
  });

  test("builds a shareable run filter link", () => {
    expect(
      buildViewerUrl({ runId: "run-1" }, "http://127.0.0.1:7589/viewer"),
    ).toBe("http://127.0.0.1:7589/viewer#run=run-1");
  });

  test("omits default views from compact links", () => {
    expect(
      serializeViewerHash({ sessionId: "session-1", view: "story" }),
    ).toBe("#session=session-1");
  });
});
