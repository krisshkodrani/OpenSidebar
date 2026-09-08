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
    expect(cap.scope).toBe("primary_form");
    expect(cap.formCount).toBe(1);
    expect(cap.complete).toBe(true);
    expect(cap.limitations).toEqual([]);

    const byName = Object.fromEntries(cap.fields.map((f) => [f.name, f]));
    // hidden inputs are excluded
    expect(byName.secret).toBeUndefined();
    expect(byName.fullName).toMatchObject({
      kind: "text",
      value: "Sam Rivera",
      required: false,
      filled: true,
      valid: true,
    });
    expect(byName.terms).toMatchObject({ kind: "checkbox", value: "checked" });
    expect(byName.promo).toMatchObject({ kind: "checkbox", value: "unchecked" });
    expect(byName.plan).toMatchObject({ kind: "select", value: "pro" });
    expect(byName.plan.options).toEqual([
      { value: "pro", label: "Pro", selected: true },
    ]);
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

  test("document scope inventories controls across forms and reports completeness", async () => {
    document.body.innerHTML = `
      <form id="basic"><input name="name" required value="Kris" /></form>
      <form id="questions">
        <textarea name="motivation" required></textarea>
        <select name="location" required>
          <option value="">Choose one</option>
          <option value="eu">European Union</option>
        </select>
      </form>
      <input name="linkedin" value="https://www.linkedin.com/in/example" />
    `;

    const res = await executeAction(ToolName.EXTRACT_FORM_STATE, {
      scope: "document",
    });
    expect(res.success).toBe(true);
    const cap = JSON.parse(res.result) as FormStateCapture;

    expect(cap.scope).toBe("document");
    expect(cap.formCount).toBe(2);
    expect(cap.fields.map((field) => field.name)).toEqual([
      "name",
      "motivation",
      "location",
      "linkedin",
    ]);
    expect(cap.fields.find((field) => field.name === "motivation")).toMatchObject({
      required: true,
      filled: false,
      valid: false,
    });
    expect(cap.fields.find((field) => field.name === "location")).toMatchObject({
      required: true,
      filled: false,
      valid: false,
    });
  });
});
