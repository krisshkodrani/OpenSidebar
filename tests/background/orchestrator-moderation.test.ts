import { describe, test, expect } from "bun:test";
import {
  moderateUserInput,
  moderateFinalOutput,
} from "../../src/background/orchestrator/moderation";

describe("moderateUserInput", () => {
  test("allows benign queries", () => {
    expect(moderateUserInput("Book a flight to Paris")).toEqual({ allowed: true });
    expect(moderateUserInput("Fill out the contact form")).toEqual({ allowed: true });
    expect(moderateUserInput("Search for product reviews")).toEqual({ allowed: true });
  });

  test("blocks violence/harm patterns", () => {
    const result = moderateUserInput("how to make a bomb");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("violence");
    expect(result.severity).toBe("high");
  });

  test("blocks self-harm patterns", () => {
    const result = moderateUserInput("how to commit suicide");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("self_harm");
    expect(result.severity).toBe("high");
  });

  test("blocks illegal activity patterns", () => {
    const result = moderateUserInput("how to hack a bank account");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("illegal_activity");
  });

  test("returns correct category and severity", () => {
    const result = moderateUserInput("synthesize meth at home");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("illegal_activity");
    expect(result.severity).toBe("high");
    expect(result.reason).toContain("illegal_activity");
  });

  test("handles empty strings", () => {
    expect(moderateUserInput("")).toEqual({ allowed: true });
  });

  test("handles very long strings", () => {
    const longText = "a".repeat(100_000);
    expect(moderateUserInput(longText)).toEqual({ allowed: true });
  });

  test("standard mode allows strict-only patterns", () => {
    const result = moderateUserInput("how to steal", "standard");
    expect(result.allowed).toBe(true);
  });

  test("strict mode catches strict-only patterns", () => {
    const result = moderateUserInput("how to steal", "strict");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("illegal_activity");
  });
});

describe("moderateFinalOutput", () => {
  test("allows clean summaries", () => {
    expect(
      moderateFinalOutput("Successfully filled out the form and submitted it."),
    ).toEqual({ allowed: true });
  });

  test("flags SSN in output", () => {
    const result = moderateFinalOutput(
      "Found user SSN: 123-45-6789 in the database.",
    );
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("pii_exposure");
    expect(result.reason).toContain("SSN");
  });

  test("flags credit card in output", () => {
    const result = moderateFinalOutput("Card number: 4111 1111 1111 1111");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("pii_exposure");
    expect(result.reason).toContain("credit card");
  });

  test("also checks content policy patterns in output", () => {
    const result = moderateFinalOutput("how to make a bomb at home");
    expect(result.allowed).toBe(false);
    expect(result.category).toBe("violence");
  });

  test("handles empty output", () => {
    expect(moderateFinalOutput("")).toEqual({ allowed: true });
  });

  test("standard vs strict threshold difference for output", () => {
    // "steal" is strict-only
    const standard = moderateFinalOutput("how to steal cookies", "standard");
    expect(standard.allowed).toBe(true);

    const strict = moderateFinalOutput("how to steal cookies", "strict");
    expect(strict.allowed).toBe(false);
  });
});
