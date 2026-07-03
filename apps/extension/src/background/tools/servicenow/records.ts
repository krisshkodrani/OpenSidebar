/**
 * ServiceNow adapter — record resolution and native form submit.
 *
 * Grounded in stable platform semantics: table record URLs, sys_id
 * lookup by identity fields, native submit retry, and submit
 * diagnostics collection. Consumed by the configure_servicenow_form
 * tool executor.
 *
 * Import-direction rule: servicenow/* must never import "../index" or
 * the "../tools" barrel — only ../helpers and concrete siblings.
 */

import { withTimeout } from "../helpers";

export const CONFIGURE_SERVICENOW_FORM_SCRIPT_TIMEOUT_MS = 25_000;
export const SERVICENOW_RECORD_LOOKUP_TIMEOUT_MS = 12_000;

export async function resolveServiceNowRecordUrl(
  tabId: number,
  tableName: string,
  recordNumber: string,
): Promise<string | null> {
  if (
    !/^[a-z0-9_]+$/i.test(tableName) ||
    !/^[A-Z]{2,}\d+$/i.test(recordNumber)
  ) {
    return null;
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN" as any,
      func: async (input: { tableName: string; recordNumber: string }) => {
        const isServiceNowHost =
          location.hostname.endsWith(".service-now.com") ||
          location.hostname.endsWith(".servicenow.com");
        if (!isServiceNowHost) return null;
        const params = new URLSearchParams({
          sysparm_query: `number=${input.recordNumber}`,
          sysparm_fields: "sys_id,number",
          sysparm_limit: "1",
        });
        const headers: Record<string, string> = { Accept: "application/json" };
        const token = String((window as any).g_ck || "");
        if (token) headers["X-UserToken"] = token;
        const response = await fetch(
          `/api/now/table/${encodeURIComponent(input.tableName)}?${params.toString()}`,
          { credentials: "same-origin", headers },
        );
        if (!response.ok) return null;
        const payload = await response.json();
        const record = Array.isArray(payload?.result)
          ? payload.result[0]
          : null;
        const sysId =
          typeof record?.sys_id === "string"
            ? record.sys_id
            : typeof record?.sys_id?.value === "string"
              ? record.sys_id.value
              : "";
        if (!sysId) return null;
        const target = `${input.tableName}.do?sys_id=${sysId}`;
        return `${location.origin}/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
      },
      args: [{ tableName, recordNumber: recordNumber.toUpperCase() }],
    });
    return (
      results
        .map((result) => result.result)
        .find(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ) ?? null
    );
  } catch {
    return null;
  }
}

export async function serviceNowRecordExistsBySysId(
  tabId: number,
  tableName: string,
  sysId: string,
): Promise<boolean> {
  if (
    !/^[a-z0-9_]+$/i.test(tableName) ||
    !/^[0-9a-f]{32}$/i.test(sysId)
  ) {
    return false;
  }
  try {
    const results = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN" as any,
        func: async (input: { tableName: string; sysId: string }) => {
          const isServiceNowHost =
            location.hostname.endsWith(".service-now.com") ||
            location.hostname.endsWith(".servicenow.com");
          if (!isServiceNowHost) return false;
          const params = new URLSearchParams({
            sysparm_query: `sys_id=${input.sysId}`,
            sysparm_fields: "sys_id",
            sysparm_limit: "1",
          });
          const headers: Record<string, string> = {
            Accept: "application/json",
          };
          const token = String((window as any).g_ck || "");
          if (token) headers["X-UserToken"] = token;
          const response = await fetch(
            `/api/now/table/${encodeURIComponent(input.tableName)}?${params.toString()}`,
            { credentials: "same-origin", headers },
          );
          if (!response.ok) return false;
          const payload = await response.json();
          const record = Array.isArray(payload?.result)
            ? payload.result[0]
            : null;
          const foundSysId =
            typeof record?.sys_id === "string"
              ? record.sys_id
              : typeof record?.sys_id?.value === "string"
                ? record.sys_id.value
                : "";
          return foundSysId.toLowerCase() === input.sysId.toLowerCase();
        },
        args: [{ tableName, sysId: sysId.toLowerCase() }],
      }),
      SERVICENOW_RECORD_LOOKUP_TIMEOUT_MS,
      "ServiceNow sys_id lookup",
    );
    return results.some((result) => result.result === true);
  } catch {
    return false;
  }
}

export type ServiceNowSubmittedRecordField = {
  name: string;
  label: string;
  value: string;
};

export type ServiceNowRecordLookupOptions = {
  attempts?: number;
  delayMs?: number;
  timeoutMs?: number;
};

export function hasServiceNowIdentityFields(
  fields: ServiceNowSubmittedRecordField[],
): boolean {
  return fields.some((field) => {
    if (!/^[a-z0-9_]+$/i.test(field.name) || !field.value.trim()) {
      return false;
    }
    const identity = `${field.name} ${field.label}`;
    return /\b(?:user[_\s-]*name|user\s*id|serial[_\s-]*number|asset[_\s-]*tag|email)\b/i.test(
      identity,
    );
  });
}

export async function resolveServiceNowRecordSysIdByFields(
  tabId: number,
  tableName: string,
  fields: ServiceNowSubmittedRecordField[],
  options: ServiceNowRecordLookupOptions = {},
): Promise<string | null> {
  if (!/^[a-z0-9_]+$/i.test(tableName)) return null;
  const identityFields = fields
    .map((field) => ({
      name: String(field.name || "").trim(),
      label: String(field.label || "").trim(),
      value: String(field.value || "").trim(),
    }))
    .filter((field) => {
      if (!/^[a-z0-9_]+$/i.test(field.name) || !field.value) return false;
      const identity = `${field.name} ${field.label}`;
      return /\b(?:user[_\s-]*name|user\s*id|serial[_\s-]*number|asset[_\s-]*tag|email)\b/i.test(
        identity,
      );
    });
  if (identityFields.length === 0) return null;

  try {
    const results = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN" as any,
        func: async (input: {
          tableName: string;
          fields: ServiceNowSubmittedRecordField[];
          attempts: number;
          delayMs: number;
        }) => {
          const isServiceNowHost =
            location.hostname.endsWith(".service-now.com") ||
            location.hostname.endsWith(".servicenow.com");
          if (!isServiceNowHost) return null;
          const delay = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
          const headers: Record<string, string> = {
            Accept: "application/json",
          };
          const token = String((window as any).g_ck || "");
          if (token) headers["X-UserToken"] = token;
          const attempts = Math.max(1, Math.min(20, input.attempts || 16));
          const delayMs = Math.max(0, Math.min(1000, input.delayMs || 500));
          for (let attempt = 0; attempt < attempts; attempt++) {
            for (const field of input.fields) {
              const cleanValue = field.value.replace(/\^/g, "");
              const params = new URLSearchParams({
                sysparm_query: `${field.name}=${cleanValue}^ORDERBYDESCsys_created_on`,
                sysparm_fields: `sys_id,${field.name},sys_created_on`,
                sysparm_limit: "1",
              });
              const response = await fetch(
                `/api/now/table/${encodeURIComponent(input.tableName)}?${params.toString()}`,
                { credentials: "same-origin", headers },
              );
              if (!response.ok) continue;
              const payload = await response.json();
              const record = Array.isArray(payload?.result)
                ? payload.result[0]
                : null;
              const sysId =
                typeof record?.sys_id === "string"
                  ? record.sys_id
                  : typeof record?.sys_id?.value === "string"
                    ? record.sys_id.value
                    : "";
              if (/^[0-9a-f]{32}$/i.test(sysId)) return sysId.toLowerCase();
            }
            if (attempt < attempts - 1 && delayMs > 0) {
              await delay(delayMs);
            }
          }
          return null;
        },
        args: [
          {
            tableName,
            fields: identityFields,
            attempts: options.attempts ?? 16,
            delayMs: options.delayMs ?? 500,
          },
        ],
      }),
      options.timeoutMs ?? SERVICENOW_RECORD_LOOKUP_TIMEOUT_MS,
      "ServiceNow identity-field lookup",
    );
    return (
      results
        .map((result) => result.result)
        .find(
          (value): value is string =>
            typeof value === "string" && /^[0-9a-f]{32}$/i.test(value),
        ) ?? null
    );
  } catch {
    return null;
  }
}

export type ServiceNowNativeSubmitRetryResult = {
  ok: boolean;
  method?: string;
  actionName?: string;
  submittedSysId?: string;
  reason?: string;
};

export async function retryServiceNowNativeSubmit(
  tabId: number,
  target: { tabId: number; frameIds?: number[] },
  preferredActionName: string,
): Promise<ServiceNowNativeSubmitRetryResult | null> {
  try {
    const results = await withTimeout(
      chrome.scripting.executeScript({
        target,
        world: "MAIN" as any,
        func: (input: { actionName: string }) => {
          const gForm = (window as any).g_form;
          const isServiceNowHost =
            location.hostname.endsWith(".service-now.com") ||
            location.hostname.endsWith(".servicenow.com");
          if (!isServiceNowHost || !gForm) {
            return {
              ok: false,
              reason: "not_servicenow_form_frame",
            };
          }

          const escapeCss = (value: string) =>
            (window as any).CSS?.escape
              ? (window as any).CSS.escape(value)
              : value.replace(/["\\]/g, "\\$&");
          const currentSysId = () => {
            try {
              const sysId = String(gForm.getUniqueValue?.() || "");
              if (/^[0-9a-f]{32}$/i.test(sysId)) return sysId.toLowerCase();
            } catch {
              // Fall back to controls below.
            }
            const tableName = (() => {
              try {
                return String(gForm.getTableName?.() || "");
              } catch {
                return "";
              }
            })();
            const candidates = [
              tableName ? `${tableName}.sys_id` : "",
              "sys_uniqueValue",
              "sys_id",
            ].filter(Boolean);
            for (const name of candidates) {
              const control = document.querySelector(
                `[name="${escapeCss(name)}"], #${escapeCss(name)}`,
              ) as HTMLInputElement | null;
              const value = String(control?.value || "");
              if (/^[0-9a-f]{32}$/i.test(value)) return value.toLowerCase();
            }
            return "";
          };
          const actionNameFor = (control: HTMLElement | null) => {
            if (!control) return "";
            const candidates = [
              control.getAttribute("name"),
              control.getAttribute("value"),
              control.getAttribute("id"),
              control.getAttribute("data-action-name"),
            ].filter((value): value is string => Boolean(value));
            return (
              candidates.find((value) =>
                /\b(?:sysverb_insert|sysverb_update|sysverb_save|sysverb_submit)\b/i.test(
                  value,
                ),
              ) ||
              candidates.find((value) => /\bsysverb_/i.test(value)) ||
              ""
            );
          };
          const submitControl = Array.from(
            document.querySelectorAll(
              "button, input[type='submit'], input[type='button'], [role='button']",
            ),
          ).find((control): control is HTMLElement => {
            if (!(control instanceof HTMLElement)) return false;
            const actionName = actionNameFor(control);
            if (actionName) return true;
            const text = [
              control.textContent,
              control.getAttribute("value"),
              control.getAttribute("aria-label"),
              control.getAttribute("title"),
              control.getAttribute("id"),
              control.getAttribute("name"),
            ]
              .filter(Boolean)
              .join(" ");
            return /\b(submit|save|update|insert)\b/i.test(text);
          });
          const actionName =
            (/^sysverb_[a-z0-9_]+$/i.test(input.actionName)
              ? input.actionName
              : "") ||
            actionNameFor(submitControl ?? null) ||
            "sysverb_insert";
          const formElement =
            gForm.getFormElement?.() ||
            submitControl?.closest("form") ||
            document.querySelector("form");

          if (
            typeof (window as any).gsftSubmit === "function" &&
            formElement
          ) {
            try {
              (window as any).gsftSubmit(null, formElement, actionName);
              return {
                ok: true,
                method: "gsftSubmit",
                actionName,
                submittedSysId: currentSysId(),
              };
            } catch {
              // Fall back to g_form.submit below.
            }
          }

          if (typeof gForm.submit === "function") {
            try {
              gForm.submit(actionName);
              return {
                ok: true,
                method: "g_form.submit",
                actionName,
                submittedSysId: currentSysId(),
              };
            } catch {
              // Report a generic unavailable fallback below.
            }
          }

          return {
            ok: false,
            reason: "servicenow_submit_api_unavailable",
          };
        },
        args: [{ actionName: preferredActionName }],
      }),
      5_000,
      "ServiceNow native submit retry",
    );
    return (
      results
        .map((result) => result.result as ServiceNowNativeSubmitRetryResult)
        .find((result) => result?.ok === true) ||
      results
        .map((result) => result.result as ServiceNowNativeSubmitRetryResult)
        .find((result) => result && result.reason !== "not_servicenow_form_frame") ||
      null
    );
  } catch {
    return null;
  }
}

