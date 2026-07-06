import { describe, test, expect, beforeEach } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { executeAction } from "../../src/content/actions";
import type { FormStateCapture } from "../../src/types";

async function capture(id?: number): Promise<FormStateCapture> {
  const res = await executeAction(
    ToolName.EXTRACT_FORM_STATE,
    id == null ? {} : { id },
  );
  expect(res.success).toBe(true);
  expect(res.navigated).toBe(false);
  return JSON.parse(res.result) as FormStateCapture;
}

describe("extract_form_state content action", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("captures fields, values, disabled state, and submit targets of the primary form", async () => {
    document.body.innerHTML = `
      <form id="registration" action="/partner-registration">
        <input name="fullName" type="text" value="Sam Rivera" />
        <input name="email" type="email" value="sam@example.com" />
        <input name="terms" type="checkbox" checked />
        <input name="promo" type="checkbox" />
        <select name="plan"><option value="pro" selected>Pro</option></select>
        <textarea name="notes" disabled>hi</textarea>
        <input name="secret" type="hidden" value="x" />
        <button type="submit">Register</button>
      </form>
    `;

    const cap = await capture();
    expect(cap.formKey).toBe("/partner-registration");

    const byName = Object.fromEntries(cap.fields.map((f) => [f.name, f]));
    // hidden inputs are excluded
    expect(byName.secret).toBeUndefined();
    expect(byName.fullName).toMatchObject({ kind: "text", value: "Sam Rivera" });
    expect(byName.terms).toMatchObject({ kind: "checkbox", value: "checked" });
    expect(byName.promo).toMatchObject({ kind: "checkbox", value: "unchecked" });
    expect(byName.plan).toMatchObject({ kind: "select", value: "pro" });
    expect(byName.notes).toMatchObject({ kind: "textarea", disabled: true });
    expect(byName.fullName.selector).toBe('input[name="fullName"]');

    expect(cap.submitTargets).toEqual([
      { label: "Register", selector: "button" },
    ]);
  });

  test("falls back to the page path as formKey when the form has no action/id/name", async () => {
    document.body.innerHTML = `<form><input name="q" value="hi" /></form>`;
    const cap = await capture();
    expect(cap.formKey).toBe(location.pathname);
    expect(cap.fields).toHaveLength(1);
  });

  test("with no form on the page, scans the whole document", async () => {
    document.body.innerHTML = `<input name="loose" value="v" />`;
    const cap = await capture();
    expect(cap.fields.map((f) => f.name)).toContain("loose");
  });
});
