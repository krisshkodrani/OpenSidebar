import { describe, expect, test } from "vitest";
import "../setup";

import {
  assessAutocompleteTextRewrite,
  assessInlineEditNavigationGuard,
  assessInlineEditTextEntryRetarget,
  assessTextEntryClickGuard,
  getAutocompleteSuggestionDoneRejection,
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

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Autocomplete & Typeahead",
    url: "https://example.test/autocomplete",
    elements: [],
    visibleContent: "",
    pageContent: "",
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  } as DomSnapshot;
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

  test("blocks navigation keys while inline editor still has the old value", () => {
    const result = assessInlineEditNavigationGuard({
      activeToolProfile: "edit_surface",
      objectiveText:
        "Click the Q1 Sales cell in the first data row, type 999, and press Enter to confirm the change",
      key: "Tab",
      snapshot: snapshot({
        title: "Sheet",
        url: "https://example.com/sheet",
        elements: [
          element({
            tag: 44,
            tagName: "input",
            role: "textbox",
            text: "130",
            isVisible: true,
            attributes: {
              type: "text",
              value: "130",
              "aria-label": "Q1 Sales editor",
            },
          }),
        ],
      }),
    });

    expect(result).toContain('needs "999"');
    expect(result).toContain('type_text({"id":44,"text":"999"})');
  });

  test("allows inline edit commit key after replacement value is typed", () => {
    expect(
      assessInlineEditNavigationGuard({
        activeToolProfile: "edit_surface",
        objectiveText: "Update the Q1 Sales cell in row 1 to 999",
        key: "Enter",
        snapshot: snapshot({
          elements: [
            element({
              tag: 44,
              tagName: "input",
              text: "999",
              isVisible: true,
              attributes: { type: "text", value: "999" },
            }),
          ],
        }),
      }),
    ).toBeNull();
  });

  test("keeps inline edit navigation guard active after profile widening", () => {
    const result = assessInlineEditNavigationGuard({
      activeToolProfile: "recover_from_stuck",
      selectedSkillId: "inline-edit-surface",
      objectiveText:
        "Click the Q1 Sales cell in the first data row, type 999, and press Enter to confirm the change",
      key: "Escape",
      snapshot: snapshot({
        elements: [
          element({
            tag: 44,
            tagName: "input",
            text: "130",
            isVisible: true,
            attributes: { type: "text", value: "130" },
          }),
        ],
      }),
    });

    expect(result).toContain('needs "999"');
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

  test("rejects done when a requested autocomplete suggestion is still visible", () => {
    const result = getAutocompleteSuggestionDoneRejection({
      snapshot: snapshot({
        elements: [
          element({
            tag: 2,
            attributes: {
              id: "product-input",
              label: "Search Products",
              value: "Laptop Stand",
            },
          }),
          element({
            tag: 43,
            tagName: "li",
            role: "li",
            text: "Laptop Stand",
          }),
        ],
      }),
      originalQuery:
        "Fill the address from suggestions, and search for 'Laptop Stand' in the product search.",
      activeObjective:
        "Type 'Laptop Stand' into the product search field and submit the search",
      successCriteria:
        "Product search field contains 'Laptop Stand' and search submitted state is visible",
      summary: "The product search field contains Laptop Stand.",
    });

    expect(result).toMatchObject({
      inputTag: 2,
      suggestionTag: 43,
      value: "laptop stand",
    });
    expect(result?.reason).toContain("has not been selected");
  });

  test("allows done when the autocomplete selection is already confirmed", () => {
    const result = getAutocompleteSuggestionDoneRejection({
      snapshot: snapshot({
        visibleContent: "Selected: Laptop Stand",
        elements: [
          element({
            tag: 2,
            attributes: {
              id: "product-input",
              label: "Search Products",
              value: "Laptop Stand",
            },
          }),
          element({
            tag: 43,
            tagName: "li",
            role: "li",
            text: "Laptop Stand",
          }),
        ],
      }),
      originalQuery: "Search for 'Laptop Stand' in the product search.",
    });

    expect(result).toBeNull();
  });

  test("does not reject ordinary search results without autocomplete context", () => {
    const result = getAutocompleteSuggestionDoneRejection({
      snapshot: snapshot({
        title: "Product Search",
        url: "https://example.test/search",
        elements: [
          element({
            tag: 2,
            attributes: {
              id: "product-search",
              label: "Search Products",
              value: "Laptop Stand",
            },
          }),
          element({
            tag: 43,
            tagName: "li",
            role: "li",
            text: "Laptop Stand",
          }),
        ],
      }),
      originalQuery: "Search for 'Laptop Stand' in the product search.",
    });

    expect(result).toBeNull();
  });
});
