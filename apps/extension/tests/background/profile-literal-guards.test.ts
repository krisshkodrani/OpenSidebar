import { describe, expect, test } from "vitest";
import "../setup";
import {
  assessProfileLiteralTextRewrite,
  collectProfileRecordSetsFromValues,
  getProfileLiteralFallbackFields,
} from "../../src/background/agent/profile-literal-guards";
import type { TaggedElement } from "../../src/types";

function makeElement(overrides: Partial<TaggedElement>): TaggedElement {
  return {
    tag: 126,
    tagName: "input",
    role: "text",
    text: "",
    attributes: {},
    rect: { x: 0, y: 0, width: 100, height: 30 },
    isVisible: true,
    isDisabled: false,
    ...overrides,
  };
}

const profileToolMessage = {
  role: "tool" as const,
  tool_call_id: "functions.get_profile_fields:1",
  content:
    'PROFILE FIELDS:\n- experience: {"roles":[{"company":"Atlas Labs","title":"Senior Frontend Engineer","start_date":"2022-04","end_date":"Present","summary":"Built React and TypeScript workflow tools for enterprise teams."},{"company":"Northstar Systems","title":"Frontend Engineer","start_date":"2019-06","end_date":"2022-03","summary":"Delivered customer dashboards with GraphQL and design-system components."}]}',
};

describe("profile literal guards", () => {
  test("rewrites drifted repeatable-form summary to the exact profile literal", () => {
    const rewrite = assessProfileLiteralTextRewrite({
      selectedSkillId: "progressive-repeatable-form",
      messages: [profileToolMessage],
      element: makeElement({
        attributes: {
          id: "experience-1-summary",
          name: "experiences[0].summary",
          "aria-label": "Experience 1 role summary",
          label: "Role summary",
        },
      }),
      text: "Led the frontend team in building a scalable design system.",
    });

    expect(rewrite?.rewrittenText).toBe(
      "Built React and TypeScript workflow tools for enterprise teams.",
    );
  });

  test("uses bracket indexes and field aliases for later repeated rows", () => {
    const rewrite = assessProfileLiteralTextRewrite({
      selectedSkillId: "progressive-repeatable-form",
      messages: [profileToolMessage],
      element: makeElement({
        attributes: {
          name: "experiences[1].company",
          "aria-label": "Experience 2 company",
        },
      }),
      text: "Wrong Company",
    });

    expect(rewrite?.rewrittenText).toBe("Northstar Systems");
  });

  test("can rewrite from resolved profile values when message history is unavailable", () => {
    const recordSets = collectProfileRecordSetsFromValues({
      "experience.roles": [
        {
          company: "Atlas Labs",
          summary: "Built React and TypeScript workflow tools for enterprise teams.",
        },
      ],
    });
    const element = makeElement({
      attributes: {
        id: "experience-1-summary",
        name: "experiences[0].summary",
        "aria-label": "Experience 1 role summary",
      },
    });

    expect(getProfileLiteralFallbackFields(element)).toContain(
      "experience.roles",
    );
    expect(
      assessProfileLiteralTextRewrite({
        selectedSkillId: "progressive-repeatable-form",
        messages: [],
        recordSets,
        element,
        text: "Invented summary",
      })?.rewrittenText,
    ).toBe("Built React and TypeScript workflow tools for enterprise teams.");
  });

  test("does not rewrite outside exact-profile form skills", () => {
    const rewrite = assessProfileLiteralTextRewrite({
      selectedSkillId: "structured-form-fill",
      messages: [profileToolMessage],
      element: makeElement({
        attributes: {
          id: "experience-1-summary",
          "aria-label": "Experience 1 role summary",
        },
      }),
      text: "Led the frontend team in building a scalable design system.",
    });

    expect(rewrite).toBeNull();
  });
});
