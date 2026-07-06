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
import { isUserWebsiteSkill } from "../../utils/website-skills";
import type { UserWebsiteSkill } from "../../types";
import type {
  TrustedCorpusEntry,
  TrustedCorpusProvenance,
  TrustedCorpusStore,
  TrustedCorpusUpsert,
} from "./trusted-corpus";

/**
 * A personal-profile digest item → a global personal_profile_fact entry. The
 * digest item id (`kind:slug(label):hash`) is already a stable dedup key, so it
 * becomes the claimKey. The whole `DigestItem` is the value (a lossless
 * round-trip for consumers that need label/kind/confidence, mirroring how a
 * website skill carries its whole object), so `encrypted` describes the item's
 * `sensitive`-kind ciphertext fields — which stay opaque, CEK-wrapped. The
 * ciphertext already lives inside `value`, so we do not duplicate `sourceQuote`
 * into provenance.
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
    value: item,
    encrypted,
    provenance,
    confidence: item.confidence,
  };
}

/**
 * Reverse of {@link personalProfileFactToCorpusEntry}: recover the DigestItem a
 * personal_profile_fact entry carries. Returns null for a malformed value.
 * Sensitive-kind values stay ciphertext (decryption stays in the CEK code), so
 * this is for structural reads, not for prompt injection of sensitive fields.
 */
export function corpusEntryToProfileDigestItem(
  entry: TrustedCorpusEntry,
): DigestItem | null {
  const value = entry.value as Partial<DigestItem> | null | undefined;
  if (
    !value ||
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    typeof value.value !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.confidence !== "string"
  ) {
    return null;
  }
  return value as DigestItem;
}

/**
 * Reverse of {@link websiteSkillToCorpusEntry}: recover the UserWebsiteSkill a
 * website_skill entry carries (validated through the shared type guard).
 * Returns null for a malformed value.
 */
export function corpusEntryToWebsiteSkill(
  entry: TrustedCorpusEntry,
): UserWebsiteSkill | null {
  return isUserWebsiteSkill(entry.value) ? entry.value : null;
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
