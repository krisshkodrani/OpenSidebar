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

import type { DigestItem } from "../../utils/personal-profile";
import type { UserWebsiteSkill } from "../../types";
import type {
  TrustedCorpusProvenance,
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
