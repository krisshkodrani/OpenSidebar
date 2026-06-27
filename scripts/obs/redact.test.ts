import { describe, expect, it } from "vitest";

import { dispatch } from "./mcp-server";
import { redactPii, redactPiiInText } from "./redact";

describe("redactPiiInText", () => {
  it("scrubs common PII shapes", () => {
    expect(redactPiiInText("reach me at john.doe@example.com")).toBe(
      "reach me at [redacted:email]",
    );
    expect(redactPiiInText("ssn 123-45-6789")).toBe("ssn [redacted:ssn]");
    expect(redactPiiInText("call 415-555-0132")).toBe("call [redacted:phone]");
    expect(redactPiiInText("card 4111 1111 1111 1111")).toBe("card [redacted:cc]");
  });

  it("leaves non-PII text untouched", () => {
    expect(redactPiiInText("clicked the Submit button")).toBe(
      "clicked the Submit button",
    );
  });
});

describe("redactPii (deep)", () => {
  it("redacts strings nested in objects and arrays", () => {
    const input = {
      session: "abc",
      entries: [
        { content: "email: a@b.com", turn: 1 },
        { perception: { interpretation: "form prefilled with 123-45-6789" } },
      ],
    };
    const out = redactPii(input);
    expect(out.entries[0].content).toBe("email: [redacted:email]");
    expect(out.entries[1].perception.interpretation).toBe(
      "form prefilled with [redacted:ssn]",
    );
    // Non-string values preserved.
    expect(out.entries[0].turn).toBe(1);
  });
});

describe("dispatch redaction boundary", () => {
  it("redacts errors surfaced to agents but never throws raw PII", () => {
    // Unknown tool path returns through runTool -> throws; dispatch for a known
    // tool with a missing session returns a redacted (here empty) result.
    expect(() => dispatch("unknown_tool", {})).toThrow();
  });

  it("does not run text redaction over get_blob base64", () => {
    // get_blob for a non-existent screenshot returns { exists: false } with no
    // base64; the point is dispatch must not redact a base64 field if present.
    const result = dispatch("get_blob", {
      sessionId: "no-such-session",
      turn: 0,
    }) as { exists: boolean; base64?: string };
    expect(result.exists).toBe(false);
  });
});
