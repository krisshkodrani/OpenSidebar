import { describe, expect, test } from "vitest";
import "../setup";
import {
  personalProfileFactToCorpusEntry,
  websiteSkillToCorpusEntry,
} from "../../src/background/memory/trusted-corpus-migration";
import type { DigestItem } from "../../src/utils/personal-profile";
import type { UserWebsiteSkill } from "../../src/types";

describe("trusted-corpus migration transforms", () => {
  test("personal-profile fact → global personal_profile_fact entry (plaintext)", () => {
    const item: DigestItem = {
      id: "fact:full-name:abc",
      label: "Full name",
      value: "Sam Rivera",
      kind: "fact",
      confidence: "high",
    };
    const entry = personalProfileFactToCorpusEntry(
      item,
      { source: "analyzer", capturedAt: 5, provider: "fireworks", model: "glm-5p2" },
      false,
    );
    expect(entry).toMatchObject({
      kind: "personal_profile_fact",
      claimKey: "fact:full-name:abc",
      scope: {},
      value: "Sam Rivera",
      encrypted: false,
      confidence: "high",
      provenance: { source: "analyzer", provider: "fireworks", model: "glm-5p2" },
    });
  });

  test("sensitive fact keeps its ciphertext opaque with encrypted=true + sourceQuote", () => {
    const item: DigestItem = {
      id: "sensitive:ssn:xyz",
      label: "SSN",
      value: "enc:v1:aXY=.Y2lwaGVy",
      kind: "sensitive",
      confidence: "high",
      sourceQuote: "enc:v1:cXE=.cXVvdGU=",
    };
    const entry = personalProfileFactToCorpusEntry(
      item,
      { source: "user_input", capturedAt: 5 },
      true,
    );
    expect(entry.encrypted).toBe(true);
    expect(entry.value).toBe("enc:v1:aXY=.Y2lwaGVy"); // unchanged ciphertext
    expect(entry.provenance.sourceQuote).toBe("enc:v1:cXE=.cXVvdGU=");
  });

  test("website skill → site-scoped website_skill entry", () => {
    const skill = {
      id: "skill-123",
      name: "Checkout flow",
      origin: "https://shop.test",
      pathPattern: "/checkout/*",
      triggerPhrase: "buy",
      workflowSteps: [],
      guardrails: [],
      requiredEvidence: [],
      privacySummary: "",
      capturedEventCount: 3,
      capturedInputCount: 1,
      createdAt: 42,
      updatedAt: 43,
      enabled: true,
    } as UserWebsiteSkill;
    const entry = websiteSkillToCorpusEntry(skill);
    expect(entry).toMatchObject({
      kind: "website_skill",
      claimKey: "skill-123",
      scope: { origin: "https://shop.test", pathPattern: "/checkout/*" },
      encrypted: false,
      confidence: "medium",
      provenance: { source: "observation", capturedAt: 42 },
    });
    expect(entry.value).toBe(skill);
  });
});
