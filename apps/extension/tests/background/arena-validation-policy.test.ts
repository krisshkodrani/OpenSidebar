import { describe, expect, it } from "vitest";
import {
  validateCheckoutOutcome,
  validateDianaSalaryAnswer,
  validateEnterpriseFormResult,
  validateKanbanColumns,
  validateProcurementOutcome,
  validateReleaseCoordinationReply,
  validateStagedApplication,
  validateSupportTriageComment,
  validateWorkspaceClarificationQuestion,
} from "../e2e/arena/validation-policy";

describe("Arena validation policy", () => {
  it("requires every requested enterprise form value", () => {
    const base = {
      name: "Jane Smith",
      email: "jane@example.com",
      category: "Enterprise",
      company: "Acme Corp",
      budget: "Premium ($50,000+)",
      refNumber: "REF-123",
    };

    expect(
      validateEnterpriseFormResult({
        ...base,
        phone: "x",
        requirements: "",
      }).ok,
    ).toBe(false);
    expect(
      validateEnterpriseFormResult({
        ...base,
        phone: "555-0123",
        requirements: "Priority support needed",
      }).ok,
    ).toBe(true);
  });

  it("requires Diana's exact salary in the final answer", () => {
    const state = { dianaFound: true, dianaSalary: "$65,386" };

    expect(validateDianaSalaryAnswer(state, "I found Diana.").ok).toBe(false);
    expect(
      validateDianaSalaryAnswer(state, "Diana Chen's salary is $65,386.").ok,
    ).toBe(true);
  });

  it("does not mistake procurement checkboxes for purchases", () => {
    expect(
      validateProcurementOutcome({
        checked: ["item-1", "item-2"],
        stores: [],
      }).ok,
    ).toBe(false);

    expect(
      validateProcurementOutcome({
        checked: ["item-1", "item-2"],
        stores: [
          {
            slug: "techdirect",
            orderPlaced: true,
            cart: [{ productId: "td-kb-1", qty: 2, price: 79.99 }],
          },
          {
            slug: "officehub",
            orderPlaced: true,
            cart: [{ productId: "oh-mat-1", qty: 1, price: 39.99 }],
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      validateProcurementOutcome({
        checked: ["item-1", "item-2"],
        stores: [
          {
            slug: "techdirect",
            orderPlaced: true,
            cart: [
              { productId: "td-kb-1", qty: 2, price: 79.99 },
              { productId: "td-mouse-1", qty: 1, price: 34.99 },
            ],
          },
          {
            slug: "officehub",
            orderPlaced: true,
            cart: [{ productId: "oh-mat-1", qty: 1, price: 39.99 }],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("requires an actual release-timing answer", () => {
    expect(
      validateReleaseCoordinationReply(
        "Alice should draft the changelog. Onboarding is the remaining blocker.",
      ).ok,
    ).toBe(false);
    expect(
      validateReleaseCoordinationReply(
        "Wednesday is the release target. Alice should draft the changelog; onboarding remains the blocker.",
      ).ok,
    ).toBe(false);
    expect(
      validateReleaseCoordinationReply(
        "The release date is not confirmed; it depends on the onboarding edge cases expected to finish Wednesday. Alice, as release owner, should draft the changelog.",
      ).ok,
    ).toBe(true);
  });

  it("scores the current Kanban columns rather than move history", () => {
    expect(
      validateKanbanColumns({
        "in-progress": ["Write Tests", "Code Review"],
      }).ok,
    ).toBe(false);
    expect(
      validateKanbanColumns({
        "in-progress": [
          "Write Tests",
          "Code Review",
          "Write API Docs",
          "Setup CI Pipeline",
        ],
      }).ok,
    ).toBe(true);
  });

  it("requires the requested checkout size and a single item", () => {
    const order = {
      shippingMethod: "standard",
      coupon: "SAVE10",
      email: "alex@example.com",
      items: [{ id: "novablast-4", size: 9, qty: 1 }],
    };

    expect(validateCheckoutOutcome(order, 1).ok).toBe(false);
    expect(
      validateCheckoutOutcome(
        { ...order, items: [{ id: "novablast-4", size: 10, qty: 1 }] },
        1,
      ).ok,
    ).toBe(true);
  });

  it("requires every exact staged-application field and grounded writing", () => {
    const completeDraft = {
      name: "Jordan Reyes",
      email: "jordan.reyes@example.com",
      linkedIn: "https://www.linkedin.com/in/jordanreyes",
      phone: "+1 555 010 0199",
      currentLocation: "Denver, CO",
      euWorkPermit: "No",
      salaryExpectation: "$120,000–$160,000 depending on role",
      earliestStartDate: "2026-08-03",
      whyLangfuse:
        "Nextera's analytics dashboards match the customer-facing systems I enjoy building. I care about applying my GraphQL experience to accessible enterprise products.",
      resumeName: "",
      submitted: false,
    };

    expect(
      validateStagedApplication({
        jobId: "sr-fe-1",
        draft: { ...completeDraft, linkedIn: "", phone: "" },
        hasResult: false,
      }).ok,
    ).toBe(false);
    expect(
      validateStagedApplication({
        jobId: "sr-fe-1",
        draft: completeDraft,
        hasResult: false,
      }).ok,
    ).toBe(true);
  });

  it("requires a real workspace clarification request", () => {
    expect(validateWorkspaceClarificationQuestion("I need more time.").ok).toBe(
      false,
    );
    expect(
      validateWorkspaceClarificationQuestion(
        "Which workspace should I open, Alpha or Beta?",
      ).ok,
    ).toBe(true);
  });

  it("requires both the support issue and a next step", () => {
    expect(validateSupportTriageComment("CSV export timeout.").ok).toBe(false);
    expect(
      validateSupportTriageComment(
        "CSV exports time out; next, engineering will investigate the logs.",
      ).ok,
    ).toBe(true);
  });
});
