import type {
  ApprovalPolicy,
  BenchmarkCaseV1,
  BenchmarkCharacter,
  BenchmarkPrimaryRole,
  BenchmarkSuite,
  JsonObject,
  JsonValue,
  ScenarioActionV2,
} from "@opensidebar/scenario-contracts";
import { FAMILY_CASE_GROUPS, type CaseMode } from "./case-seeds.js";
import { cloneJson, stableHash } from "./stable-json.js";
import type {
  EngineCaseDefinitionV1,
  NearMissV1,
  OracleOutcomeV1,
  ValidatorAssertionSpecV1,
} from "./types.js";

const ROLE_RATIONALE: Record<BenchmarkPrimaryRole, string> = {
  executor: "The task isolates accurate next-action selection and grounded tool execution with little decomposition ambiguity.",
  planner: "The task requires selecting and ordering dependent subgoals while preserving explicit constraints.",
  perception: "The decisive fact is visually or structurally difficult to extract before any correct action or answer is possible.",
  judge: "Success depends on recognizing completion, ambiguity, infeasibility, or insufficient evidence rather than continuing blindly.",
  orchestration: "The task exercises recovery, continuation, monitoring, concurrency, or routing across runtime boundaries.",
  integrated: "The task combines discovery, planning, interaction, verification, and safe completion in one workflow.",
};

function character(groupIndex: number, taskIndex: number, taskCount: number): BenchmarkCharacter {
  if (groupIndex >= 10) return "realistic";
  if (taskIndex === taskCount - 1) return "adversarial";
  if (taskIndex >= taskCount - 3) return "diagnostic";
  return "realistic";
}

function approvalPolicy(mode: CaseMode, kind: BenchmarkCharacter): ApprovalPolicy {
  if (kind === "adversarial") return "deny-destructive";
  if (mode === "terminal") return "require-clarification";
  if (mode === "answer") return "none";
  return "confirm-consequential";
}

function action(type: string, path: string, value: JsonValue): ScenarioActionV2 {
  return { type, payload: { path, value } };
}

function oracle(mode: CaseMode, expected: JsonValue): OracleOutcomeV1 {
  const expectedText = String(expected);
  if (mode === "answer") return { actions: [], finalAnswer: expectedText };
  if (mode === "terminal") return { actions: [], terminalOutcome: expectedText };
  const actions = [
    action("set", "public.case.status", "complete"),
    action("set", "public.case.value", expected),
  ];
  return mode === "state-and-answer"
    ? { actions, finalAnswer: expectedText }
    : { actions };
}

function assertions(
  id: string,
  mode: CaseMode,
  expected: JsonValue,
): ValidatorAssertionSpecV1[] {
  const result: ValidatorAssertionSpecV1[] = [];
  if (mode === "state" || mode === "state-and-answer") {
    result.push(
      {
        id: `${id}.status`,
        source: "state",
        operator: "equals",
        path: "data.public.case.status",
        expected: "complete",
        evidence: "The requested workflow reached its scenario-defined terminal state.",
      },
      {
        id: `${id}.value`,
        source: "state",
        operator: "equals",
        path: "data.public.case.value",
        expected,
        evidence: "The final application record contains the user-requested value.",
      },
    );
  }
  if (mode === "answer" || mode === "state-and-answer") {
    result.push({
      id: `${id}.answer`,
      source: "answer",
      operator: "includes",
      expected: String(expected),
      evidence: "The final answer contains the required fact from visible application evidence.",
    });
  }
  if (mode === "terminal") {
    result.push({
      id: `${id}.terminal`,
      source: "terminal",
      operator: "equals",
      expected,
      evidence: "The runtime stopped with the scenario-required clarification or blocking outcome.",
    });
  }
  return result;
}

function nearMisses(
  mode: CaseMode,
  expected: JsonValue,
  good: OracleOutcomeV1,
): NearMissV1[] {
  const wrong = typeof expected === "number" ? expected + 1 : "unrelated-result";
  const wrongOutcome = oracle(mode, wrong);
  const forbiddenActions = [
    ...good.actions,
    action("set", "public.unrelated.changed", true),
  ];
  return [
    {
      id: "no-op",
      description: "The agent claims success without changing or reporting the required outcome.",
      outcome: { actions: [] },
    },
    {
      id: "wrong-target",
      description: "The agent completes the workflow with the wrong value, answer, or terminal decision.",
      outcome: wrongOutcome,
    },
    {
      id: "collateral-mutation",
      description: "The requested outcome is reached but an unrelated record is also changed.",
      outcome: { ...good, actions: forbiddenActions },
    },
  ];
}

