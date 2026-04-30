import { describe, expect, test } from "vitest";

import {
  assessTaskContractCoverage,
  buildTaskContract,
  isNavigationOnlyTask,
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

  test("does not synthesize report steps for quoted navigation-only module targets", () => {
    const query =
      'Navigate to the "Breakdowns > Elements Filters" module of the "Performance Analytics" application.';

    expect(isNavigationOnlyTask(query)).toBe(true);
    expect(synthesizePlanFromTaskContract(query)).toBeNull();
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
      repaired.some((step) =>
        /return to warehouse alpha/i.test(step.objective),
      ),
    ).toBe(true);
    expect(
      repaired.some(
        (step) =>
          /warehouse alpha/i.test(step.objective) &&
          (/verify/i.test(step.objective) ||
            /requested result/i.test(step.objective)),
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

  test("does not turn imperative schedule phrasing into fake missing entities", () => {
    const contract = buildTaskContract(
      [
        "Read David Park's email about the Q3 strategy meeting and draft a reply.",
        "Decline both proposed times — you have a client demo on Thursday and a team offsite on Friday.",
        "Suggest Monday at 2 PM instead.",
        "Keep it professional, 3-4 sentences. Don't send it, just draft.",
      ].join(" "),
    );

    expect(contract.requiredEntities).not.toContain("suggest monday");

    const coverage = assessTaskContractCoverage({
      contract,
      text: [
        "Successfully drafted a professional reply to David Park about the Q3 strategy meeting.",
        "The draft says Thursday does not work because of a client demo, Friday does not work because of a team offsite, and asks whether Monday at 2 PM would work instead.",
        "The reply remains unsent as a draft.",
      ].join(" "),
    });

    expect(coverage.missingEntities).not.toContain("suggest monday");
    expect(coverage.satisfied).toBe(true);
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
    expect(synthesized!.some((step) => /\balpha\b/i.test(step.objective))).toBe(
      true,
    );
    expect(synthesized![synthesized!.length - 1].objective).toMatch(/report/i);
  });

  test("synthesizes a compact plan for field-heavy record creation prompts", () => {
    const synthesized = synthesizePlanFromTaskContract(
      'Create a new incident with a value of "EMAIL Server Down Again" for field "Short description", a value of "Joe Employee" for field "Caller", a value of "false" for field "Knowledge", a value of "" for field "Service", a value of "Closed before close notes were made mandatory" for field "Resolution notes", a value of "Multiple employees have reported that they are unable to send/receive email." for field "Description", a value of "" for field "Change Request", and a value of "Phone" for field "Channel".',
    );

    expect(synthesized).not.toBeNull();
    expect(synthesized).toHaveLength(2);
    expect(synthesized![0].toolProfile).toBe("form_fill");
    expect(synthesized![0].objective).toContain(
      'Short description="EMAIL Server Down Again"',
    );
    expect(synthesized![0].objective).toContain('Channel="Phone"');
    expect(synthesized![1].toolProfile).toBe("submit_form");
    expect(synthesized![1].dependencies).toEqual([0]);
  });

  test("does not turn empty WorkArena field values into fake quoted obligations", () => {
    const prompt =
      'Create a new incident with a value of "EMAIL Server Down Again" for field "Short description", a value of "Joe Employee" for field "Caller", a value of "false" for field "Knowledge", a value of "" for field "Service", a value of "Closed before close notes were made mandatory" for field "Resolution notes", a value of "Multiple employees have reported that they are unable to send/receive email." for field "Description", a value of "" for field "Change Request", and a value of "Phone" for field "Channel".';
    const contract = buildTaskContract(prompt);

    expect(contract.requiredEntities).not.toContain("for field");
    expect(contract.requiredEntities).not.toContain(", a value of");
    expect(contract.requiredEntities).not.toContain(", and a value of");

    const coverage = assessTaskContractCoverage({
      contract,
      text: [
        "Short description: EMAIL Server Down Again",
        "Caller: Joe Employee",
        "Knowledge: false",
        "Service: empty",
        "Resolution notes: Closed before close notes were made mandatory",
        "Description: Multiple employees have reported that they are unable to send/receive email.",
        "Change Request: empty",
        "Channel: Phone",
        "Submit advanced from populated record INC0045792 to a fresh record form.",
      ].join("\n"),
    });

    expect(coverage.satisfied).toBe(true);
  });

  test("does not misread long quoted form values as fake quote pairs", () => {
    const prompt =
      'Create a new change request with a value of "" for field "Service offering", a value of "" for field "Configuration item", a value of "--Logon to the switch using SSH--Type the following commandsswitch# configure terminalswitch(config)# interface {type slot/port | port-channel number}switch(config-if)# switchport access vlan vlan-idFor exampleswitch# configure terminalswitch(config)# interface Gi1/1switch(config-if)# switchport access vlan 101--Save the switch config file" for field "Implementation plan", a value of "CHG0000021" for field "Number", a value of "Moderate" for field "Risk", and a value of "Successful" for field "Close code".';
    const contract = buildTaskContract(prompt);

    expect(contract.requiredEntities).not.toContain("for field");
    expect(contract.requiredEntities).not.toContain(", a value of");
    expect(contract.requiredEntities).not.toContain(", and a value of");
    expect(contract.requiredNumbers).not.toContain("101");

    const coverage = assessTaskContractCoverage({
      contract,
      text: [
        "Service offering: empty",
        "Configuration item: empty",
        "Implementation plan: filled with the requested SSH switch configuration commands",
        "Number: CHG0000021",
        "Risk: Moderate",
        "Close code: Successful",
        "Submit advanced from populated record CHG0041055 to fresh record form CHG0041056.",
      ].join("\n"),
    });

    expect(coverage.satisfied).toBe(true);
  });

  test("does not treat quoted knowledge-base questions as literal summary obligations", () => {
    const prompt =
      'Answer the following question using the knowledge base: "Each year, how many new hires does the company typically make? Your answer should be a number."';
    const contract = buildTaskContract(prompt);

    expect(contract.requiredEntities).not.toContain(
      "each year, how many new hires does the company typically make? your answer should be a number.",
    );

    const coverage = assessTaskContractCoverage({
      contract,
      text: "The company typically makes 100 new hires each year.",
    });

    expect(coverage.satisfied).toBe(true);
  });

  test("extracts multi-target board update obligations", () => {
    const contract = buildTaskContract(
      "The release needs documentation and CI work started. Move the API docs card and the CI pipeline card into In Progress.",
    );

    expect(contract.requiredActionTargets).toEqual(["api docs", "ci pipeline"]);
    expect(contract.requiredEntities).toContain("api docs");
    expect(contract.requiredEntities).toContain("ci pipeline");

    const coverage = assessTaskContractCoverage({
      contract,
      text: "Moved Write API Docs from todo to in-progress.",
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.missingEntities).toContain("ci pipeline");
  });

  test("repairs planner output that covers only one multi-target update", () => {
    const repaired = repairPlanCoverage({
      query:
        "The release needs documentation and CI work started. Move the API docs card and the CI pipeline card into In Progress.",
      steps: [
        {
          objective:
            "Move the API docs card from its current column to the In Progress column.",
          successCriteria: "Page confirms API docs is in In Progress.",
          dependencies: [],
          assumptions: [],
        },
      ],
    });

    expect(repaired.length).toBe(2);
    expect(repaired[1].objective).toMatch(/ci pipeline/i);
    expect(repaired[1].successCriteria).toMatch(/in progress/i);
  });

  test("synthesizes per-target steps for multi-target update requests", () => {
    const synthesized = synthesizePlanFromTaskContract(
      "Move the API docs card and the CI pipeline card into In Progress.",
    );

    expect(synthesized).not.toBeNull();
    expect(synthesized).toHaveLength(2);
    expect(synthesized![0].objective).toMatch(/api docs/i);
    expect(synthesized![1].objective).toMatch(/ci pipeline/i);
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
      query:
        "Review all 10 job listings on this page, then tell me which ones are the best matches for my profile and why.",
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
    expect(synthesized!.length).toBe(11);
    expect(
      synthesized!.some((step) => /job listing #1\b/i.test(step.objective)),
    ).toBe(true);
    expect(
      synthesized!
        .slice(0, 10)
        .every((step) => step.toolProfile === "navigate"),
    ).toBe(true);
    expect(synthesized![synthesized!.length - 1].objective).toMatch(
      /best matches/i,
    );
  });
});
