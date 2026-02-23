import { describe, test, expect } from "bun:test";
import "../setup";
import {
  checkVerificationGate,
  detectAdmission,
} from "../../src/background/agent/verification";
import type { VerificationGate } from "../../src/background/orchestrator/types";

describe("checkVerificationGate", () => {
  test("returns matched=false when no gate provided", () => {
    const result = checkVerificationGate(["some result"], undefined);
    expect(result.matched).toBe(false);
    expect(result.evidence).toBe("");
  });

  test("returns matched=false when gate is null", () => {
    const result = checkVerificationGate(["some result"], null);
    expect(result.matched).toBe(false);
  });

  test("matches via regex pattern", () => {
    const gate: VerificationGate = {
      trigger: "code accepted",
      action: "call_done",
      pattern: "Code\\s+accepted",
    };
    const result = checkVerificationGate(
      ["Error: not found", "Code accepted! Your submission was correct."],
      gate,
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("Code accepted");
  });

  test("matches via substring when no regex pattern", () => {
    const gate: VerificationGate = {
      trigger: "successfully submitted",
      action: "advance_step",
    };
    const result = checkVerificationGate(
      ["Form successfully submitted. Redirecting..."],
      gate,
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("successfully submitted");
  });

  test("matches via substring with multiple trigger phrases", () => {
    const gate: VerificationGate = {
      trigger: "order confirmed, payment received, checkout complete",
      action: "call_done",
    };
    const result = checkVerificationGate(
      ["Thank you! Your payment received."],
      gate,
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("payment received");
  });

  test("returns matched=false when no trigger matches", () => {
    const gate: VerificationGate = {
      trigger: "task completed",
      action: "call_done",
    };
    const result = checkVerificationGate(
      ["Clicked button", "Page loaded"],
      gate,
    );
    expect(result.matched).toBe(false);
  });

  test("falls back to substring match on invalid regex", () => {
    const gate: VerificationGate = {
      trigger: "code accepted",
      action: "call_done",
      pattern: "[invalid(regex",
    };
    const result = checkVerificationGate(
      ["The code accepted by the system"],
      gate,
    );
    expect(result.matched).toBe(true);
    expect(result.evidence).toContain("code accepted");
  });

  test("filters out short trigger phrases (<=3 chars)", () => {
    const gate: VerificationGate = {
      trigger: "ok, yes, successfully saved",
      action: "advance_step",
    };
    // "ok" and "yes" are <=3 chars, only "successfully saved" should be checked
    const result = checkVerificationGate(["Data ok"], gate);
    expect(result.matched).toBe(false);
  });
});

describe("detectAdmission", () => {
  test("detects success admission: task completed", () => {
    const result = detectAdmission(
      "The task completed successfully. All steps are done.",
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("success");
    expect(result!.match).toContain("task completed");
  });

  test("detects success admission: code accepted", () => {
    const result = detectAdmission(
      "I can see that the code accepted by the system.",
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("success");
  });

  test("detects success admission: has been submitted", () => {
    const result = detectAdmission("The form has been submitted successfully.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("success");
  });

  test("detects failure admission: I'm unable to find", () => {
    const result = detectAdmission(
      "I'm unable to find the element on the page.",
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe("failure");
  });

  test("detects failure admission: I cannot locate", () => {
    const result = detectAdmission("I cannot locate the submit button.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("failure");
  });

  test("detects failure admission: I've exhausted all", () => {
    const result = detectAdmission("I've exhausted all possible approaches.");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("failure");
  });

  test("returns null for normal reasoning text", () => {
    const result = detectAdmission(
      "I need to click the submit button and then verify the form was sent.",
    );
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = detectAdmission("");
    expect(result).toBeNull();
  });

  test("returns null for tool-planning text", () => {
    const result = detectAdmission(
      "Next I will scroll down and look for the checkout form.",
    );
    expect(result).toBeNull();
  });
});
