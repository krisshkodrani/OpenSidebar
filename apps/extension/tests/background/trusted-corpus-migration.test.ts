import { describe, expect, test } from "vitest";
import "../setup";
import {
  corpusEntryToProfileDigestItem,
  corpusEntryToWebsiteSkill,
  extractedFactToCorpusEntry,
  migrateLegacyStoresIntoCorpus,
  personalProfileFactToCorpusEntry,
  websiteSkillToCorpusEntry,
} from "../../src/background/memory/trusted-corpus-migration";
import type { TrustedCorpusEntry } from "../../src/background/memory/trusted-corpus";
import { createTrustedCorpusStoreOnArea } from "../../src/background/memory/trusted-corpus";
import { createFakeStorageArea } from "../fakes/persistence";
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
      value: item, // whole digest item, lossless round-trip
      encrypted: false,
      confidence: "high",
      provenance: { source: "analyzer", provider: "fireworks", model: "glm-5p2" },
    });
    // reverse transform recovers the item
    const recovered = corpusEntryToProfileDigestItem({
      ...entry,
      id: "id-1",
      version: 1,
      createdAt: 0,
      updatedAt: 0,
    } as TrustedCorpusEntry);
    expect(recovered).toEqual(item);
  });

  test("sensitive fact keeps its ciphertext opaque with encrypted=true", () => {
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
    // ciphertext stays opaque inside the carried item; provenance never
    // duplicates the sensitive sourceQuote.
    expect((entry.value as DigestItem).value).toBe("enc:v1:aXY=.Y2lwaGVy");
    expect((entry.value as DigestItem).sourceQuote).toBe("enc:v1:cXE=.cXVvdGU=");
    expect(entry.provenance.sourceQuote).toBeUndefined();
  });

  test("extracted fact → task-scoped extracted_fact entry with provenance", () => {
    const entry = extractedFactToCorpusEntry({
      taskId: "task-7",
      nodeId: "node-3",
      summary: "The invoice total is $412.00",
      capturedAt: 99,
    });
    expect(entry).toMatchObject({
      kind: "extracted_fact",
      claimKey: "task-7:node-3", // pinned to (task, node) so re-record re-syncs
      scope: {},
      value: "The invoice total is $412.00",
      encrypted: false,
      confidence: "medium",
      provenance: { source: "observation", taskId: "task-7", nodeId: "node-3", capturedAt: 99 },
    });
  });

  test("corpusEntryToWebsiteSkill recovers a skill / rejects a malformed value", () => {
    const skill = {
      id: "skill-9",
      name: "S",
      origin: "https://x.test",
      pathPattern: "/*",
      triggerPhrase: "t",
      workflowSteps: [],
      guardrails: [],
      requiredEvidence: [],
      privacySummary: "",
      capturedEventCount: 0,
      capturedInputCount: 0,
      createdAt: 1,
      updatedAt: 1,
      enabled: true,
    } as UserWebsiteSkill;
    const good = websiteSkillToCorpusEntry(skill);
    expect(
      corpusEntryToWebsiteSkill({ ...good, id: "id", version: 1, createdAt: 0, updatedAt: 0 } as TrustedCorpusEntry),
    ).toEqual(skill);
    expect(
      corpusEntryToWebsiteSkill({
        kind: "website_skill",
        value: { nope: true },
      } as unknown as TrustedCorpusEntry),
    ).toBeNull();
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

describe("migrateLegacyStoresIntoCorpus", () => {
  function makeCorpus() {
    const area = createFakeStorageArea();
    let n = 0;
    return createTrustedCorpusStoreOnArea(area, {
      now: () => 1,
      newId: () => `id-${++n}`,
    });
  }

  const items: DigestItem[] = [
    { id: "fact:name:1", label: "Name", value: "Sam", kind: "fact", confidence: "high" },
    {
      id: "sensitive:ssn:2",
      label: "SSN",
      value: "enc:v1:aXY=.Y2lwaGVy",
      kind: "sensitive",
      confidence: "high",
    },
  ];
  const skills = [
    {
      id: "skill-1",
      name: "S",
      origin: "https://x.test",
      pathPattern: "/*",
      triggerPhrase: "t",
      workflowSteps: [],
      guardrails: [],
      requiredEvidence: [],
      privacySummary: "",
      capturedEventCount: 0,
      capturedInputCount: 0,
      createdAt: 1,
      updatedAt: 1,
      enabled: true,
    } as UserWebsiteSkill,
  ];

  test("populates the corpus, detecting encryption per profile item", async () => {
    const corpus = makeCorpus();
    const counts = await migrateLegacyStoresIntoCorpus(corpus, {
      profileFacts: items,
      analyzer: { provider: "fireworks", model: "glm-5p2", analyzerVersion: "1", analyzedAt: 9 },
      skills,
      now: () => 1,
    });
    expect(counts).toEqual({ profileFacts: 2, skills: 1 });

    const all = await corpus.load();
    expect(all).toHaveLength(3);
    const ssn = all.find((e) => e.claimKey === "sensitive:ssn:2")!;
    expect(ssn.encrypted).toBe(true); // ciphertext detected
    expect(ssn.provenance).toMatchObject({ source: "analyzer", provider: "fireworks", model: "glm-5p2" });
    const name = all.find((e) => e.claimKey === "fact:name:1")!;
    expect(name.encrypted).toBe(false);
    expect(all.find((e) => e.kind === "website_skill")!.scope.origin).toBe("https://x.test");
  });

  test("is idempotent — a second run re-syncs, not duplicates", async () => {
    const corpus = makeCorpus();
    const legacy = {
      profileFacts: items,
      analyzer: null,
      skills,
      now: () => 1,
    };
    await migrateLegacyStoresIntoCorpus(corpus, legacy);
    await migrateLegacyStoresIntoCorpus(corpus, legacy);
    expect(await corpus.load()).toHaveLength(3); // not 6
  });
});