export function serviceNowRecordUrlForSysId(
  baseUrl: string,
  tableName: string,
  sysId: string,
): string {
  if (
    !/^[a-z0-9_]+$/i.test(tableName) ||
    !/^[0-9a-f]{32}$/i.test(sysId)
  ) {
    return "";
  }
  try {
    const origin = new URL(baseUrl).origin;
    const target = `${tableName}.do?sys_id=${sysId.toLowerCase()}`;
    return `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
  } catch {
    return "";
  }
}

export async function collectServiceNowSubmitDiagnostics(
  tabId: number,
): Promise<string[]> {
  try {
    const results = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN" as any,
        func: () => {
          const gForm = (window as any).g_form;
          const isServiceNowContext =
            Boolean(gForm) ||
            location.hostname.endsWith(".service-now.com") ||
            location.hostname.endsWith(".servicenow.com");
          if (!isServiceNowContext) return null;

          const cleanText = (value: unknown): string =>
            String(value ?? "")
              .replace(/\s+/g, " ")
              .trim();
          const lines: string[] = [];
          const addLine = (value: unknown) => {
            const text = cleanText(value);
            if (!text || text.length > 240) return;
            if (!lines.some((line) => line.toLowerCase() === text.toLowerCase())) {
              lines.push(text);
            }
          };
          const escapeCss = (value: string) => {
            try {
              return CSS.escape(value);
            } catch {
              return value.replace(/["\\]/g, "\\$&");
            }
          };
          const fieldName = (value: unknown): string =>
            cleanText(value).replace(/^[a-z0-9_]+\./i, "");
          const labelForField = (name: string): string => {
            const cleanName = fieldName(name);
            try {
              const label = cleanText(gForm?.getLabelOf?.(cleanName));
              if (label) return `${label} (${cleanName})`;
            } catch {
              // Fall through to DOM labels.
            }
            const selectors = [
              `[for="${escapeCss(name)}"]`,
              `[for="${escapeCss(cleanName)}"]`,
              `[for$=".${escapeCss(cleanName)}"]`,
            ];
            for (const selector of selectors) {
              const label = document.querySelector(selector);
              const text = cleanText(label?.textContent);
              if (text) return `${text} (${cleanName})`;
            }
            return cleanName || name;
          };
          const valueForField = (name: string): string => {
            const cleanName = fieldName(name);
            try {
              const value = cleanText(gForm?.getValue?.(cleanName));
              if (value) return value;
            } catch {
              // Fall through to DOM controls.
            }
            try {
              const displayBox = gForm?.getDisplayBox?.(cleanName);
              const displayValue = cleanText(displayBox?.value);
              if (displayValue) return displayValue;
            } catch {
              // Fall through to DOM controls.
            }
            try {
              const control = gForm?.getControl?.(cleanName);
              const value = cleanText(control?.value);
              if (value) return value;
            } catch {
              // Fall through to selectors.
            }
            const control = document.querySelector(
              [
                `[name="${escapeCss(name)}"]`,
                `[name$=".${escapeCss(cleanName)}"]`,
                `#${escapeCss(name)}`,
                `#${escapeCss(cleanName)}`,
              ].join(", "),
            ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
            return cleanText(control?.value);
          };
          const missingFields: string[] = [];
          const addMissingField = (value: unknown) => {
            const name = fieldName(value);
            if (!name) return;
            const label = labelForField(name);
            if (
              !missingFields.some(
                (field) => field.toLowerCase() === label.toLowerCase(),
              )
            ) {
              missingFields.push(label);
            }
          };

          try {
            const missing = gForm?.getMissingFields?.();
            if (Array.isArray(missing)) {
              for (const field of missing) addMissingField(field);
            } else if (typeof missing === "string") {
              for (const field of missing.split(/[,;\n]+/)) {
                addMissingField(field);
              }
            }
          } catch {
            // Some ServiceNow forms expose getMissingFields only after submit.
          }

          try {
            const fieldNames = Array.isArray(gForm?.getFieldNames?.())
              ? gForm.getFieldNames()
              : [];
            for (const name of fieldNames) {
              let mandatory = false;
              try {
                mandatory = Boolean(gForm?.isMandatory?.(name));
              } catch {
                mandatory = false;
              }
              if (!mandatory) continue;
              const value = valueForField(name);
              if (!value || /^--\s*none\s*--$/i.test(value)) {
                addMissingField(name);
              }
            }
          } catch {
            // DOM messages still provide useful diagnostics below.
          }

          if (missingFields.length) {
            addLine(`Missing mandatory fields: ${missingFields.join(", ")}`);
          }

          const messageSelectors = [
            ".outputmsg_text",
            ".outputmsg",
            ".notification",
            ".notification-message",
            ".fieldmsg",
            "[role='alert']",
            ".form_message",
            ".message",
            ".error",
          ].join(",");
          for (const node of Array.from(
            document.querySelectorAll(messageSelectors),
          )) {
            const text = cleanText(node.textContent);
            if (
              /\b(?:mandatory|required|invalid|error|not filled|cannot be blank|must be filled|please enter|not submitted)\b/i.test(
                text,
              )
            ) {
              addLine(text);
            }
          }

          const bodyLines = cleanText(document.body?.innerText || "")
            .split(/(?<=[.!?])\s+|\n+/)
            .slice(0, 80);
          for (const text of bodyLines) {
            if (
              /\b(?:mandatory|required|invalid|not filled|cannot be blank|must be filled|please enter|not submitted)\b/i.test(
                text,
              )
            ) {
              addLine(text);
            }
          }

          return lines.slice(0, 8);
        },
        args: [],
      }),
      3_000,
      "ServiceNow submit diagnostics",
    );
    return results
      .flatMap((result) => (Array.isArray(result.result) ? result.result : []))
      .filter((value): value is string => typeof value === "string")
      .filter((value, index, all) => {
        const lower = value.toLowerCase();
        return all.findIndex((candidate) => candidate.toLowerCase() === lower) === index;
      })
      .slice(0, 8);
  } catch {
    return [];
  }
}
