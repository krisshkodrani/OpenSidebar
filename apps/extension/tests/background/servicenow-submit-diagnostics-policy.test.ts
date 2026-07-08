import { describe, expect, it } from "vitest";
import {
  buildServiceNowSubmitDeferralMessage,
  extractServiceNowSubmitDiagnostic,
  isServiceNowSubmitHardRejected,
  isServiceNowSubmitRejected,
  isServiceNowSubmitStayedOnCreateForm,
} from "../../src/background/agent/servicenow/submit-diagnostics-policy";

describe("servicenow submit diagnostics policy", () => {
  const invalidUpdate =
    "Submit diagnostics:\n- Error Message Invalid update\nClicked submit control: Submit";
  const stayedOnly =
    "Clicked submit control: Submit\nsubmit did not leave the create form for INC0036113";
  const mandatory =
    "Submit diagnostics:\n- Missing mandatory fields: Short description";

  it("classifies a validation error as a hard rejection", () => {
    expect(isServiceNowSubmitHardRejected(invalidUpdate)).toBe(true);
    expect(isServiceNowSubmitHardRejected(mandatory)).toBe(true);
    expect(isServiceNowSubmitHardRejected("field cannot be blank")).toBe(true);
  });

  it("does NOT treat a transient 'stayed on the create form' as a hard rejection", () => {
    expect(isServiceNowSubmitHardRejected(stayedOnly)).toBe(false);
    expect(isServiceNowSubmitStayedOnCreateForm(stayedOnly)).toBe(true);
    // Still counts as a (soft) rejection worth one retry.
    expect(isServiceNowSubmitRejected(stayedOnly)).toBe(false);
  });

  it("extracts the ServiceNow error line for the handoff", () => {
    expect(extractServiceNowSubmitDiagnostic(invalidUpdate)).toContain(
      "Invalid update",
    );
  });

  it("builds a diagnose-don't-resubmit message on a hard rejection", () => {
    const msg = buildServiceNowSubmitDeferralMessage(invalidUpdate, true);
    expect(msg).toContain("ServiceNow rejected the submission");
    expect(msg).toContain("Resubmitting the same values will fail again");
    expect(msg).toContain("Invalid update");
    expect(msg).not.toContain(
      "submit the form with configure_servicenow_form({ submit: true })",
    );
  });

  it("keeps the verify-or-submit guidance for a merely-untrusted result", () => {
    const msg = buildServiceNowSubmitDeferralMessage(stayedOnly, false);
    expect(msg).toContain("did not get trusted submit evidence");
    expect(msg).toContain("configure_servicenow_form({ submit: true })");
  });
});
