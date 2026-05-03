import { describe, expect, test } from "vitest";
import "../setup";

import {
  assessAutocompleteTextRewrite,
  assessInlineEditTextEntryRetarget,
  assessTextEntryClickGuard,
  rewriteAutocompleteTextEntry,
  validateTextEntryTarget,
} from "../../src/background/agent/text-entry-guards";
import type { DomSnapshot } from "../../src/types";

function element(
  overrides: Partial<DomSnapshot["elements"][number]> = {},
): DomSnapshot["elements"][number] {
  return {
    tag: 7,
    tagName: "input",
    text: "",
    role: "",
    attributes: {},
    ...overrides,
  } as DomSnapshot["elements"][number];
}

describe("text entry guards", () => {
  test("rejects typing into non-text controls", () => {
    expect(
      validateTextEntryTarget(
        "Enter the coupon",
        element({ attributes: { type: "checkbox" } }),
        "SAVE10",
      ),
    ).toContain("is not a text-entry field");
  });

  test("rejects mismatched explicit value for a labeled field", () => {
    expect(
      validateTextEntryTarget(
        "Set the email address with user@example.com",
        element({ attributes: { type: "email", placeholder: "Email" } }),
        "other@example.com",
      ),
    ).toContain('expects "user@example.com"');
  });

  test("allows matching text entry target", () => {
    expect(
      validateTextEntryTarget(
        "Set the email address with user@example.com",
        element({ attributes: { type: "email", placeholder: "Email" } }),
        "user@example.com",
      ),
    ).toBeNull();
  });

  test("blocks clicking a text input when the objective requires typing a value", () => {
    expect(
      assessTextEntryClickGuard({
        objectiveText: "Set the email address with user@example.com",
        element: element({
          attributes: { type: "email", placeholder: "Email" },
        }),
        targetId: 7,
      }),
    ).toEqual({
      explicitValue: "user@example.com",
      blockReason:
        'Error: This step requires entering "user@example.com" into [7]. ' +
        "Use type_text instead of click_element on this input.",
    });
  });

  test("allows clicking non-text inputs for text-entry objectives", () => {
    expect(
      assessTextEntryClickGuard({
        objectiveText: "Set the email address with user@example.com",
        element: element({ attributes: { type: "checkbox" } }),
        targetId: 7,
      }),
    ).toEqual({
      explicitValue: null,
      blockReason: null,
    });
  });

  test("retargets inline-edit text entry from a cell to the active input", () => {
    const result = assessInlineEditTextEntryRetarget({
      activeToolProfile: "edit_surface",
      targetId: 37,
      snapshot: {
        title: "Sheet",
        url: "https://example.com/sheet",
        elements: [
          element({
            tag: 37,
            tagName: "td",
            role: "gridcell",
            text: "130",
            rect: { x: 10, y: 10, width: 80, height: 24 },
          }),
          element({
            tag: 44,
            tagName: "input",
            role: "textbox",
            text: "130",
            isVisible: true,
            rect: { x: 12, y: 12, width: 76, height: 20 },
            attributes: {
              type: "text",
              value: "130",
              "aria-label": "Q1 Sales editor",
            },
          }),
        ],
        pageContent: "Sheet editor",
        visibleContent: "Sheet editor",
        scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
        viewportHeight: 800,
        timestamp: Date.now(),
      },
    });

    expect(result).toEqual({
      retargetedId: 44,
      reason:
        "Retargeted type_text from [37] to the active inline editor [44] for this edit-surface step.",
    });
  });

  test("does not retarget inline-edit text entry outside edit-surface profile", () => {
    expect(
      assessInlineEditTextEntryRetarget({
        activeToolProfile: "form_fill",
        targetId: 37,
        snapshot: {
          title: "Sheet",
          url: "https://example.com/sheet",
          elements: [
            element({ tag: 37, tagName: "td", role: "gridcell" }),
            element({ tag: 44, tagName: "input" }),
          ],
          pageContent: "Sheet editor",
          visibleContent: "Sheet editor",
          scrollPosition: { top: 0, left: 0, height: 1000, width: 1000 },
          viewportHeight: 800,
          timestamp: Date.now(),
        },
      }),
    ).toBeNull();
  });

  test("rewrites autocomplete text entry to a prefix", () => {
    const result = rewriteAutocompleteTextEntry({
      objectiveText: "Choose the matching suggestion from the dropdown",
      element: element({
        role: "combobox",
        attributes: { "aria-autocomplete": "list" },
      }),
      typedText: "Acme Corporation",
    });

    expect(result?.rewrittenText).toBe("Acme C");
    expect(result?.reason).toContain("Autocomplete guard");
  });

  test("assesses autocomplete rewrite from tool args", () => {
    const result = assessAutocompleteTextRewrite({
      objectiveText: "Choose the matching suggestion from the dropdown",
      originalQuery: "Choose Acme Corporation from suggestions",
      element: element({
        role: "combobox",
        attributes: { "aria-autocomplete": "list" },
      }),
      args: { text: "Acme Corporation" },
    });

    expect(result?.rewrittenText).toBe("Acme C");
    expect(result?.reason).toContain("Autocomplete guard");
  });

  test("does not rewrite normal input fields", () => {
    expect(
      rewriteAutocompleteTextEntry({
        objectiveText: "Choose the matching suggestion from the dropdown",
        element: element({ attributes: { placeholder: "Name" } }),
        typedText: "Acme Corporation",
      }),
    ).toBeNull();
  });
});
