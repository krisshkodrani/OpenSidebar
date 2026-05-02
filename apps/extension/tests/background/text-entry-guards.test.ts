import { describe, expect, test } from "vitest";
import "../setup";

import {
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
