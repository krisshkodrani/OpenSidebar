import type {
  BenchmarkCharacter,
  BenchmarkDifficulty,
  BenchmarkPrimaryRole,
  BenchmarkSuite,
  ScenarioFamily,
} from "@opensidebar/scenario-contracts";
import type { EngineCaseDefinitionV1 } from "./types.js";

const EXPECTED_ROLES: Record<BenchmarkPrimaryRole, number> = {
  executor: 30,
  planner: 15,
  perception: 10,
  judge: 10,
  orchestration: 15,
  integrated: 20,
};
const EXPECTED_DIFFICULTIES: Record<BenchmarkDifficulty, number> = {
  easy: 25,
  medium: 40,
  hard: 35,
};
const EXPECTED_CHARACTERS: Record<BenchmarkCharacter, number> = {
  realistic: 70,
  diagnostic: 20,
  adversarial: 10,
};
const EXPECTED_FAMILIES: Record<ScenarioFamily, number> = {
  retail: 10,
  procurement: 8,
  crm: 10,
  email: 8,
  collaboration: 8,
  hr: 8,
  records: 10,
  analytics: 10,
  knowledge: 8,
  jobs: 8,
  monitoring: 8,
  durability: 4,
};
const EXPECTED_SUITES: Record<BenchmarkSuite, number> = {
  "smoke-10": 10,
  "core-20": 20,
  "standard-50": 50,
  "full-100": 100,
};
const STRATEGY_LEAK = /\b(data-testid|css selector|xpath|fixture|validator|benchmark|tag id|hidden expected)\b/i;

function counts<T extends string>(values: readonly T[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function compareCounts(
  label: string,
  actual: Record<string, number>,
  expected: Record<string, number>,
  errors: string[],
): void {
  for (const [key, wanted] of Object.entries(expected)) {
    const received = actual[key] ?? 0;
    if (received !== wanted) errors.push(`${label}.${key}: expected ${wanted}, received ${received}`);
  }
}

export function checkModelBenchCatalog(
  cases: readonly EngineCaseDefinitionV1[],
): string[] {
  const errors: string[] = [];
  if (cases.length !== 100) errors.push(`catalog: expected 100 cases, received ${cases.length}`);
  const ids = new Set<string>();
  for (const definition of cases) {
    const value = definition.contract;
    if (ids.has(value.id)) errors.push(`${value.id}: duplicate case id`);
    ids.add(value.id);
    if (STRATEGY_LEAK.test(value.prompt)) errors.push(`${value.id}: prompt contains a strategy leak`);
    if (definition.nearMisses.length < 3) errors.push(`${value.id}: fewer than three near misses`);
    if (!definition.validator.assertions.length) errors.push(`${value.id}: validator has no assertions`);
    if (!value.roleRationale.trim()) errors.push(`${value.id}: missing role rationale`);
    if (!value.prompt.trim() || !value.title.trim()) errors.push(`${value.id}: missing prompt or title`);
  }
  compareCounts("role", counts(cases.map((entry) => entry.contract.primaryRole)), EXPECTED_ROLES, errors);
  compareCounts("difficulty", counts(cases.map((entry) => entry.contract.difficulty)), EXPECTED_DIFFICULTIES, errors);
  compareCounts("character", counts(cases.map((entry) => entry.contract.character)), EXPECTED_CHARACTERS, errors);
  compareCounts("family", counts(cases.map((entry) => entry.contract.capabilityTags[0] as ScenarioFamily)), EXPECTED_FAMILIES, errors);
  for (const [suite, expected] of Object.entries(EXPECTED_SUITES)) {
    const actual = cases.filter((entry) => entry.contract.suites.includes(suite as BenchmarkSuite)).length;
    if (actual !== expected) errors.push(`suite.${suite}: expected ${expected}, received ${actual}`);
  }
  return errors;
}
