import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";

// Spy on the legacy loaders so we can assert the once-guard without needing the
// chrome-backed store to actually persist (the global mock is a noop store).
const loadRawProfileDigestItems = vi.fn(async () => ({ items: [], analyzer: null }));
const loadUserWebsiteSkills = vi.fn(async (): Promise<unknown[]> => []);

vi.mock("../../src/utils/personal-profile", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadRawProfileDigestItems,
}));
vi.mock("../../src/utils/website-skills", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserWebsiteSkills,
}));

async function freshRuntime() {
  vi.resetModules();
  return import("../../src/background/memory/corpus-runtime");
}

describe("corpus-runtime lazy migration", () => {
  beforeEach(() => {
    loadRawProfileDigestItems.mockClear();
    loadUserWebsiteSkills.mockClear();
  });

  test("ensureLegacyStoresMigrated runs the migration once per lifetime", async () => {
    const rt = await freshRuntime();
    await Promise.all([
      rt.ensureLegacyStoresMigrated(),
      rt.ensureLegacyStoresMigrated(),
    ]);
    await rt.ensureLegacyStoresMigrated();
    expect(loadRawProfileDigestItems).toHaveBeenCalledTimes(1);
    expect(loadUserWebsiteSkills).toHaveBeenCalledTimes(1);
  });

  test("resyncLegacyStoresIntoCorpus re-runs the migration", async () => {
    const rt = await freshRuntime();
    await rt.ensureLegacyStoresMigrated();
    await rt.resyncLegacyStoresIntoCorpus();
    expect(loadRawProfileDigestItems).toHaveBeenCalledTimes(2);
  });

  test("getTrustedCorpusStore returns a stable singleton", async () => {
    const rt = await freshRuntime();
    expect(rt.getTrustedCorpusStore()).toBe(rt.getTrustedCorpusStore());
  });

  test("loadWebsiteSkillsPreferringCorpus falls back to legacy when the corpus is empty", async () => {
    const legacy = [{ id: "skill-legacy" }];
    loadUserWebsiteSkills.mockResolvedValue(legacy as unknown[]);
    const rt = await freshRuntime();
    // corpus store is a noop mock (empty) → the authoritative legacy read wins.
    expect(await rt.loadWebsiteSkillsPreferringCorpus()).toEqual(legacy);
  });

  test("startCorpusLegacySync re-syncs only on a legacy-store change", async () => {
    // Inject a chrome.storage.onChanged the global mock lacks.
    let captured: ((changes: Record<string, unknown>, area: string) => void) | null =
      null;
    (chrome.storage as unknown as { onChanged: unknown }).onChanged = {
      addListener: (fn: typeof captured) => {
        captured = fn;
      },
      removeListener: () => {},
    };
    const rt = await freshRuntime();
    await rt.ensureLegacyStoresMigrated();
    loadRawProfileDigestItems.mockClear();

    rt.startCorpusLegacySync();
    // an unrelated key change does not trigger a re-sync
    captured?.({ "opensidebar:somethingElse": {} }, "local");
    await Promise.resolve();
    expect(loadRawProfileDigestItems).toHaveBeenCalledTimes(0);

    // a profile-store change re-runs the reconciling migration
    captured?.({ "opensidebar:personalProfile": {} }, "local");
    await Promise.resolve();
    await Promise.resolve();
    expect(loadRawProfileDigestItems).toHaveBeenCalledTimes(1);
  });
});
