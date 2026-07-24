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

describe("tools-array fingerprinting", () => {
  const tool = (name: string, description = "d") => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties: {} } },
  });
  const msgs = [sys("stable"), user("goal")];

  test("identical tools report no divergence and toolsChange none", () => {
    const result = comparePromptPrefix(
      fingerprintPrompt(msgs, [tool("a"), tool("b")]),
      fingerprintPrompt(msgs, [tool("a"), tool("b")]),
    );

    expect(result.toolsChange).toBe("none");
    expect(result.firstDivergenceRegion).toBe("none");
  });

  test("a reordered tools array is a divergence at offset 0 — the skill-ranking signature", () => {
    // applySkillToolRanking reorders the array without changing the set. The
    // provider serializes tools ahead of every message, so this alone breaks
    // the whole cached prefix even though every message byte is identical.
    const result = comparePromptPrefix(
      fingerprintPrompt(msgs, [tool("a"), tool("b")]),
      fingerprintPrompt(msgs, [tool("b"), tool("a")]),
    );

    expect(result.toolsChange).toBe("reordered");
    expect(result.firstDivergenceRegion).toBe("tools");
    expect(result.firstDivergenceOffset).toBe(0);
    expect(result.stablePrefixPct).toBe(0);
  });

  test("a filtered tool set is set_changed, not reordered", () => {
    const result = comparePromptPrefix(
      fingerprintPrompt(msgs, [tool("a"), tool("b"), tool("c")]),
      fingerprintPrompt(msgs, [tool("a"), tool("b")]),
    );

    expect(result.toolsChange).toBe("set_changed");
    expect(result.firstDivergenceRegion).toBe("tools");
  });

  test("a changed tool DESCRIPTION is set_changed — definition bytes are part of the cache key", () => {
    const result = comparePromptPrefix(
      fingerprintPrompt(msgs, [tool("a", "old")]),
      fingerprintPrompt(msgs, [tool("a", "new")]),
    );

    expect(result.toolsChange).toBe("set_changed");
  });

  test("fingerprints without tools stay comparable and report unknown", () => {
    // Backward compatibility: a fingerprint carried over from a build that did
    // not hash tools must not fabricate a tools divergence.
    const result = comparePromptPrefix(
      fingerprintPrompt(msgs),
      fingerprintPrompt(msgs, [tool("a")]),
    );

    expect(result.toolsChange).toBe("unknown");
    expect(result.firstDivergenceRegion).toBe("none");
  });

  test("tools churn takes precedence over message divergence in attribution", () => {
    // Both changed: the tools break the prefix EARLIER than any message byte,
    // so the region must say tools, not history.
    const result = comparePromptPrefix(
      fingerprintPrompt([sys("s"), user("a"), user("p1")], [tool("a")]),
      fingerprintPrompt([sys("s"), user("b"), user("p2")], [tool("b")]),
    );

    expect(result.firstDivergenceRegion).toBe("tools");
  });

  test("retains no tool text — only digests and counts", () => {
    const fingerprint = fingerprintPrompt(msgs, [
      tool("secret_tool_name", "secret tool description"),
    ]);

    const serialized = JSON.stringify(fingerprint);
    expect(serialized).not.toContain("secret_tool_name");
    expect(serialized).not.toContain("secret tool description");
    expect(fingerprint.toolsCount).toBe(1);
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
