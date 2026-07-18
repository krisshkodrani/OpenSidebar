/**
 * Planner-gate policy (LP-17 P6): the pre-LLM single-node short-circuit.
 *
 * High-precision by design: a query only skips the planner when it fails
 * every multi-step signal AND matches a known single-node shape. When in
 * doubt these cases prefer routing to the planner — a false negative costs
 * one LLM call; a false positive costs plan structure.
 */
import { describe, expect, test } from "vitest";
import { qualifiesForDirectSingleNode } from "../../src/background/orchestrator/planner-gate-policy";

describe("qualifiesForDirectSingleNode", () => {
  test.each([
    // The measured 74%-single-node shapes.
    "Fill in the application form with my details",
    "Fill out the signup form using the test data",
    "Enter the shipping details into the form",
    "Summarize this page",
    "What is the renewal discount mentioned on this page?",
    "Read the article and tell me the author",
    "Extract the SKU number shown for Widget X",
    "Click the Apply button",
    "Select 'Austria' in the country dropdown",
    "Set the salary field to '50k' and press Save",
    "Toggle dark mode on",
  ])("qualifies: %s", (query) => {
    expect(qualifiesForDirectSingleNode(query)).toBe(true);
  });

  test.each([
    // Sequencing / structure.
    "Add the shoes to the cart, then apply coupon SAVE10, then checkout",
    "Steps: 1. open the form 2. fill it 3. submit",
    "1. Open settings\n2. Enable notifications\n3. Save",
    // Round trips.
    "Check the count on page 3 then go back to page 1 and check it too",
    "Visit the pricing page and return to the dashboard",
    // Multi-tab / compare.
    "Compare these two products in separate tabs",
    "Open each product in a new tab",
    // Exhaustive iteration.
    "Update every record in the list",
    "Review each application one by one",
    // Multiple URLs.
    "Read https://a.example/one and https://b.example/two",
    // Explicit separate-updates opt-out.
    "Apply the name change and the email change as separate form updates",
    // Too long to trust a heuristic.
    "Fill out this job application form. " + "Use exactly these values. ".repeat(12),
    // No positive shape at all.
    "Handle my workflow",
  ])("routes to the planner: %s", (query) => {
    expect(qualifiesForDirectSingleNode(query)).toBe(false);
  });

  test("navigation turns a read shape into a planner case", () => {
    expect(qualifiesForDirectSingleNode("Summarize this page")).toBe(true);
    expect(
      qualifiesForDirectSingleNode("Go to the blog and summarize the top post"),
    ).toBe(false);
  });

  test("a single trailing 'then' clause is tolerated, two are not", () => {
    expect(
      qualifiesForDirectSingleNode("Fill in the form fields, then stop"),
    ).toBe(true);
    expect(
      qualifiesForDirectSingleNode(
        "Fill in the form, then review it, then submit it",
      ),
    ).toBe(false);
  });
});
