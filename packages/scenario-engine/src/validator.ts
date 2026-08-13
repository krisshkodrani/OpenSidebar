import type {
  JsonObject,
  JsonValue,
  ScenarioStateV2,
  ValidationAssertionV1,
  ValidationResultV1,
} from "@opensidebar/scenario-contracts";
import { stableHash } from "./stable-json.js";
import type {
  ValidationInputV1,
  ValidatorAssertionSpecV1,
} from "./types.js";

function valueAt(root: unknown, path: string | undefined): JsonValue | undefined {
  if (!path) return root as JsonValue | undefined;
  let value: unknown = root;
  for (const part of path.split(".").filter(Boolean)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value as JsonValue | undefined;
}

function sourceValue(
  input: ValidationInputV1,
  assertion: ValidatorAssertionSpecV1,
): JsonValue | undefined {
  if (assertion.source === "answer") return input.finalAnswer;
  if (assertion.source === "terminal") return input.terminalOutcome;
  if (assertion.source === "events") {
    return valueAt(input.finalState.events as unknown as JsonValue, assertion.path);
  }
  return valueAt(input.finalState as unknown as JsonValue, assertion.path);
}

function assertionPasses(
  assertion: ValidatorAssertionSpecV1,
  actual: JsonValue | undefined,
): boolean {
  switch (assertion.operator) {
    case "equals":
      return JSON.stringify(actual) === JSON.stringify(assertion.expected);
    case "includes":
      return (
        typeof actual === "string" &&
        typeof assertion.expected === "string" &&
        actual.toLocaleLowerCase().includes(assertion.expected.toLocaleLowerCase())
      );
    case "exists":
      return actual !== undefined;
    case "not-exists":
      return actual === undefined;
    case "array-includes":
      return (
        Array.isArray(actual) &&
        actual.some(
          (item) => JSON.stringify(item) === JSON.stringify(assertion.expected),
        )
      );
  }
}

function leafPaths(value: JsonValue, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (value === null || typeof value !== "object") {
    result.set(prefix, JSON.stringify(value));
    return result;
  }
  if (Array.isArray(value)) {
    result.set(prefix, JSON.stringify(value));
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    for (const [leaf, encoded] of leafPaths(child, path)) result.set(leaf, encoded);
  }
  return result;
}

function unexpectedMutations(input: ValidationInputV1): string[] {
  const before = leafPaths(input.initialState as unknown as JsonValue);
  const after = leafPaths(input.finalState as unknown as JsonValue);
  const allowed = input.definition.validator.allowedMutationPaths;
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .filter(
      (path) =>
        ![
          "revision",
          "lifecycle",
          "route",
          "events",
        ].some((system) => path === system || path.startsWith(`${system}.`)),
    )
    .filter(
      (path) =>
        !allowed.some(
          (candidate) => path === candidate || path.startsWith(`${candidate}.`),
        ),
    )
    .sort();
}

export function validateCase(input: ValidationInputV1): ValidationResultV1 {
  const assertions: ValidationAssertionV1[] = input.definition.validator.assertions.map(
    (spec) => {
      const actual = sourceValue(input, spec);
      return {
        id: spec.id,
        passed: assertionPasses(spec, actual),
        expected: spec.expected,
        actual,
        evidence: spec.evidence,
      };
    },
  );
  const mutations = unexpectedMutations(input);
  const passed = assertions.every((assertion) => assertion.passed) && mutations.length === 0;
  const hashInput: JsonObject = {
    state: input.finalState as unknown as JsonValue,
    answer: input.finalAnswer ?? null,
    terminal: input.terminalOutcome ?? null,
  };
  return {
    schemaVersion: 1,
    caseId: input.definition.contract.id,
    caseVersion: input.definition.contract.version,
    validatorId: input.definition.validator.id,
    validatorVersion: input.definition.validator.version,
    verdict: passed ? "pass" : "fail",
    assertions,
    unexpectedMutations: mutations,
    finalStateHash: stableHash(hashInput),
  };
}

export function publicState(state: ScenarioStateV2): JsonObject {
  const value = state.data.public;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
