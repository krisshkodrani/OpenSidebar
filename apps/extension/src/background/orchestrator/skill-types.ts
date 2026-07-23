/**
 * Skill type vocabulary (RFC LP-16 — skills.ts landmine decomposition).
 *
 * The skill descriptor / pack / matcher / contract interfaces, extracted
 * verbatim from skills.ts so the catalog + body data modules (and skills.ts
 * itself) can share them without an import cycle. skills.ts re-exports these,
 * so the public `./skills` type surface is unchanged.
 */

import type { ToolName } from "../../types";
import type { EvidenceEventType } from "../../types";

export type SkillCapability =
  | "read_context"
  | "compose_response"
  | "submit_response"
  | "verify_posted"
  | "update_record"
  | "add_note"
  | "verify_saved";

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  tags: string[];
  triggers: string[];
  maturity: "draft" | "candidate" | "active";
  preferredTools?: string[];
  discouragedTools?: string[];
  capabilityNeeds?: SkillCapability[];
  contextScope?: "turn" | "workspace";
  verifierMode: "deterministic" | "hybrid" | "llm";
  atomic?: boolean;
  requiredEvidenceTypes?: EvidenceEventType[];
  notes?: string[];
  packId?: string;
}

export type SkillPackType = "core" | "enterprise" | "platform";

export interface SkillPack {
  id: string;
  name: string;
  description: string;
  type: SkillPackType;
  enabledByDefault: boolean;
  skillIds: string[];
}

export interface SkillCatalogOptions {
  enabledSkillPackIds?: readonly string[];
  candidateSkillIds?: readonly string[];
  /**
   * Skill ids excluded from selection — the ablation switch (2026-07-23 skills
   * audit, Finding 5). Merged with the module-level set from user settings.
   * Selection-time only: an already-selected skill keeps its loaded contract
   * so a mid-run settings change cannot strand a running node.
   */
  disabledSkillIds?: readonly string[];
}

export interface SkillToolPolicy {
  preferredTools: ToolName[];
  discouragedTools: ToolName[];
}

export interface SkillToolSuppressionPolicy {
  temporarilySuppressedTools: ToolName[];
  exemptTools: ToolName[];
}

export interface SkillSelection {
  id: string;
  reason: string;
}

export interface SkillMatcherInput {
  query?: string;
  objective: string;
  successCriteria?: string;
  pageTitle?: string;
  pageUrl?: string;
  pageMarkers?: readonly string[];
  runtimeContext?: readonly string[];
  enabledSkillPackIds?: readonly string[];
  candidateSkillIds?: readonly string[];
  /** Skill ids excluded from selection (see SkillCatalogOptions). */
  disabledSkillIds?: readonly string[];
}

export type SkillActivationSignalStrength = "always" | "weak" | "strong";

export interface SkillCandidateDescriptor {
  skill: SkillDescriptor;
  packId?: string;
  activationReason: string;
  signalStrength: SkillActivationSignalStrength;
}

export interface SkillMatcher {
  match(input: SkillMatcherInput): SkillSelection | null;
}

export interface SkillExecutionContract {
  sequencing?: string[];
  toolDiscipline?: string[];
  completionChecks?: string[];
  failureRecovery?: string[];
}

export interface LoadedSkillContract extends SkillDescriptor {
  procedureMarkdown: string;
  requiredEvidence?: string[];
  commonFailures?: Array<{
    signal: string;
    recovery: string;
  }>;
  executionContract?: SkillExecutionContract;
}
