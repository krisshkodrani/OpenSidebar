/** Conservative list actions grounded in visible tables and controls. */
import { ToolName } from "../../types";
import { chromeContentBridgePort } from "../environment/chrome";
import type { ToolRegistry } from "./registry";
import {
  APPLY_LIST_ACTION_DEF,
  APPLY_LIST_FILTER_DEF,
  APPLY_LIST_SORT_DEF,
} from "./definitions";

type PageResult = { ok: boolean; message: string };

async function runListAction<T>(
  tabId: number,
  fn: (input: T) => PageResult,
  input: T,
): Promise<string> {
  try {
    const frames = await chromeContentBridgePort.executeFunction(tabId, fn, [input], {
      allFrames: true,
      world: "MAIN",
    });
    const result = frames.map((frame) => frame.result as PageResult | undefined)
      .find((value) => value?.ok) ?? frames.map((frame) => frame.result as PageResult | undefined)
      .find((value) => value?.message);
    return result?.message || "Error: No visible list controls found.";
  } catch (error) {
    return `Error applying list action: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function registerListActionTools(toolRegistry: ToolRegistry): void {
  toolRegistry.register(ToolName.APPLY_LIST_FILTER, APPLY_LIST_FILTER_DEF, async (args, tabId) => {
    const legacyArgs = args as unknown as Record<string, unknown>;
    if (legacyArgs.table || legacyArgs.join) return "Error: Table selection and compound filters are unsupported. Use the visible page controls.";
    const conditions = Array.isArray(args.conditions) ? args.conditions : [];
    if (conditions.length !== 1) {
      return "Error: apply_list_filter supports one visible condition at a time on generic sites. Use the page controls for compound filters.";
    }
    const condition = conditions[0] as { field?: string; operator?: string; value?: string };
    const field = String(condition?.field || "").trim();
    const operator = String(condition?.operator || "is").trim().toLowerCase();
    const value = String(condition?.value ?? "");
    if (!field || !["is", "equals"].includes(operator)) {
      return "Error: Generic list filtering supports one visible field with an exact value. Use page controls for other operators.";
    }
    return runListAction(tabId, (input: { field: string; value: string; run: boolean }) => {
      const norm = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (el: Element) => Boolean((el as HTMLElement).getClientRects().length);
      const controls = [...document.querySelectorAll<HTMLInputElement>("input:not([type='hidden']), select, textarea")]
        .filter(visible);
      const matches = controls.filter((el) => {
        const id = el.id;
        const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
        const names = [label, el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("name")];
        return names.some((name) => norm(name) === norm(input.field) || norm(name).includes(norm(input.field)));
      });
      if (matches.length !== 1) return { ok: false, message: `Error: Expected one visible filter control for ${input.field}; found ${matches.length}.` };
      const control = matches[0];
      if (control instanceof HTMLSelectElement) {
        const option = [...control.options].find((item) => norm(item.textContent) === norm(input.value) || norm(item.value) === norm(input.value));
        if (!option) return { ok: false, message: `Error: Value ${input.value} is not a visible option for ${input.field}.` };
        control.value = option.value;
      } else {
        control.value = input.value;
      }
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      if (input.run) {
        const form = control.closest("form");
        const submit = form?.querySelector<HTMLElement>("button[type='submit'], input[type='submit']");
        if (submit && visible(submit)) submit.click();
        else if (form?.requestSubmit) form.requestSubmit();
      }
      return { ok: true, message: `Applied visible filter ${input.field} = ${input.value}; verify the resulting rows before completion.` };
    }, { field, value, run: args.run !== false });
  });

  toolRegistry.register(ToolName.APPLY_LIST_SORT, APPLY_LIST_SORT_DEF, async (args, tabId) => {
    if ((args as unknown as Record<string, unknown>).table) return "Error: Table selection is unsupported. Use the visible page controls.";
    const sorts = Array.isArray(args.sorts) ? args.sorts : [];
    if (sorts.length !== 1) return "Error: apply_list_sort supports one visible column at a time on generic sites.";
    const sort = sorts[0] as { field?: string; direction?: string };
    const field = String(sort?.field || "").trim();
    const direction = /^desc/i.test(String(sort?.direction || "")) ? "descending" : "ascending";
    if (!field) return "Error: apply_list_sort requires a field.";
    return runListAction(tabId, (input: { field: string; direction: string; run: boolean }) => {
      const norm = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const headers = [...document.querySelectorAll<HTMLElement>("th, [role='columnheader']")]
        .filter((el) => el.getClientRects().length > 0 && norm(el.textContent) === norm(input.field));
      if (headers.length !== 1) return { ok: false, message: `Error: Expected one visible column ${input.field}; found ${headers.length}.` };
      const header = headers[0];
      const current = header.getAttribute("aria-sort");
      if (current === input.direction) return { ok: true, message: `Column ${input.field} already reports ${input.direction} sort.` };
      if (!input.run) return { ok: true, message: `Visible column ${input.field} supports sorting; no click requested.` };
      const target = header.querySelector<HTMLElement>("button, a, [role='button']") || header;
      target.click();
      return { ok: true, message: `Clicked visible ${input.field} sort control. Requested ${input.direction}; verify aria-sort or row order before completion.` };
    }, { field, direction, run: args.run !== false });
  });

  toolRegistry.register(ToolName.APPLY_LIST_ACTION, APPLY_LIST_ACTION_DEF, async (args, tabId) => {
    const records = Array.isArray(args.records) ? args.records.map(String).filter(Boolean) : [];
    const action = String(args.action || "").trim();
    if (!records.length || !action) return "Error: apply_list_action requires records and an action.";
    const legacyArgs = args as unknown as Record<string, unknown>;
    if (legacyArgs.relatedRecord || legacyArgs.relatedField || legacyArgs.table || legacyArgs.confirm === true) {
      return "Error: Related-record fields, table selection, and automatic dialog confirmation are unsupported. Use visible page controls and verify the result.";
    }
    return runListAction(tabId, (input: { records: string[]; action: string }) => {
      const norm = (text: unknown) => String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const rows = [...document.querySelectorAll<HTMLElement>("tr, [role='row']")]
        .filter((row) => row.getClientRects().length > 0);
      const selected: HTMLElement[] = [];
      for (const record of input.records) {
        const matches = rows.filter((row) => norm(row.textContent).includes(norm(record)) && row.querySelector("input[type='checkbox']"));
        if (matches.length !== 1) return { ok: false, message: `Error: Expected one selectable row for ${record}; found ${matches.length}.` };
        if (selected.includes(matches[0])) return { ok: false, message: `Error: More than one record identifier matched the same visible row.` };
        selected.push(matches[0]);
      }
      const controls = [...document.querySelectorAll<HTMLElement>("button, a, [role='button']")]
        .filter((el) => el.getClientRects().length > 0 && norm(el.textContent || el.getAttribute("aria-label")) === norm(input.action));
      if (controls.length !== 1) return { ok: false, message: `Error: Expected one visible action ${input.action}; found ${controls.length}.` };
      for (const row of selected) {
        const checkbox = row.querySelector<HTMLInputElement>("input[type='checkbox']")!;
        if (!checkbox.checked) checkbox.click();
      }
      controls[0].click();
      return { ok: true, message: `Selected ${selected.length} visible row(s) and clicked ${input.action}. Inspect the resulting dialog or page before confirming completion.` };
    }, { records, action });
  });
}
