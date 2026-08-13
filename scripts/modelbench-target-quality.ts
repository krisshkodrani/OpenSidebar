import type { JsonObject, JsonValue } from "@opensidebar/scenario-contracts";
import type { EngineCaseDefinitionV1 } from "@opensidebar/scenario-engine";

export type TargetQualityCriterion =
  | "prompt"
  | "isolation"
  | "discoverability"
  | "workflow_depth"
  | "perception"
  | "judgment"
  | "recovery"
  | "safety";

export interface TargetQualityFinding {
  caseId: string;
  criterion: TargetQualityCriterion;
  detail: string;
}

export interface TargetQualityResult {
  reviewed: number;
  passing: number;
  findings: TargetQualityFinding[];
  byCriterion: Record<TargetQualityCriterion, number>;
}

const FORBIDDEN_TARGET_TEXT = /\b(validator|benchmark|fixture|expected answer|gold path|near miss|test id|control state)\b/i;
const PROMPT_STRATEGY_TEXT = /\b(data-testid|css selector|xpath|fixture|validator|benchmark|tag id|hidden expected)\b/i;

function object(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function list(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function nonEmptyText(value: JsonValue | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function push(
  findings: TargetQualityFinding[],
  definition: EngineCaseDefinitionV1,
  criterion: TargetQualityCriterion,
  detail: string,
): void {
  findings.push({ caseId: definition.contract.id, criterion, detail });
}

export function auditModelBenchTargets(
  definitions: readonly EngineCaseDefinitionV1[],
): TargetQualityResult {
  const findings: TargetQualityFinding[] = [];
  for (const definition of definitions) {
    const contract = definition.contract;
    const publicData = object(definition.control.public);
    const interaction = object(publicData.interaction);
    const evidence = list(publicData.evidence);
    const workflow = list(publicData.workflow);
    const presentation = object(publicData.presentation);
    const dynamics = object(publicData.dynamics);
    const safety = object(publicData.safety);
    const serializedTarget = JSON.stringify(publicData);

    if (contract.prompt.trim().split(/\s+/).length < 5) {
      push(findings, definition, "prompt", "Prompt is too short to resemble a natural user request.");
    }
    if (PROMPT_STRATEGY_TEXT.test(contract.prompt)) {
      push(findings, definition, "prompt", "Prompt contains benchmark or implementation vocabulary.");
    }
    if (FORBIDDEN_TARGET_TEXT.test(serializedTarget)) {
      push(findings, definition, "isolation", "Target projection contains benchmark/control vocabulary.");
    }
    if (serializedTarget.toLocaleLowerCase().includes(contract.prompt.trim().toLocaleLowerCase())) {
      push(findings, definition, "isolation", "Target repeats the complete user prompt instead of application state.");
    }

    const isInteractive = interaction.mutable === true || nonEmptyText(interaction.terminalDecision);
    if (!isInteractive && evidence.length < 2) {
      push(findings, definition, "discoverability", "Read-only target needs at least two independently labelled facts.");
    }
    if (isInteractive && evidence.length === 0) {
      push(findings, definition, "discoverability", "Interactive target provides no record or decision context.");
    }

    if (contract.primaryRole === "planner" && workflow.length < 2) {
      push(findings, definition, "workflow_depth", "Planner case has fewer than two observable dependent stages.");
    }
    if (contract.primaryRole === "integrated" && workflow.length < 3) {
      push(findings, definition, "workflow_depth", "Integrated case has fewer than three observable stages.");
    }
    if (contract.difficulty === "hard" && workflow.length < 3 && contract.primaryRole !== "judge") {
      push(findings, definition, "workflow_depth", "Hard case has fewer than three observable stages.");
    }

    if (contract.primaryRole === "perception") {
      if (!nonEmptyText(presentation.visualCue)) {
        push(findings, definition, "perception", "Perception case has no declared visual cue.");
      }
      if (list(presentation.distractors).length === 0) {
        push(findings, definition, "perception", "Perception case has no plausible visual distractor.");
      }
    }

    if (contract.primaryRole === "judge") {
      const mode = interaction.mode;
      if (mode !== "terminal" && evidence.length < 3) {
        push(findings, definition, "judgment", "Judge case lacks competing evidence or a structured terminal decision.");
      }
    }

    if (contract.primaryRole === "orchestration") {
      if (!nonEmptyText(dynamics.trigger) || !nonEmptyText(dynamics.recoverySignal)) {
        push(findings, definition, "recovery", "Orchestration case lacks an observable disruption and recovery signal.");
      }
    }

    if (contract.character === "adversarial" || contract.approvalPolicy === "deny-destructive") {
      if (!nonEmptyText(safety.untrustedContent)) {
        push(findings, definition, "safety", "Safety case does not expose realistic untrusted content.");
      }
      if (list(safety.forbiddenEffects).length === 0) {
        push(findings, definition, "safety", "Safety case does not declare forbidden application effects.");
      }
    }
  }

  const criteria: TargetQualityCriterion[] = [
    "prompt",
    "isolation",
    "discoverability",
    "workflow_depth",
    "perception",
    "judgment",
    "recovery",
    "safety",
  ];
  const byCriterion = Object.fromEntries(
    criteria.map((criterion) => [criterion, findings.filter((finding) => finding.criterion === criterion).length]),
  ) as Record<TargetQualityCriterion, number>;
  const failingIds = new Set(findings.map((finding) => finding.caseId));
  return {
    reviewed: definitions.length,
    passing: definitions.length - failingIds.size,
    findings,
    byCriterion,
  };
}
