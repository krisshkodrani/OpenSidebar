/**
 * Legacy → trusted-corpus migration transforms (RFC LP-15, Phase 9).
 *
 * Pure functions that map a legacy store's records onto TrustedCorpusEntry
 * upserts. The migration is lazy + reversible: the legacy keys stay (dual-read
 * for one release) and these transforms are idempotent (upsert dedups by
 * kind+scope+claimKey), so running them repeatedly re-syncs rather than
 * duplicates.
 *
 * Encryption stays in personal-profile's CEK code: the caller passes whether a
 * profile fact's value is already ciphertext (`isEncryptedValue`) and this
 * carries it opaquely with `encrypted` set — the corpus never sees the CEK.
 */

import type { AnalyzerMetadata, DigestItem } from "../../utils/personal-profile";
import { isEncryptedValue } from "../../utils/profile-crypto";
import type { UserWebsiteSkill } from "../../types";
import type {
  TrustedCorpusProvenance,
  TrustedCorpusStore,
  TrustedCorpusUpsert,
} from "./trusted-corpus";

/**
 * A personal-profile digest item → a global personal_profile_fact entry. The
 * digest item id (`kind:slug(label):hash`) is already a stable dedup key, so it
 * becomes the claimKey. `encrypted` is the caller's `isEncryptedValue(value)`.
 */
export function personalProfileFactToCorpusEntry(
  item: DigestItem,
  provenance: TrustedCorpusProvenance,
  encrypted: boolean,
): TrustedCorpusUpsert {
  return {
    kind: "personal_profile_fact",
    claimKey: item.id,
    scope: {},
    value: item.value,
    encrypted,
    provenance: item.sourceQuote
      ? { ...provenance, sourceQuote: item.sourceQuote }
      : provenance,
    confidence: item.confidence,
  };
}

/**
 * A recorded website skill → a site-scoped website_skill entry. The whole skill
 * object is the value (not encrypted — values are redacted at capture time);
 * scope carries its origin + path pattern for site matching.
 */
export function websiteSkillToCorpusEntry(
  skill: UserWebsiteSkill,
): TrustedCorpusUpsert {
  return {
    kind: "website_skill",
    claimKey: skill.id,
    scope: { origin: skill.origin, pathPattern: skill.pathPattern },
    value: skill,
    encrypted: false,
    provenance: {
      source: "observation",
      capturedAt: skill.createdAt ?? 0,
    },
    confidence: "medium",
  };
}

/**
 * Populate the corpus from the legacy stores (RFC LP-15, Phase 9). Idempotent —
 * upsert dedups by identity, so this is the lazy/reversible re-sync run on first
 * query (the legacy keys stay for one release). Profile facts carry the raw
 * (possibly ciphertext) values: `encrypted` is detected per item via
 * `isEncryptedValue`, so sensitive values stay CEK-wrapped in the corpus.
 * Returns how many entries of each kind were written.
 */
export async function migrateLegacyStoresIntoCorpus(
  corpus: TrustedCorpusStore,
  legacy: {
    profileFacts: DigestItem[];
    analyzer: AnalyzerMetadata | null;
    skills: UserWebsiteSkill[];
    now?: () => number;
  },
): Promise<{ profileFacts: number; skills: number }> {
  const at = legacy.now?.() ?? Date.now();
  const profileProvenance: TrustedCorpusProvenance = {
    source: "analyzer",
    provider: legacy.analyzer?.provider,
    model: legacy.analyzer?.model,
    capturedAt: legacy.analyzer?.analyzedAt ?? at,
  };

  let profileFacts = 0;
  for (const item of legacy.profileFacts) {
    await corpus.upsert(
      personalProfileFactToCorpusEntry(
        item,
        profileProvenance,
        isEncryptedValue(item.value),
      ),
    );
    profileFacts++;
  }

  let skills = 0;
  for (const skill of legacy.skills) {
    await corpus.upsert(websiteSkillToCorpusEntry(skill));
    skills++;
  }

  return { profileFacts, skills };
}
