import { describe, test, expect } from "bun:test";
import "../setup";
import {
  resolveRuntimeLimits,
  reassessRuntimeLimits,
  DEFAULT_RUNTIME_LIMITS,
  DIFFICULTY_PROFILES,
} from "../../src/background/agent/constants";
import type { Difficulty, RuntimeLimits } from "../../src/background/agent/constants";

describe("resolveRuntimeLimits", () => {
  test("returns defaults for moderate with no overrides", () => {
    const result = resolveRuntimeLimits("moderate");
    // Moderate profile only overrides stuckEscalate and maxDoneRejections
    expect(result.stuckEscalate).toBe(4); // moderate profile
    expect(result.maxDoneRejections).toBe(2); // moderate profile
    // Everything else should be default
    expect(result.stuckGiveUp).toBe(DEFAULT_RUNTIME_LIMITS.stuckGiveUp);
    expect(result.toolFailureExit).toBe(DEFAULT_RUNTIME_LIMITS.toolFailureExit);
    expect(result.maxConsecutiveAllFail).toBe(DEFAULT_RUNTIME_LIMITS.maxConsecutiveAllFail);
  });

  test("applies simple profile correctly (all values tighter)", () => {
    const result = resolveRuntimeLimits("simple");
    expect(result.stuckEscalate).toBe(3);
    expect(result.stuckGiveUp).toBe(6);
    expect(result.stuckGiveUpSmart).toBe(5);
    expect(result.maxEscalationCycles).toBe(2);
    expect(result.toolFailureWarn).toBe(2);
    expect(result.toolFailureExit).toBe(4);
    expect(result.maxDoneRejections).toBe(1);
    expect(result.maxConsecutiveAllFail).toBe(3);
    expect(result.stagnationReflection).toBe(2);
    expect(result.stagnationPivot).toBe(3);
    expect(result.stepWarnTurns).toBe(3);
    expect(result.stepEscalateTurns).toBe(6);
    expect(result.maxFreshStarts).toBe(1);
  });

  test("applies extreme profile correctly (all values wider)", () => {
    const result = resolveRuntimeLimits("extreme");
    expect(result.stuckEscalate).toBe(8);
    expect(result.stuckGiveUp).toBe(18);
    expect(result.stuckGiveUpSmart).toBe(14);
    expect(result.maxEscalationCycles).toBe(5);
    expect(result.escalationCooldown).toBe(2);
    expect(result.toolFailureExit).toBe(10);
    expect(result.maxDoneRejections).toBe(5);
    expect(result.maxFreshStarts).toBe(3);
  });

  test("guardian overrides take precedence over profile", () => {
    const result = resolveRuntimeLimits("simple", { toolFailureExit: 7 });
    // Profile says 4, override says 7
    expect(result.toolFailureExit).toBe(7);
    // Other simple profile values should still be applied
    expect(result.stuckEscalate).toBe(3);
    expect(result.maxDoneRejections).toBe(1);
  });

  test("clamps to minimum floor (model can't set stuckEscalate: 0)", () => {
    const result = resolveRuntimeLimits("simple", { stuckEscalate: 0 });
    expect(result.stuckEscalate).toBe(2); // MINIMUM_LIMITS.stuckEscalate
  });

  test("clamps to maximum ceiling (model can't set stuckGiveUp: 999)", () => {
    const result = resolveRuntimeLimits("extreme", { stuckGiveUp: 999 });
    expect(result.stuckGiveUp).toBe(25); // MAXIMUM_LIMITS.stuckGiveUp
  });

  test("clamps all values within bounds simultaneously", () => {
    const overrides: Partial<RuntimeLimits> = {
      stuckEscalate: -5,
      stuckGiveUp: 100,
      toolFailureExit: 0,
      maxDoneRejections: 50,
    };
    const result = resolveRuntimeLimits("moderate", overrides);
    expect(result.stuckEscalate).toBe(2); // floor
    expect(result.stuckGiveUp).toBe(25); // ceiling
    expect(result.toolFailureExit).toBe(3); // floor
    expect(result.maxDoneRejections).toBe(7); // ceiling
  });

  test("null overrides are ignored", () => {
    const result = resolveRuntimeLimits("complex", null);
    expect(result.stuckEscalate).toBe(6); // complex profile
    expect(result.toolFailureExit).toBe(8); // complex profile
  });

  test("undefined overrides are ignored", () => {
    const result = resolveRuntimeLimits("complex", undefined);
    expect(result.stuckEscalate).toBe(6);
  });

  test("all four difficulty levels produce distinct profiles", () => {
    const simple = resolveRuntimeLimits("simple");
    const moderate = resolveRuntimeLimits("moderate");
    const complex = resolveRuntimeLimits("complex");
    const extreme = resolveRuntimeLimits("extreme");

    // stuckGiveUp should increase with difficulty
    expect(simple.stuckGiveUp).toBeLessThan(moderate.stuckGiveUp);
    expect(moderate.stuckGiveUp).toBeLessThan(complex.stuckGiveUp);
    expect(complex.stuckGiveUp).toBeLessThan(extreme.stuckGiveUp);

    // maxDoneRejections should increase with difficulty
    expect(simple.maxDoneRejections).toBeLessThan(moderate.maxDoneRejections);
    expect(moderate.maxDoneRejections).toBeLessThan(complex.maxDoneRejections);
    expect(complex.maxDoneRejections).toBeLessThan(extreme.maxDoneRejections);
  });
});

