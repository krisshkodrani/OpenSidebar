import { describe, expect, test } from "vitest";
import "../setup";
import {
  buildFormStateCapturedEvidence,
  classifyFormSubmitDryRun,
  diffFormStateAgainstDraft,
  renderFormStateDiff,
} from "../../src/background/agent/mutation-dry-run-policy";
import type { FormStateCapture } from "../../src/types";
import type { FormFillFieldExpectation } from "../../src/background/agent/completion/kernel-types";

function capture(
  fields: Array<{ name: string; value: string }>,
  formKey = "/apply",
): FormStateCapture {
  return {
    formKey,
    fields: fields.map((f) => ({
      name: f.name,
      selector: `[name="${f.name}"]`,
      kind: "text",
      value: f.value,
      disabled: false,
    })),
    submitTargets: [{ label: "Submit", selector: "button" }],
  };
}

function expect_(
  fields: Array<{ label: string; value: string }>,
): FormFillFieldExpectation[] {
  return fields;
}

describe("diffFormStateAgainstDraft", () => {
  test("clean when every expected field matches", () => {
    const diff = diffFormStateAgainstDraft(
      capture([
        { name: "fullName", value: "Sam Rivera" },
        { name: "email", value: "sam@example.com" },
      ]),
      expect_([
        { label: "Full name", value: "Sam Rivera" },
        { label: "Email", value: "sam@example.com" },
      ]),
    );
    expect(diff.clean).toBe(true);
    expect(diff.entries.every((e) => e.status === "match")).toBe(true);
  });

  test("fuzzy-matches draft labels to camelCase field names", () => {
    const diff = diffFormStateAgainstDraft(
      capture([{ name: "emailAddress", value: "a@b.com" }]),
      expect_([{ label: "Email", value: "a@b.com" }]),
    );
    expect(diff.entries[0].status).toBe("match");
  });

  test("normalizes whitespace and case when comparing values", () => {
    const diff = diffFormStateAgainstDraft(
      capture([{ name: "city", value: "  New   York " }]),
      expect_([{ label: "City", value: "new york" }]),
    );
    expect(diff.clean).toBe(true);
  });

  test("flags a mismatched value (routes to approval)", () => {
    const diff = diffFormStateAgainstDraft(
      capture([{ name: "amount", value: "999" }]),
      expect_([{ label: "Amount", value: "100" }]),
    );
    expect(diff.clean).toBe(false);
    expect(diff.entries[0]).toMatchObject({
      status: "mismatch",
      expected: "100",
      actual: "999",
    });
  });

  test("flags a missing expected field", () => {
    const diff = diffFormStateAgainstDraft(
      capture([{ name: "fullName", value: "Sam" }]),
      expect_([{ label: "Invite code", value: "PN-4821" }]),
    );
    expect(diff.clean).toBe(false);
    expect(diff.entries[0]).toMatchObject({ status: "missing", actual: null });
  });

  test("extra captured fields (not expected) do not break a clean diff", () => {
    const diff = diffFormStateAgainstDraft(
      capture([
        { name: "fullName", value: "Sam" },
        { name: "marketingOptIn", value: "unchecked" },
        { name: "csrfToken", value: "xyz" },
      ]),
      expect_([{ label: "Full name", value: "Sam" }]),
    );
    expect(diff.clean).toBe(true);
  });

  test("diffHash is stable for equal diffs and differs on change", () => {
    const a = diffFormStateAgainstDraft(
      capture([{ name: "x", value: "1" }]),
      expect_([{ label: "X", value: "1" }]),
    );
    const b = diffFormStateAgainstDraft(
      capture([{ name: "x", value: "1" }]),
      expect_([{ label: "X", value: "1" }]),
    );
    const c = diffFormStateAgainstDraft(
      capture([{ name: "x", value: "2" }]),
      expect_([{ label: "X", value: "1" }]),
    );
    expect(a.diffHash).toBe(b.diffHash);
    expect(a.diffHash).not.toBe(c.diffHash);
  });

  test("buildFormStateCapturedEvidence keys by form:${formKey} and carries fields", () => {
    const ev = buildFormStateCapturedEvidence(
      capture([{ name: "fullName", value: "Sam" }], "/apply"),
      7,
    );
    expect(ev.type).toBe("form_state_captured");
    expect(ev.logicalKey).toBe("form:/apply");
    expect(ev.observedAtTurn).toBe(7);
    if (ev.type === "form_state_captured") {
      expect(ev.detail.formKey).toBe("/apply");
      expect(ev.detail.fields).toEqual([{ name: "fullName", value: "Sam" }]);
    }
  });

  test("classifyFormSubmitDryRun: no_draft when there is no capture or no draft", () => {
    expect(classifyFormSubmitDryRun(null, [{ label: "X", value: "1" }]).kind).toBe(
      "no_draft",
    );
    expect(classifyFormSubmitDryRun(capture([{ name: "x", value: "1" }]), []).kind).toBe(
      "no_draft",
    );
    expect(
      classifyFormSubmitDryRun(capture([{ name: "x", value: "1" }]), null).kind,
    ).toBe("no_draft");
  });

  test("classifyFormSubmitDryRun: clean when captured matches the draft", () => {
    const c = classifyFormSubmitDryRun(
      capture([{ name: "fullName", value: "Sam" }]),
      [{ label: "Full name", value: "Sam" }],
    );
    expect(c.kind).toBe("clean");
  });

  test("classifyFormSubmitDryRun: unexpected carries a rendered diff", () => {
    const c = classifyFormSubmitDryRun(
      capture([{ name: "amount", value: "999" }]),
      [{ label: "Amount", value: "100" }],
    );
    expect(c.kind).toBe("unexpected");
    if (c.kind === "unexpected") {
      expect(c.rendered).toContain("Amount");
      expect(c.rendered).toContain('"100"');
    }
  });

  test("renderFormStateDiff lists only the problem rows", () => {
    const diff = diffFormStateAgainstDraft(
      capture([{ name: "amount", value: "999" }]),
      expect_([
        { label: "Amount", value: "100" },
        { label: "Note", value: "hi" },
      ]),
    );
    const rendered = renderFormStateDiff(diff);
    expect(rendered).toContain("Amount");
    expect(rendered).toContain('"100"');
    expect(rendered).toContain('"999"');
    expect(rendered).toContain("Note");
  });
});
