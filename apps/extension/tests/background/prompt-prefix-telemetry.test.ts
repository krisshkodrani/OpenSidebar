import { describe, expect, test } from "vitest";

import type { LLMMessage } from "../../src/background/llm/types";
import {
  PrefixResetLedger,
  comparePromptPrefix,
  fingerprintPrompt,
} from "../../src/background/agent/prompt-prefix-telemetry";

const sys = (content: string): LLMMessage => ({ role: "system", content });
const user = (content: string): LLMMessage => ({ role: "user", content });
const asst = (content: string): LLMMessage => ({
  role: "assistant",
  content,
});

/** Long enough to span several 256-char hash blocks. */
const pad = (seed: string, length: number) => seed.repeat(length).slice(0, length);

function diff(previous: LLMMessage[], current: LLMMessage[]) {
  return comparePromptPrefix(
    fingerprintPrompt(previous),
    fingerprintPrompt(current),
  );
}

describe("fingerprintPrompt", () => {
  test("retains no prompt text — only hashes and lengths", () => {
    const secret = "SESSION-TOKEN-abc123 and a home address";
    const fingerprint = fingerprintPrompt([sys(pad("x", 600)), user(secret)]);

    // The whole point: a fingerprint may be logged and exported, so no
    // substring of the prompt may survive anywhere inside it.
    const serialized = JSON.stringify(fingerprint);
    expect(serialized).not.toContain("SESSION-TOKEN");
    expect(serialized).not.toContain("home address");
    expect(serialized).not.toContain("xxxx");
  });

  test("is stable for identical prompts and changes when any byte changes", () => {
    const a = fingerprintPrompt([sys("stable"), user("page A")]);
    const b = fingerprintPrompt([sys("stable"), user("page A")]);
    const c = fingerprintPrompt([sys("stable"), user("page B")]);

    expect(a.digest).toBe(b.digest);
    expect(c.digest).not.toBe(a.digest);
  });

  test("a changed tool-call argument counts as a change", () => {
    const withCall = (args: string): LLMMessage => ({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "1", type: "function", function: { name: "click", arguments: args } },
      ],
    });
    const a = fingerprintPrompt([sys("s"), withCall('{"id":1}')]);
    const b = fingerprintPrompt([sys("s"), withCall('{"id":2}')]);

    expect(a.digest).not.toBe(b.digest);
  });
});

describe("comparePromptPrefix", () => {
  test("reports the first turn rather than a fake 100% stable prefix", () => {
    const result = comparePromptPrefix(null, fingerprintPrompt([sys("a")]));

    expect(result.isFirstTurn).toBe(true);
    expect(result.stablePrefixChars).toBe(0);
    expect(result.firstDivergenceRegion).toBe("none");
  });

  test("a pure append reports NO divergence — the ideal cache case", () => {
    const base = [sys(pad("s", 600)), user("goal"), user("page state")];
    const grown = [...base, asst("thinking"), user("page state 2")];

    const result = diff(base, grown);

    expect(result.firstDivergenceMessageIndex).toBeNull();
    expect(result.firstDivergenceRegion).toBe("none");
    // Every message of the previous prompt survived byte-identical.
    expect(result.stablePrefixMessages).toBe(base.length);
  });

  test("locates divergence inside the system message, not just at it", () => {
    // LP-21 phase 2's claim is that message 0 is byte-stable. Verifying that
    // needs sub-message resolution: "diverges at char 512" vs "does not".
    const head = pad("s", 600);
    const before = [sys(head + "STABLE-TAIL"), user("x")];
    const after = [sys(head + "CHANGED-TAIL"), user("x")];

    const result = diff(before, after);

    expect(result.firstDivergenceMessageIndex).toBe(0);
    expect(result.firstDivergenceRegion).toBe("system");
    // Block-aligned lower bound: never claims more survived than actually did.
    expect(result.firstDivergenceOffset).toBeLessThanOrEqual(600);
    expect(result.firstDivergenceOffset).toBeGreaterThan(0);
  });

  test("attributes a changed trailing message to the volatile tail, by design", () => {
    // Page state moves every turn — that is the LP-21 layout working, not a bug.
    const before = [sys("stable"), user("goal"), user("Page: A")];
    const after = [sys("stable"), user("goal"), user("Page: B")];

    expect(diff(before, after).firstDivergenceRegion).toBe("volatile_tail");
  });

  test("attributes a rewritten middle message to history — the #103 defect", () => {
    const before = [sys("stable"), user("goal"), asst("full tool result"), user("page")];
    const after = [sys("stable"), user("goal"), asst("trunc [truncated]"), user("page")];

    const result = diff(before, after);

    expect(result.firstDivergenceRegion).toBe("history");
    expect(result.firstDivergenceMessageIndex).toBe(2);
  });

  test("treats a shortened history as divergence at the truncation point", () => {
    const before = [sys("s"), user("a"), user("b"), user("c")];
    const after = [sys("s"), user("a")];

    const result = diff(before, after);

    // The provider cached a longer prompt than we are now sending, so the
    // surviving prefix ends where our prompt does.
    expect(result.firstDivergenceMessageIndex).toBe(2);
  });

  test("stablePrefixPct is a share of the CURRENT prompt", () => {
    const before = [sys(pad("s", 1000)), user("tail A")];
    const after = [sys(pad("s", 1000)), user("tail B")];

    const result = diff(before, after);

    expect(result.stablePrefixPct).toBeGreaterThan(90);
    expect(result.stablePrefixPct).toBeLessThanOrEqual(100);
  });
});

describe("PrefixResetLedger", () => {
  test("reports a reset exactly once, to the turn that pays for it", () => {
    const ledger = new PrefixResetLedger();
    ledger.record("rolling_distill", 24, 9);

    expect(ledger.consume()).toEqual({
      cause: "rolling_distill",
      messagesBefore: 24,
      messagesAfter: 9,
    });
    // A later turn must not re-report a reset it did not cause.
    expect(ledger.consume()).toBeNull();
  });

  test("is empty when no compaction ran", () => {
    expect(new PrefixResetLedger().consume()).toBeNull();
  });
});