describe("reassessRuntimeLimits", () => {
  const base = resolveRuntimeLimits("moderate");

  test("can only widen non-maxDoneRejections values", () => {
    const result = reassessRuntimeLimits(base, {
      stuckEscalate: base.stuckEscalate - 1, // try to tighten
      toolFailureExit: base.toolFailureExit + 2, // widen
    });
    // stuckEscalate should NOT be tightened
    expect(result.stuckEscalate).toBe(base.stuckEscalate);
    // toolFailureExit should be widened
    expect(result.toolFailureExit).toBe(base.toolFailureExit + 2);
  });

  test("can tighten maxDoneRejections", () => {
    const complexBase = resolveRuntimeLimits("complex");
    const result = reassessRuntimeLimits(complexBase, {
      maxDoneRejections: 1,
    });
    expect(result.maxDoneRejections).toBe(1);
  });

  test("respects floor after reassessment", () => {
    const result = reassessRuntimeLimits(base, {
      maxDoneRejections: 0, // below floor
    });
    expect(result.maxDoneRejections).toBe(1); // MINIMUM_LIMITS.maxDoneRejections
  });

  test("respects ceiling after reassessment", () => {
    const result = reassessRuntimeLimits(base, {
      stuckGiveUp: 999,
    });
    expect(result.stuckGiveUp).toBe(25); // MAXIMUM_LIMITS.stuckGiveUp
  });

  test("does not modify original limits object", () => {
    const original = { ...base };
    reassessRuntimeLimits(base, { toolFailureExit: 12 });
    expect(base).toEqual(original);
  });

  test("handles empty overrides", () => {
    const result = reassessRuntimeLimits(base, {});
    expect(result).toEqual(base);
  });

  test("ignores null values in overrides", () => {
    const overrides = { stuckEscalate: null } as unknown as Partial<RuntimeLimits>;
    const result = reassessRuntimeLimits(base, overrides);
    expect(result.stuckEscalate).toBe(base.stuckEscalate);
  });
});

describe("DIFFICULTY_PROFILES", () => {
  test("all profiles have valid keys", () => {
    const validKeys = new Set(Object.keys(DEFAULT_RUNTIME_LIMITS));
    for (const [difficulty, profile] of Object.entries(DIFFICULTY_PROFILES)) {
      for (const key of Object.keys(profile)) {
        expect(validKeys.has(key)).toBe(true);
      }
    }
  });

  test("all difficulties are covered", () => {
    const expected: Difficulty[] = ["simple", "moderate", "complex", "extreme"];
    for (const d of expected) {
      expect(DIFFICULTY_PROFILES[d]).toBeDefined();
    }
  });
});
