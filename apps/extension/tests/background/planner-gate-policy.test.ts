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
    // Mixed read/write objective: finding the value is only an intermediate.
    "Find a 30-minute time when Ana, Marco, and Priya are free tomorrow afternoon and create a tentative release review.",
    // Explicit separate-updates opt-out.
    "Apply the name change and the email change as separate form updates",
    // Long WITHOUT the field-value-line shape: length alone stays untrusted.
    "Fill out this job application form. " +
      "Use exactly these values. ".repeat(12),
    // No positive shape at all.
    "Handle my workflow",
  ])("routes to the planner: %s", (query) => {
    expect(qualifiesForDirectSingleNode(query)).toBe(false);
  });

  describe("value-laden form fill tier (LP-17b CM-1)", () => {
    // Mirrors the real take-6 kit shape: long, field-value lines, same-page
    // iteration words ("each field ONCE", "select BOTH"), URLs as VALUES.
    const kitPrompt = [
      "Fill out this job application form. Use EXACTLY the values below — byte",
      "for byte, no paraphrasing, no improvising. Any field not listed here:",
      "leave it completely blank/untouched. Do NOT submit the form under any",
      "circumstances — when every listed field is filled and the CV is",
      "attached, stop and report.",
      "First Name: Kris",
      "Last Name: Shkodrani",
      "Email: someone@example.test",
      "Phone: +43 664 1234567",
      "LinkedIn Profile: https://www.linkedin.com/in/example",
      "Resume/CV: upload the file from this URL: http://127.0.0.1:8899/cv.pdf",
      "(If the file input is not visibly tagged, use inspect_hidden to reveal",
      "it, then call upload_file with that input's id and the URL above.)",
      'Contract style: select BOTH "Permanent" and "Freelance/B2B"',
      "Salary expectations: € 50,000 - 60,000",
      "Fill each field ONCE. A field that already shows your value is DONE.",
      "Cover Letter: " + "This is a long pasted cover letter body. ".repeat(40),
    ].join("\n");

    test("the take-6 kit shape qualifies (long, 2 URLs, each/BOTH phrasing)", () => {
      expect(kitPrompt.length).toBeGreaterThan(240); // over the tier-1 cap
      expect(qualifiesForDirectSingleNode(kitPrompt)).toBe(true);
    });

    test("field lines don't rescue a genuinely multi-step long prompt", () => {
      const multiStep =
        kitPrompt +
        "\nThen open the careers page, then compare both listings side by side.";
      expect(qualifiesForDirectSingleNode(multiStep)).toBe(false);
    });

    test("a long fill prompt WITHOUT field-value lines still routes to the planner", () => {
      const noLines =
        "Fill out this job application form using the details I gave you before. " +
        "Make sure everything is complete and accurate. ".repeat(20);
      expect(qualifiesForDirectSingleNode(noLines)).toBe(false);
    });

    test("beyond the 8K form-fill cap routes to the planner", () => {
      const huge = kitPrompt + "\nExtra Notes: " + "x".repeat(9000);
      expect(qualifiesForDirectSingleNode(huge)).toBe(false);
    });

    test("cross-item iteration still blocks even with field lines", () => {
      const iterative =
        "Fill in the form for every record in the queue.\n" +
        "First Name: A\nLast Name: B\nEmail: c@d.e\nPhone: 1";
      expect(qualifiesForDirectSingleNode(iterative)).toBe(false);
    });

    test("same-page iteration words no longer block short prompts either", () => {
      expect(
        qualifiesForDirectSingleNode(
          "Fill in each field of the form and check both options",
        ),
      ).toBe(true);
    });
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
