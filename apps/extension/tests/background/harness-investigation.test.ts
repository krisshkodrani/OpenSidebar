import { describe, expect, test } from "vitest";
import {
  allAgentSessionsErrored,
  buildInvestigationReport,
  campaignStopReason,
  classifyAttempt,
  fingerprintConfig,
  modelIdentityMismatch,
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
    expect(classifyAttempt({ passed: false, reason: "HTTP 503 from provider" }).classification).toBe("provider_failure");
    expect(classifyAttempt({ passed: false, reason: "Expected 500 rows" }).classification).toBe("valid_model_failure");
  });

  test("stops a paid campaign after credit failure or repeated systemic failures", () => {
    const provider = { classification: "provider_failure" as const, reason: "HTTP 503" };
    const harness = { classification: "harness_failure" as const, reason: "runtime session error" };
    const model = { classification: "valid_model_failure" as const, reason: "assertion failed" };
    expect(campaignStopReason([provider])).toBeNull();
    expect(campaignStopReason([provider, model, provider])).toBeNull();
    expect(campaignStopReason([provider, harness])).toMatch(/Two consecutive/);
    expect(campaignStopReason([{ classification: "provider_failure", reason: "HTTP 402 credit exhausted" }]))
      .toMatch(/credit failure/);
  });

  test("recognizes a complete agent-session collapse without treating mixed outcomes as one", () => {
    expect(allAgentSessionsErrored([])).toBe(false);
    expect(allAgentSessionsErrored(["error", "error"])).toBe(true);
    expect(allAgentSessionsErrored(["error", "completed"])).toBe(false);
  });

  test("counts ordinary assertion failures as model evidence", () => {
    expect(classifyAttempt({ passed: false, reason: "expected false to be true" })).toEqual({
      classification: "valid_model_failure",
      eligibleForScoring: true,
    });
  });

  test("excludes mixed or unattributed model routes from a comparison", () => {
    const requested = { executorModel: "expected", plannerModel: "planner", judgeModel: "judge" };
    const usage = { executor: { calls: 2, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, llmTimeMs: 0 } };
    expect(modelIdentityMismatch(requested, { executor: ["expected", "fallback"] }, usage, ["run-1"]))
      .toContain("expected, fallback");
    expect(modelIdentityMismatch(requested, { executor: [] }, usage, ["run-1"]))
      .toContain("no resolved model");
    expect(modelIdentityMismatch(requested, { executor: ["expected"] }, usage, []))
      .toContain("no agent traces");
    expect(modelIdentityMismatch(requested, { executor: ["expected"] }, usage, ["run-1"]))
      .toBeNull();
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
