import { describe, expect, test } from "vitest";
import {
  buildInvestigationReport,
  classifyAttempt,
  fingerprintConfig,
  validateConfig,
  type InvestigationConfig,
} from "../../../../scripts/harness-investigation-lib";

const config: InvestigationConfig = {
  label: "baseline",
  role: "baseline",
  env: {
    E2E_PROVIDER: "openrouter-groq",
    E2E_MODEL: "executor",
    E2E_EXECUTOR_PROVIDER_PIN: "groq",
    E2E_PLANNER_MODEL: "planner",
    E2E_PLANNER_PROVIDER_PIN: "openrouter",
    E2E_JUDGE_MODEL: "judge",
    E2E_JUDGE_PROVIDER_PIN: "openai",
  },
};

describe("harness investigation", () => {
  test("excludes provider and indeterminate failures from scoring", () => {
    expect(classifyAttempt({ passed: false, reason: "HTTP 403 Forbidden" })).toEqual({
      classification: "provider_failure",
      eligibleForScoring: false,
    });
    expect(classifyAttempt({ passed: false, reason: "timeout waiting for completion" })).toEqual({
      classification: "indeterminate",
      eligibleForScoring: false,
    });
  });

  test("counts ordinary assertion failures as model evidence", () => {
    expect(classifyAttempt({ passed: false, reason: "expected false to be true" })).toEqual({
      classification: "valid_model_failure",
      eligibleForScoring: true,
    });
  });

  test("requires every role to be pinned", () => {
    expect(validateConfig(config)).toEqual([]);
    expect(validateConfig({ ...config, env: { ...config.env, E2E_JUDGE_PROVIDER_PIN: "" } })).toContain(
      "baseline: judge provider pin is required",
    );
  });

  test("fingerprint is stable across environment insertion order", () => {
    const reversed = Object.fromEntries(Object.entries(config.env).reverse());
    expect(fingerprintConfig({ ...config, env: reversed })).toBe(fingerprintConfig(config));
  });

  test("report makes exclusions explicit", () => {
    const report = buildInvestigationReport([
      {
        configLabel: "baseline",
        file: "case.test.ts",
        repetition: 1,
        classification: "provider_failure",
        eligibleForScoring: false,
        status: "failed",
        durationMs: 10,
        reason: "HTTP 403",
        resultFile: "result.json",
        requestedModels: {},
        resolvedModels: {},
        traceRunIds: [],
        retryLineage: [],
        usageByRole: {},
        configFingerprint: "abc",
        buildRevision: "def",
        worktreeDirty: false,
      },
    ], "2026-08-11T00:00:00.000Z");
    expect(report).toContain("0/0 valid passes; 1 excluded");
    expect(report).toContain("provider_failure");
  });
});
