/**
 * Trusted-corpus runtime binding (RFC LP-15, Phase 9).
 *
 * The single production `TrustedCorpusStore` instance (bound to the shared
 * `chromePersistencePort`) plus the lazy, idempotent shadow migration that
 * populates it from the three legacy stores. This release the corpus is written
 * (shadow) and read only where the round-trip is lossless and boundary-safe
 * (website skills); profile facts and extracted facts keep their legacy read
 * paths for one release — the corpus carries them with provenance so the reads
 * can flip next release. Legacy keys are never removed here.
 */

import { chromePersistencePort } from "../environment/chrome";
import {
  loadRawProfileDigestItems,
  type DigestItem,
} from "../../utils/personal-profile";
import { loadUserWebsiteSkills } from "../../utils/website-skills";
import {
  createTrustedCorpusStore,
  type TrustedCorpusStore,
} from "./trusted-corpus";
import { migrateLegacyStoresIntoCorpus } from "./trusted-corpus-migration";

let corpusStore: TrustedCorpusStore | null = null;

/** The shared production corpus store (lazily constructed, chrome-backed). */
export function getTrustedCorpusStore(): TrustedCorpusStore {
  if (!corpusStore) {
    corpusStore = createTrustedCorpusStore(chromePersistencePort);
  }
  return corpusStore;
}

let migrationPromise: Promise<void> | null = null;

/**
 * Populate the corpus from the legacy stores, once per service-worker lifetime.
 * Idempotent (upsert dedups by identity), best-effort, and non-blocking for
 * callers — a failure logs nothing user-facing and leaves the legacy read paths
 * authoritative. Safe to call eagerly at startup and again on legacy-store
 * changes (the onChanged re-sync).
 */
export function ensureLegacyStoresMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runLegacyMigration().catch(() => {
      // Best-effort: reset so a later trigger (onChanged) can retry.
      migrationPromise = null;
    });
  }
  return migrationPromise;
}

/** Re-run the migration now (used by the onChanged re-sync), ignoring the once-guard. */
export async function resyncLegacyStoresIntoCorpus(): Promise<void> {
  migrationPromise = runLegacyMigration();
  await migrationPromise;
}

async function runLegacyMigration(): Promise<void> {
  const [{ items, analyzer }, skills] = await Promise.all([
    loadRawProfileDigestItems(chromePersistencePort),
    loadUserWebsiteSkills(),
  ]);
  const profileFacts: DigestItem[] = items;
  await migrateLegacyStoresIntoCorpus(getTrustedCorpusStore(), {
    profileFacts,
    analyzer,
    skills,
  });
}
