import { describe, expect, test } from "vitest";
import {
  validateRfcDecisionMarkdown,
  type RfcDecisionStatus,
} from "../../../../scripts/rfc-decision";

function decisionMarkdown(
  status: RfcDecisionStatus = "Approved",
  requiredEdits = "None.",
  nextAction = "Implement",
): string {
  return `# RFC

## Decision

Status: ${status}

Chosen path:
- Use the environment port already present in the runtime.

Required edits before implementation:
- ${requiredEdits}

Non-blocking follow-ups:
- Add broader coverage later.

Do not do:
- Do not add a parallel adapter hierarchy.

Evidence required before merge:
- Focused unit tests and typecheck pass.

Next action:
- ${nextAction}
`;
}

describe("RFC Decision Stamp validation", () => {
  test("accepts a complete approved decision", () => {
    const result = validateRfcDecisionMarkdown(decisionMarkdown());

    expect(result.errors).toEqual([]);
    expect(result.stamp).toMatchObject({
      status: "Approved",
      nextAction: "Implement",
      requiredEdits: ["None."],
    });
  });

  test("accepts archive for a retrospectively verified approved RFC", () => {
    const result = validateRfcDecisionMarkdown(
      decisionMarkdown("Approved", "None.", "Archive"),
    );

    expect(result.errors).toEqual([]);
    expect(result.stamp?.nextAction).toBe("Archive");
  });

  test("accepts Prettier-wrapped bullet continuation lines", () => {
    const result = validateRfcDecisionMarkdown(
      decisionMarkdown().replace(
        "- Use the environment port already present in the runtime.",
        "- Use the environment port already present in the runtime and preserve\n  the existing boundary for production callers.",
      ),
    );

    expect(result.errors).toEqual([]);
    expect(result.stamp?.chosenPath).toEqual([
      "Use the environment port already present in the runtime and preserve the existing boundary for production callers.",
    ]);
  });

  test("rejects review text without a decision", () => {
    const result = validateRfcDecisionMarkdown(
      "# RFC\n\n## Review\n\nThis needs more edge-case analysis.",
    );

    expect(result.errors).toEqual(['Missing required "## Decision" section']);
  });

  test("does not treat a fenced template as a decision", () => {
    const result = validateRfcDecisionMarkdown(`# RFC

\`\`\`md
## Decision

Status: Approved
\`\`\`
`);

    expect(result.errors).toEqual(['Missing required "## Decision" section']);
  });

  test("rejects placeholders and missing required fields", () => {
    const result = validateRfcDecisionMarkdown(`## Decision

Status: Approved

Chosen path:
- ...

Required edits before implementation:
- None.

Next action:
- Implement
`);

    expect(result.errors).toContain(
      'Chosen path: contains unresolved placeholder "..."',
    );
    expect(result.errors).toContain(
      'Decision Stamp must contain exactly one "Evidence required before merge:"',
    );
  });

  test("requires blocking edits for approved-with-edits decisions", () => {
    const result = validateRfcDecisionMarkdown(
      decisionMarkdown("Approved with edits", "None.", "Revise RFC"),
    );

    expect(result.errors).toContain(
      '"Approved with edits" requires at least one blocking RFC edit',
    );
  });

  test("rejects a next action inconsistent with the status", () => {
    const result = validateRfcDecisionMarkdown(
      decisionMarkdown("Parked", "None.", "Implement"),
    );

    expect(result.errors).toContain(
      'Next action "Implement" is inconsistent with "Parked"',
    );
  });
});