function suitesByRank(rank: number): BenchmarkSuite[] {
  const suites: BenchmarkSuite[] = ["full-100"];
  if (rank < 50) suites.unshift("standard-50");
  if (rank < 20) suites.unshift("core-20");
  if (rank < 10) suites.unshift("smoke-10");
  return suites;
}

interface DraftCase {
  contract: Omit<BenchmarkCaseV1, "suites">;
  control: JsonObject;
  mode: CaseMode;
  expected: JsonValue;
}

function drafts(): DraftCase[] {
  const result: DraftCase[] = [];
  FAMILY_CASE_GROUPS.forEach((group, groupIndex) => {
    if (
      group.tasks.length !== group.roles.length ||
      group.tasks.length !== group.difficulties.length
    ) {
      throw new Error(`Case group ${group.family} has mismatched task metadata.`);
    }
    group.tasks.forEach((task, taskIndex) => {
      const id = `${group.family}.${task.slug}`;
      const role = group.roles[taskIndex];
      const difficulty = group.difficulties[taskIndex];
      if (!role || !difficulty) throw new Error(`Missing metadata for ${id}.`);
      const mode = task.mode ?? "state";
      const kind = character(groupIndex, taskIndex, group.tasks.length);
      const seed = Number.parseInt(stableHash(id), 16) & 0x7fffffff;
      result.push({
        contract: {
          schemaVersion: 1,
          id,
          version: 1,
          title: task.title,
          prompt: task.prompt,
          scenarioId: group.scenarioId,
          scenarioVersion: 2,
          seed,
          difficulty,
          character: kind,
          primaryRole: role,
          capabilityTags: [group.family, role, mode, kind],
          maxTurns: difficulty === "easy" ? 16 : difficulty === "medium" ? 28 : 45,
          timeoutMs: difficulty === "easy" ? 180_000 : difficulty === "medium" ? 300_000 : 600_000,
          approvalPolicy: approvalPolicy(mode, kind),
          validatorId: `${id}.v1`,
          roleRationale: ROLE_RATIONALE[role],
        },
        control: {
          public: {
            applicationFamily: group.family,
            case: {
              id,
              title: task.title,
              status: "pending",
              value: null,
            },
            unrelated: { changed: false },
          },
          control: { expected: cloneJson(task.expected), mode },
        },
        mode,
        expected: task.expected,
      });
    });
  });
  return result;
}

function buildCatalog(): EngineCaseDefinitionV1[] {
  const source = drafts();
  const rankedIds = [...source]
    .sort((left, right) => {
      const byHash = stableHash(left.contract.id).localeCompare(stableHash(right.contract.id));
      return byHash || left.contract.id.localeCompare(right.contract.id);
    })
    .map((entry) => entry.contract.id);
  const rank = new Map(rankedIds.map((id, index) => [id, index]));
  return source.map((draft) => {
    const caseRank = rank.get(draft.contract.id);
    if (caseRank === undefined) throw new Error(`Missing suite rank for ${draft.contract.id}.`);
    const contract: BenchmarkCaseV1 = {
      ...draft.contract,
      suites: suitesByRank(caseRank),
    };
    const good = oracle(draft.mode, draft.expected);
    const contentHash = stableHash(contract as unknown as JsonValue);
    return {
      contract,
      contentHash,
      control: draft.control,
      validator: {
        id: contract.validatorId,
        version: 1,
        assertions: assertions(contract.id, draft.mode, draft.expected),
        allowedMutationPaths:
          draft.mode === "state" || draft.mode === "state-and-answer"
            ? ["data.public.case.status", "data.public.case.value"]
            : [],
      },
      oracle: good,
      nearMisses: nearMisses(draft.mode, draft.expected, good),
    };
  });
}

export const MODEL_BENCH_CASES: readonly EngineCaseDefinitionV1[] = buildCatalog();
