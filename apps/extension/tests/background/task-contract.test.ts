import { describe, expect, test } from "vitest";

import {
  assessTaskContractCoverage,
  buildTaskContract,
  repairPlanCoverage,
  synthesizeBatchedExhaustivePlan,
  synthesizePlanFromTaskContract,
} from "../../src/background/agent/task-contract";

describe("task contract helpers", () => {
  test("extracts round-trip targets and report entities from navigation task", () => {
    const contract = buildTaskContract(
      [
        "Click through Warehouse Beta and Warehouse Gamma.",
        "Then use go_back twice to return to page 1 (Warehouse Alpha).",
        "Call done() reporting BOTH inventory counts: Gamma and Alpha.",
      ].join(" "),
    );

    expect(contract.requiresRoundTrip).toBe(true);
    expect(contract.returnTargets).toContain("warehouse alpha");
    expect(contract.reportTargets).toContain("gamma");
    expect(contract.reportTargets).toContain("alpha");
  });

  test("repairs plan coverage by appending missing return and report steps", () => {
    const repaired = repairPlanCoverage({
      query: [
        "Go to Warehouse Gamma.",
        "Then use go_back twice to return to page 1 (Warehouse Alpha).",
        "Call done() reporting BOTH inventory counts: Gamma and Alpha.",
      ].join(" "),
      steps: [
        {
          objective: "Go to Warehouse Gamma.",
          successCriteria: "Page shows Warehouse Gamma.",
          dependencies: [],
          assumptions: [],
          toolProfile: "navigate",
        },
      ],
    });

    expect(repaired.length).toBeGreaterThanOrEqual(2);
    expect(
      repaired.some((step) => /return to warehouse alpha/i.test(step.objective)),
    ).toBe(true);
    expect(
      repaired.some(
        (step) =>
          /warehouse alpha/i.test(step.objective) &&
          (/verify/i.test(step.objective) || /requested result/i.test(step.objective)),
      ),
    ).toBe(true);
  });

  test("flags incomplete final coverage when return target and deliverables are missing", () => {
    const contract = buildTaskContract(
      [
        "Use go_back twice to return to page 1 (Warehouse Alpha).",
        "Call done() reporting BOTH inventory counts: Gamma and Alpha.",
      ].join(" "),
    );

    const coverage = assessTaskContractCoverage({
      contract,
      text: "Verified Warehouse Beta and page 2 of 3.",
      requireReturnTarget: true,
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.missingReturnTarget).toBe(true);
    expect(coverage.missingEntities).toContain("alpha");
    expect(coverage.missingEntities).toContain("gamma");
  });

  test("detects multi-return 'both' in natural language queries", () => {
    const contract = buildTaskContract(
      "Check the inventory count for Warehouse Gamma on page 3, then go back to Warehouse Alpha and check its count too. Tell me both numbers.",
    );

    expect(contract.multiReturnCount).toBe(2);
    // Should extract Gamma and Alpha as required entities
    expect(contract.requiredEntities).toContain("warehouse gamma");
    expect(contract.requiredEntities).toContain("warehouse alpha");
  });

  test("multi-return coverage rejects when summary has 1 of 2 required entities", () => {
    const contract = buildTaskContract(
      "Tell me both numbers for Gamma and Alpha.",
    );

    expect(contract.multiReturnCount).toBe(2);

    const coverage = assessTaskContractCoverage({
      contract,
      text: "Warehouse Gamma inventory count: 6,412 units",
    });

    expect(coverage.satisfied).toBe(false);
  });

  test("multi-return coverage passes when summary has both required entities", () => {
    const contract = buildTaskContract(
      "Tell me both numbers for Gamma and Alpha.",
    );

    const coverage = assessTaskContractCoverage({
      contract,
      text: "Warehouse Gamma: 6,412 units. Warehouse Alpha: 4,827 units.",
    });

    expect(coverage.satisfied).toBe(true);
  });

  test("ignores conversational filler when building required entities", () => {
    const contract = buildTaskContract(
      "Actually, change the reply. Decline both proposed times and suggest Monday at 11 AM instead.",
    );

    expect(contract.requiredEntities).not.toContain("actually");
  });

  test("ignores sentence-initial imperative verbs as named entities", () => {
    const contract = buildTaskContract(
      "Decline both proposed times. Suggest Monday at 11 AM instead.",
    );

    expect(contract.requiredEntities).not.toContain("decline");
    expect(contract.requiredEntities).not.toContain("suggest");
    expect(contract.multiReturnCount).toBeUndefined();
  });

  test("does not enforce multi-return coverage when no concrete targets are extracted", () => {
    const contract = buildTaskContract(
      "Based on what you saw in both tabs, which area of the business looks strongest?",
    );

    expect(contract.multiReturnCount).toBeUndefined();
    expect(contract.requiredEntities).not.toContain("based");

    const coverage = assessTaskContractCoverage({
      contract,
      text: "Traffic looks strongest based on the combined data from both tabs.",
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.missingMultiReturnCoverage).toBe(false);
  });

  test("no multi-return false positive on single-return queries", () => {
    const contract = buildTaskContract("What is Diana's salary?");

    expect(contract.multiReturnCount).toBeUndefined();
  });

  test("synthesizes a multi-step plan for round-trip reporting tasks", () => {
    const synthesized = synthesizePlanFromTaskContract(
      [
        "Click through Warehouse Beta and Warehouse Gamma.",
        "Then use go_back twice to return to page 1 (Warehouse Alpha).",
        "Call done() reporting BOTH inventory counts: Gamma and Alpha.",
      ].join(" "),
    );

    expect(synthesized).not.toBeNull();
    expect(synthesized!.length).toBeGreaterThanOrEqual(2);
    expect(synthesized![0].objective).toMatch(/\bgamma\b/i);
    expect(synthesized!.some((step) => /\balpha\b/i.test(step.objective))).toBe(true);
    expect(synthesized![synthesized!.length - 1].objective).toMatch(/report/i);
  });

  test("detects exhaustive scope obligations from all-count queries", () => {
    const contract = buildTaskContract(
      "Review all 10 job listings on this page, then tell me the best matches.",
    );

    expect(contract.exhaustiveScopeCount).toBe(10);
    expect(contract.exhaustiveScopeLabel).toBe("job listings");
  });

  test("does not treat vague restart language as exhaustive scope", () => {
    const contract = buildTaskContract(
      "Actually, scrap all of that. Clear everything and start over with: name Bob Martinez, email bob@company.com, phone 555-0200.",
    );

    expect(contract.exhaustiveScopeLabel).toBeUndefined();
    expect(contract.exhaustiveScopeCount).toBeUndefined();
  });

  test("detects sequential detail-review intent for exhaustive list tasks", () => {
    const contract = buildTaskContract(
      "Please review all 10 job listings on this page, click into each one to read the full details, then come back to the listings page and tell me the best matches.",
    );

    expect(contract.requiresSequentialDetailReview).toBe(true);
  });

  test("exhaustive scope coverage rejects summaries that omit full coverage", () => {
    const contract = buildTaskContract(
      "Review all 10 job listings on this page, then tell me the best matches.",
    );

    const coverage = assessTaskContractCoverage({
      contract,
      text: "I reviewed the Senior Frontend Engineer role and it looks like the best fit.",
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.missingExhaustiveCoverage).toBe(true);
  });

  test("exhaustive scope coverage passes when summary confirms all requested items", () => {
    const contract = buildTaskContract(
      "Review all 10 job listings on this page, then tell me the best matches.",
    );

    const coverage = assessTaskContractCoverage({
      contract,
      text: "After reviewing all 10 job listings, the best matches are Senior Frontend Engineer, Frontend Tech Lead, and Full Stack Engineer.",
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.missingExhaustiveCoverage).toBe(false);
  });

  test("repairPlanCoverage appends final synthesis step for exhaustive review tasks", () => {
    const repaired = repairPlanCoverage({
      query: "Review all 10 job listings on this page, then tell me which ones are the best matches for my profile and why.",
      steps: [
        {
          objective: "Read and record details of Job Listing #1.",
          successCriteria: "Job #1 details visible.",
          dependencies: [],
          assumptions: [],
          toolProfile: "read_only",
        },
        {
          objective: "Read and record details of Job Listing #2.",
          successCriteria: "Job #2 details visible.",
          dependencies: [0],
          assumptions: [],
          toolProfile: "read_only",
        },
      ],
    });

    expect(
      repaired.some((step) =>
        /best matches|best fit|user's stated constraints|recommend/i.test(
          `${step.objective} ${step.successCriteria}`,
        ),
      ),
    ).toBe(true);
  });

  test("synthesizes compact batched plan for bounded exhaustive detail review tasks", () => {
    const synthesized = synthesizeBatchedExhaustivePlan(
      "Please review all 10 job listings on this page, click into each one to read the full details, then come back to the listings page. After reviewing every job, tell me which ones are the best matches for my profile and why.",
    );

    expect(synthesized).not.toBeNull();
    expect(synthesized!.length).toBeLessThanOrEqual(5);
    expect(
      synthesized!.some((step) =>
        /job listings #1 through #3|job listings #1 through #4/i.test(
          step.objective,
        ),
      ),
    ).toBe(true);
    expect(synthesized![synthesized!.length - 1].objective).toMatch(
      /best matches/i,
    );
  });
});
