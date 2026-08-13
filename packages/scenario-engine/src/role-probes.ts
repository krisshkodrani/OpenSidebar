import type {
  BenchmarkPrimaryRole,
  JsonObject,
  RoleProbeV1,
} from "@opensidebar/scenario-contracts";
import { MODEL_BENCH_CASES } from "./case-catalog.js";
import { stableHash } from "./stable-json.js";

type ProbeRole = Exclude<BenchmarkPrimaryRole, "integrated">;

const PROBE_INSTRUCTIONS: Record<ProbeRole, string> = {
  executor: "Choose the single next grounded browser action that advances the objective without collateral mutation.",
  planner: "Produce the minimum ordered subgoals, including the observable verification condition for each consequential step.",
  perception: "Extract only the requested visible fact and identify the evidence region or structured element that supports it.",
  judge: "Decide whether the objective is complete, requires clarification, is blocked, or needs another verified action.",
  orchestration: "Choose the correct continuation, recovery, retry, or routing decision from the supplied runtime state.",
};

function sourceCases(role: ProbeRole) {
  const exact = MODEL_BENCH_CASES.filter(
    (definition) => definition.contract.primaryRole === role,
  );
  const fallback = MODEL_BENCH_CASES.filter(
    (definition) => definition.contract.primaryRole === "integrated",
  );
  return [...exact, ...fallback].slice(0, 10);
}

function buildProbe(role: ProbeRole, index: number): RoleProbeV1 {
  const definition = sourceCases(role)[index];
  if (!definition) throw new Error(`Insufficient source cases for ${role} probes.`);
  const base = {
    schemaVersion: 1 as const,
    id: `${role}.probe-${String(index + 1).padStart(2, "0")}`,
    version: 1,
    role,
    sourceCaseId: definition.contract.id,
    instruction: PROBE_INSTRUCTIONS[role],
    input: {
      objective: definition.contract.prompt,
      scenarioId: definition.contract.scenarioId,
      approvalPolicy: definition.contract.approvalPolicy,
      difficulty: definition.contract.difficulty,
    } as JsonObject,
    expected: {
      validatorId: definition.validator.id,
      requiredEvidence: definition.validator.assertions.map(
        (assertion) => assertion.evidence,
      ),
      forbiddenMutationCount: 0,
    } as JsonObject,
  };
  return { ...base, contentHash: stableHash(base) };
}

const PROBE_ROLES: readonly ProbeRole[] = [
  "executor",
  "planner",
  "perception",
  "judge",
  "orchestration",
];

export const ROLE_PROBES: readonly RoleProbeV1[] = PROBE_ROLES.flatMap((role) =>
  Array.from({ length: 10 }, (_, index) => buildProbe(role, index)),
);

export function checkRoleProbes(probes = ROLE_PROBES): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const probe of probes) {
    if (ids.has(probe.id)) errors.push(`${probe.id}: duplicate probe id`);
    ids.add(probe.id);
    if (!MODEL_BENCH_CASES.some((entry) => entry.contract.id === probe.sourceCaseId)) {
      errors.push(`${probe.id}: unknown source case ${probe.sourceCaseId}`);
    }
  }
  for (const role of PROBE_ROLES) {
    const count = probes.filter((probe) => probe.role === role).length;
    if (count !== 10) errors.push(`${role}: expected 10 probes, received ${count}`);
  }
  if (probes.length !== 50) errors.push(`expected 50 probes, received ${probes.length}`);
  return errors;
}
