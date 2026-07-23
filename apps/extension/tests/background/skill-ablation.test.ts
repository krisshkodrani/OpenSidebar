/**
 * Ablation switch (2026-07-23 skills audit, Finding 5): every skill must be
 * disableable so with/without comparison runs are possible. Before this,
 * 26 of 30 skills had no packId and were unconditionally eligible.
 */
import { afterEach, describe, expect, test } from "vitest";
import "../setup";
import {
  listSkillDescriptors,
  resolveEligibleSkillCandidates,
  selectPrimarySkill,
  setDisabledSkillIds,
  getLoadedSkillContract,
} from "../../src/background/orchestrator/skills";

afterEach(() => setDisabledSkillIds([]));

const FORM_FILL_INPUT = {
  objective: "Fill the registration form fields and submit it",
  successCriteria: "All form fields are filled and the form is submitted",
};

describe("skill ablation switch", () => {
  test("a disabled skill is not selected by the keyword matcher", () => {
    const before = selectPrimarySkill(FORM_FILL_INPUT);
    expect(before?.id).toBe("structured-form-fill");

    setDisabledSkillIds(["structured-form-fill"]);
    const after = selectPrimarySkill(FORM_FILL_INPUT);
    expect(after?.id).not.toBe("structured-form-fill");
  });

  test("a disabled skill drops out of candidate routing and listings", () => {
    setDisabledSkillIds(["cross-tab-compare"]);

    const candidates = resolveEligibleSkillCandidates({
      objective: "Compare the two tabs",
    });
    expect(candidates.some((c) => c.skill.id === "cross-tab-compare")).toBe(false);
    expect(
      listSkillDescriptors().some((s) => s.id === "cross-tab-compare"),
    ).toBe(false);
  });

  test("per-call options disable without touching the module switch", () => {
    const candidates = resolveEligibleSkillCandidates({
      objective: "Compare the two tabs",
      disabledSkillIds: ["cross-tab-compare"],
    });
    expect(candidates.some((c) => c.skill.id === "cross-tab-compare")).toBe(false);

    // Module-level state untouched: without the option the skill is back.
    const unrestricted = resolveEligibleSkillCandidates({
      objective: "Compare the two tabs",
    });
    expect(unrestricted.some((c) => c.skill.id === "cross-tab-compare")).toBe(true);
  });

  test("an already-selected skill keeps its loaded contract mid-run", () => {
    // Selection-time only: disabling must not strand a running node whose
    // skill was selected before the settings change.
    setDisabledSkillIds(["structured-form-fill"]);
    const contract = getLoadedSkillContract("structured-form-fill");
    expect(contract).not.toBeNull();
    expect(contract?.procedureMarkdown.length).toBeGreaterThan(0);
  });
});
