import { describe, expect, test } from "vitest";
import { getPromptDefinition } from "../../../../packages/prompts/src/registry";

describe("executor requested-fact preservation policy", () => {
  test("preserves transient requested facts before advancing the page", () => {
    const prompt = getPromptDefinition("agent.system");

    expect(prompt.version).toBe("v10");
    expect(prompt.template).toContain(
      "If the current view contains facts the original user asked you to return and the next action can replace that view",
    );
    expect(prompt.template).toContain(
      "This applies even when the current planner step only asks you to navigate",
    );
    expect(prompt.template).toContain(
      "call `update_notes` with only those exact in-scope facts in the same turn as the action",
    );
    expect(prompt.template).toContain(
      "Use the preserved facts in `done()`",
    );
  });
});
