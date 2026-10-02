import { describe, expect, test } from "vitest";
import { inferExpectedFieldValue } from "../../src/background/agent/completion/form-field-analysis";

const field = (label: string) => ({ elementId: 1, stableKey: label, label, value: "", kind: "text" as const });

describe("value-before-field requests", () => {
  test.each([
    ["Write Hello native editor in the document on this page.", "Document content", "Hello native editor"],
    ['Type "Acme Inc" into the Company field on this page.', "Company", "Acme Inc"],
    ["Enter SAVE10 in Promo code on the checkout page.", "Promo code", "SAVE10"],
  ])("infers the authored value in %s", (request, label, expected) => {
    const target = field(label);
    expect(inferExpectedFieldValue(request, target, [target])).toBe(expected);
  });

  test("preserves explicit field-before-value assignments", () => {
    const target = field("Company");
    expect(inferExpectedFieldValue('Set Company to "Acme Inc"', target, [target])).toBe("Acme Inc");
  });
});
