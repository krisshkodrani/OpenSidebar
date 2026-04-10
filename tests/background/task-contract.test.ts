import { describe, expect, test } from "vitest";

import {
  assessTaskContractCoverage,
  buildTaskContract,
  repairPlanCoverage,
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
});
