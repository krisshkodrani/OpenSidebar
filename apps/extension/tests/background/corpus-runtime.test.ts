import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";

// Spy on the legacy loaders so we can assert the once-guard without needing the
// chrome-backed store to actually persist (the global mock is a noop store).
const loadRawProfileDigestItems = vi.fn(async () => ({ items: [], analyzer: null }));
const loadUserWebsiteSkills = vi.fn(async () => []);

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
});
