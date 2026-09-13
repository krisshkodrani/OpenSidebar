import { describe, expect, test } from "vitest";
import { ToolName } from "../../src/types";
import {
  classifyNodeEffect,
  isMutationEffect,
} from "../../src/background/orchestrator/node-effect-policy";

function classify(
  description: string,
  successCriteria = "",
  allowedTools: ToolName[] = [],
) {
  return classifyNodeEffect({ description, successCriteria, allowedTools });
}

describe("node effect policy", () => {
  test("keeps a report read-only when the root boundary is repeated in its criteria", () => {
    expect(
      classify(
        "Report the new times, arrival buffer, and total fee",
        "Report all values but do not purchase or confirm the ticket change",
      ),
    ).toBe("read_only");
  });

  test("distinguishes preparation from the consequential commit", () => {
    expect(
      classify(
        "Select and prepare the safest compliant change",
        "The change is ready for approval but not purchased",
        [ToolName.CLICK_ELEMENT],
      ),
    ).toBe("preparatory_write");
    expect(
      classify("Confirm the ticket purchase", "The ticket purchase is confirmed"),
    ).toBe("consequential_write");
  });

  test("keeps unknown mutation-capable work conservative", () => {
    const effect = classify("Continue the workflow", "The next state is visible", [
      ToolName.CLICK_ELEMENT,
    ]);
    expect(effect).toBe("unknown_write");
    expect(isMutationEffect(effect)).toBe(true);
  });
});

