import { describe, expect, test } from "vitest";
import {
  runEntailmentGate,
  significantTokens,
  type CorpusFactRef,
} from "../../src/background/agent/completion/entailment-gate";

const facts: CorpusFactRef[] = [
  {
    claimKey: "fact:full-name:abc",
    text: "Full name Sam Rivera",
    encrypted: false,
  },
  {
    claimKey: "fact:primary-email:def",
    text: "Primary email sam.rivera@example.com",
    encrypted: false,
  },
  {
    claimKey: "sensitive:ssn:ghi",
    text: "", // encrypted — no lexical signal
    encrypted: true,
  },
];

describe("significantTokens", () => {
  test("drops stopwords and short tokens, lowercases", () => {
    expect([...significantTokens("The user's Full Name is Sam")]).toEqual([
      "full",
      "name",
      "sam",
    ]);
  });
});

describe("runEntailmentGate", () => {
  test("resolves a claim a corpus fact entails", () => {
    const result = runEntailmentGate(["full name Sam Rivera"], facts);
    expect(result.entailed).toHaveLength(1);
    expect(result.entailed[0]).toMatchObject({
      label: "entailed",
      matchedClaimKey: "fact:full-name:abc",
    });
    expect(result.entailed[0].score).toBeGreaterThanOrEqual(0.6);
    expect(result.unresolved).toEqual([]);
  });

  test("sends an unsupported claim to the judge (unresolved)", () => {
    const result = runEntailmentGate(
      ["preferred pronoun disclosed on the form"],
      facts,
    );
    expect(result.entailed).toEqual([]);
    expect(result.unresolved).toEqual([
      "preferred pronoun disclosed on the form",
    ]);
  });

  test("never entails from an encrypted fact (opaque ciphertext)", () => {
    // Even a claim whose words match the ssn claimKey cannot be resolved,
    // because the encrypted fact carries no lexical text.
    const result = runEntailmentGate(["ssn social security number"], facts);
    expect(result.entailed).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
  });

  test("a too-short claim is left unresolved (not force-matched)", () => {
    const result = runEntailmentGate(["email"], facts, { minClaimTokens: 2 });
    expect(result.entailed).toEqual([]);
    expect(result.unresolved).toEqual(["email"]);
  });

  test("picks the highest-coverage fact when several partially match", () => {
    const result = runEntailmentGate(["primary email address sam rivera"], [
      { claimKey: "k1", text: "primary email sam", encrypted: false },
      { claimKey: "k2", text: "primary email address sam rivera example", encrypted: false },
    ]);
    expect(result.entailed[0].matchedClaimKey).toBe("k2");
  });

  test("respects a custom coverage threshold", () => {
    const claim = ["relocation authorized to work"];
    const partial: CorpusFactRef[] = [
      { claimKey: "k", text: "relocation authorized", encrypted: false },
    ];
    // 2/3 covered → below 0.9, above 0.5
    expect(runEntailmentGate(claim, partial, { minCoverage: 0.9 }).entailed).toEqual([]);
    expect(runEntailmentGate(claim, partial, { minCoverage: 0.5 }).entailed).toHaveLength(1);
  });
});
