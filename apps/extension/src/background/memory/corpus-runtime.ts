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
  PERSONAL_PROFILE_STORAGE_KEY,
  type DigestItem,
} from "../../utils/personal-profile";
import {
  loadUserWebsiteSkills,
  WEBSITE_SKILLS_STORAGE_KEY,
} from "../../utils/website-skills";
import type { UserWebsiteSkill } from "../../types";
import {
  createTrustedCorpusStore,
  type TrustedCorpusStore,
} from "./trusted-corpus";
import {
  corpusEntryToWebsiteSkill,
  migrateLegacyStoresIntoCorpus,
} from "./trusted-corpus-migration";

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

/**
 * Keep the corpus in sync with sidepanel edits to the legacy stores (RFC LP-15
 * Phase 9). The profile/skills write paths are unchanged; when they mutate their
 * legacy key we re-run the reconciling migration so the corpus mirror tracks
 * adds, updates, and deletes. Returns an unsubscribe. Idempotent registration is
 * the caller's responsibility (call once at startup).
 */
export function startCorpusLegacySync(): () => void {
  return chromePersistencePort.local.onChanged((changes) => {
    if (
      PERSONAL_PROFILE_STORAGE_KEY in changes ||
      WEBSITE_SKILLS_STORAGE_KEY in changes
    ) {
      void resyncLegacyStoresIntoCorpus().catch(() => {});
    }
  });
}

/**
 * The website skills to match a task against, preferring the trusted corpus
 * (RFC LP-15 Phase 9). Awaits the shadow migration so the corpus mirror is
 * current, then reads it; an empty corpus (fresh install, or an over-pruned
 * transient) falls back to the authoritative legacy read. Behaviour matches the
 * legacy read because the reconciling migration keeps the corpus an exact,
 * same-order mirror of the legacy skills.
 */
export async function loadWebsiteSkillsPreferringCorpus(): Promise<
  UserWebsiteSkill[]
> {
  await ensureLegacyStoresMigrated();
  const corpusSkills = (await getTrustedCorpusStore().listByKind("website_skill"))
    .map(corpusEntryToWebsiteSkill)
    .filter((skill): skill is UserWebsiteSkill => skill !== null);
  return corpusSkills.length > 0 ? corpusSkills : loadUserWebsiteSkills();
}
