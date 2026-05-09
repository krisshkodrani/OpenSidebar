import { toolRegistry } from "./registry";
import {
  DomSnapshot,
  EvidenceEvent,
  ToolName,
  MessageSource,
  TaggedElement,
  UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { sanitizeUrl } from "../security";
import {
  resolveProfileFields,
  resolveProfileFile,
} from "../infrastructure/backend-client";
import { isUsableTabUrl } from "../infrastructure/tab-resolution";
import { workspaceManager } from "../workspaces/manager";
import {
  clearTabReady,
  ensureContentScript,
  waitForContentScriptReady,
  waitForDomReady,
} from "../tab-ready";
import {
  CLICK_DEF,
  TYPE_TEXT_DEF,
  SCROLL_PAGE_DEF,
  READ_PAGE_DEF,
  NAVIGATE_DEF,
  OPEN_SERVICENOW_MODULE_DEF,
  SEARCH_KNOWLEDGE_BASE_DEF,
  CREATE_TAB_DEF,
  CLOSE_TAB_DEF,
  SWITCH_TAB_DEF,
  WAIT_DEF,
  DONE_DEF,
  HOVER_ELEMENT_DEF,
  FIND_ELEMENT_DEF,
  SELECT_OPTION_DEF,
  PRESS_KEY_DEF,
  DRAG_AND_DROP_DEF,
  HIDE_ELEMENT_DEF,
  DISMISS_OVERLAYS_DEF,
  ESCALATE_DEF,
  CLARIFY_DEF,
  READ_ELEMENT_DEF,
  EXECUTE_JS_DEF,
  UPLOAD_FILE_DEF,
  GO_BACK_DEF,
  LIST_TABS_DEF,
  RIGHT_CLICK_DEF,
  SET_CHECKBOX_DEF,
  CLICK_COORDINATES_DEF,
  DOWNLOAD_FILE_DEF,
  GET_COOKIES_DEF,
  SET_COOKIE_DEF,
  DELETE_COOKIE_DEF,
  SEARCH_HISTORY_DEF,
  INSPECT_HIDDEN_DEF,
  INSPECT_CHART_DEF,
  INSPECT_TABLE_DEF,
  INSPECT_FILTER_STATE_DEF,
  APPLY_LIST_FILTER_DEF,
  APPLY_LIST_SORT_DEF,
  INSPECT_CATALOG_ITEM_DEF,
  CONFIGURE_CATALOG_ITEM_DEF,
  CONFIGURE_SERVICENOW_FORM_DEF,
  XRAY_PAGE_DEF,
  UPDATE_NOTES_DEF,
  GET_PROFILE_FIELDS_DEF,
  CREATE_WINDOW_DEF,
  UPDATE_PLAN_DEF,
} from "./definitions";
import {
  formatUnknownError,
  executeContentTool,
  waitForNavigation,
} from "./bridge";

// Re-export submodules for barrel compatibility
export * from "./registry";
export * from "./definitions";
export * from "./bridge";

function getTabUrl(tab: chrome.tabs.Tab): string {
  return tab.url || tab.pendingUrl || "";
}

function formatControllableTabLines(tabs: chrome.tabs.Tab[]): string[] {
  const controllableTabs = tabs.filter((tab) => isUsableTabUrl(getTabUrl(tab)));
  const omittedCount = tabs.length - controllableTabs.length;

  if (controllableTabs.length === 0) {
    return omittedCount > 0
      ? [
          "No controllable web tabs are open. Internal browser or extension tabs were omitted because page tools cannot run there.",
        ]
      : ["No open tabs."];
  }

  const lines = controllableTabs.map(
    (tab) =>
      `Tab ${tab.id}: "${tab.title || "(untitled)"}" - ${getTabUrl(tab) || "about:blank"}${tab.active ? " [active]" : ""}`,
  );
  if (omittedCount > 0) {
    lines.push(
      `Note: ${omittedCount} internal browser/extension tab${omittedCount === 1 ? "" : "s"} omitted because page tools cannot run there.`,
    );
  }
  return lines;
}

async function getAllowedNavigationOrigins(): Promise<string[]> {
  try {
    const stored = await chrome.storage.sync.get("userSettings");
    const settings = (stored.userSettings ?? {}) as UserSettings;
    return Array.isArray(settings.allowedNavigationOrigins)
      ? settings.allowedNavigationOrigins.filter(
          (origin): origin is string => typeof origin === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function navigationBoundaryError(
  target: string,
  allowedOrigins: string[],
): string {
  return (
    `Error: External navigation blocked for this task. Target ${target} is outside ` +
    `the allowed origin${allowedOrigins.length === 1 ? "" : "s"}: ${allowedOrigins.join(", ")}. ` +
    "Stay in the current application and use in-page navigation, application search, or a direct URL on the allowed origin."
  );
}

async function waitForTabUrlChange(
  tabId: number,
  previousUrl: string | undefined,
  timeoutMs = 2500,
): Promise<string | null> {
  const isTransientUrl = (url: string): boolean =>
    !url || url === "about:blank" || url.startsWith("chrome://newtab");

  const startedAt = Date.now();
  let fallbackUrl: string | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const currentUrl = tab.url || "";
      if (currentUrl && currentUrl !== (previousUrl || "")) {
        if (!isTransientUrl(currentUrl)) {
          return currentUrl;
        }
        fallbackUrl = currentUrl;
      }
    } catch {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return fallbackUrl;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const CONFIGURE_SERVICENOW_FORM_SCRIPT_TIMEOUT_MS = 25_000;
const SERVICENOW_RECORD_LOOKUP_TIMEOUT_MS = 12_000;
const APPLY_LIST_FILTER_SCRIPT_TIMEOUT_MS = 25_000;

async function tryInPageHistoryBack(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as any,
    func: () => {
      window.history.back();
    },
  });
}

async function resolveServiceNowRecordUrl(
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

async function serviceNowRecordExistsBySysId(
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

type ServiceNowSubmittedRecordField = {
  name: string;
  label: string;
  value: string;
};

type ServiceNowRecordLookupOptions = {
  attempts?: number;
  delayMs?: number;
  timeoutMs?: number;
};

function hasServiceNowIdentityFields(
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

async function resolveServiceNowRecordSysIdByFields(
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

type ServiceNowNativeSubmitRetryResult = {
  ok: boolean;
  method?: string;
  actionName?: string;
  submittedSysId?: string;
  reason?: string;
};

async function retryServiceNowNativeSubmit(
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

function serviceNowRecordUrlForSysId(
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

async function collectServiceNowSubmitDiagnostics(
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

async function getFrameIdsForMainWorldBridge(tabId: number): Promise<number[]> {
  try {
    if (!chrome.webNavigation?.getAllFrames) return [0];
    const frames = await new Promise<any[]>((resolve) => {
      chrome.webNavigation.getAllFrames({ tabId }, (details) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(details) ? details : []);
      });
    });
    const frameIds = frames
      .map((frame) => frame?.frameId)
      .filter((frameId): frameId is number => Number.isInteger(frameId));
    return [...new Set([0, ...frameIds])];
  } catch {
    return [0];
  }
}

const SERVICENOW_REFERENCE_CANDIDATE_PREFIX = "servicenow_reference_candidate:";

type ServiceNowReferenceCandidate = {
  fieldPath: string;
  fieldName: string;
  referenceTable: string;
};

type ServiceNowModuleRecord = {
  sysId: string;
  title: string;
  application: string;
  name: string;
  table: string;
  linkType: string;
  targetHints: string[];
  raw: Record<string, unknown>;
};

type ResolvedServiceNowModule = {
  ok: true;
  module: ServiceNowModuleRecord;
  target: string;
  targetUrl: string;
  candidateCount: number;
  score: number;
  candidates: ServiceNowModuleRecord[];
};

type ServiceNowModuleResolutionFailure = {
  ok: false;
  reason: string;
  candidateCount?: number;
  candidates?: ServiceNowModuleRecord[];
};

type ServiceNowNavigatorCandidateResult =
  | {
      ok: true;
      query: string;
      candidateText: string;
      href: string;
      target: string | null;
      targetUrl: string | null;
      frameId: number;
      elementTag?: number;
    }
  | { ok: false; reason: string };

type ServiceNowCurrentModuleMatch =
  | {
      ok: true;
      title: string;
      url: string;
      target: string;
      matchedBy: string[];
    }
  | { ok: false; reason: string };

type ServiceNowSnapshotElementCandidate = {
  element: TaggedElement;
  label: string;
  href: string;
  score: number;
};

type TimedServiceNowResult<T> = {
  value?: T;
  error?: string;
  durationMs: number;
};

function parseServiceNowReferenceCandidate(
  status: string | undefined,
): ServiceNowReferenceCandidate | null {
  if (!status?.startsWith(SERVICENOW_REFERENCE_CANDIDATE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      status.slice(SERVICENOW_REFERENCE_CANDIDATE_PREFIX.length),
    ) as Partial<ServiceNowReferenceCandidate>;
    if (
      typeof parsed.fieldPath === "string" &&
      typeof parsed.fieldName === "string" &&
      typeof parsed.referenceTable === "string" &&
      parsed.fieldPath &&
      parsed.fieldName &&
      parsed.referenceTable
    ) {
      return {
        fieldPath: parsed.fieldPath,
        fieldName: parsed.fieldName,
        referenceTable: parsed.referenceTable,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function unwrapServiceNowFieldValue(fieldValue: unknown): string {
  if (typeof fieldValue === "string") return fieldValue;
  if (fieldValue && typeof fieldValue === "object") {
    const obj = fieldValue as Record<string, unknown>;
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.display_value === "string") return obj.display_value;
  }
  return "";
}

function unwrapServiceNowDisplayValue(fieldValue: unknown): string {
  if (typeof fieldValue === "string") return fieldValue;
  if (fieldValue && typeof fieldValue === "object") {
    const obj = fieldValue as Record<string, unknown>;
    if (typeof obj.display_value === "string") return obj.display_value;
    if (typeof obj.value === "string") return obj.value;
  }
  return "";
}

function normalizeServiceNowReferenceKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function inferServiceNowListTableFromUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return "";
  const candidates = [rawUrl];
  for (let i = 0; i < 2; i += 1) {
    const latest = candidates[candidates.length - 1];
    try {
      const decoded = decodeURIComponent(latest);
      if (decoded === latest) break;
      candidates.push(decoded);
    } catch {
      break;
    }
  }
  for (const candidate of candidates) {
    const match = /(?:\/|target\/)([$a-z0-9_]+)_list\.do\b/i.exec(candidate);
    if (match?.[1]) return match[1];
  }
  return "";
}

function commonServiceNowReferenceTableForField(
  fieldName: string,
): string | null {
  const key = normalizeServiceNowReferenceKey(fieldName);
  const compactKey = key.replace(/_/g, "");
  const commonReferences: Record<string, string> = {
    assigned_to: "sys_user",
    assignedto: "sys_user",
    caller: "sys_user",
    caller_id: "sys_user",
    callerid: "sys_user",
    closed_by: "sys_user",
    closedby: "sys_user",
    manager: "sys_user",
    opened_by: "sys_user",
    openedby: "sys_user",
    requested_for: "sys_user",
    requestedfor: "sys_user",
    resolved_by: "sys_user",
    resolvedby: "sys_user",
    user: "sys_user",
    assignment_group: "sys_user_group",
    assignmentgroup: "sys_user_group",
    group: "sys_user_group",
    company: "core_company",
    department: "cmn_department",
    location: "cmn_location",
    model_category: "cmdb_model_category",
    modelcategory: "cmdb_model_category",
    vendor: "core_company",
  };
  return commonReferences[key] ?? commonReferences[compactKey] ?? null;
}

function isServiceNowOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "service-now.com" || host.endsWith(".service-now.com");
  } catch {
    return false;
  }
}

function cleanServiceNowQueryValue(value: string): string {
  return value.replace(/\^/g, "").trim();
}

function shouldRetryServiceNowLookupInPage(reason: string): boolean {
  return (
    reason === "lookup_http_401" ||
    reason === "lookup_http_403" ||
    /failed|network|abort|timeout/i.test(reason)
  );
}

function parseServiceNowModuleRecord(
  record: Record<string, unknown>,
): ServiceNowModuleRecord {
  const title =
    unwrapServiceNowDisplayValue(record.title) ||
    unwrapServiceNowDisplayValue(record.sys_name) ||
    unwrapServiceNowFieldValue(record.name);
  const name = unwrapServiceNowFieldValue(record.name);
  const application =
    unwrapServiceNowDisplayValue(record.application) ||
    unwrapServiceNowDisplayValue(record.menu) ||
    unwrapServiceNowDisplayValue(record.sys_scope);
  const targetHints = [
    record.url,
    record.link,
    record.arguments,
    record.query,
    record.filter,
    record.path,
  ]
    .map(unwrapServiceNowFieldValue)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    sysId: unwrapServiceNowFieldValue(record.sys_id),
    title,
    application,
    name,
    table: unwrapServiceNowFieldValue(record.table),
    linkType: unwrapServiceNowDisplayValue(record.link_type),
    targetHints,
    raw: record,
  };
}

function serviceNowMatchKey(value: string): string {
  return normalizeServiceNowReferenceKey(value).replace(/_/g, "");
}

function stripServiceNowShellTarget(value: string): string {
  const candidates = [value];
  for (let i = 0; i < 2; i += 1) {
    const latest = candidates[candidates.length - 1];
    try {
      const decoded = decodeURIComponent(latest);
      if (decoded === latest) break;
      candidates.push(decoded);
    } catch {
      break;
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const targetMatch =
        /\/now\/nav\/ui\/classic\/params\/target\/(.+)$/i.exec(parsed.pathname);
      if (targetMatch?.[1]) {
        return decodeURIComponent(targetMatch[1]) + parsed.search;
      }
      return `${parsed.pathname.replace(/^\/+/, "")}${parsed.search}`;
    } catch {
      const targetMatch =
        /\/now\/nav\/ui\/classic\/params\/target\/(.+)$/i.exec(candidate);
      if (targetMatch?.[1]) return decodeURIComponent(targetMatch[1]);
    }
  }
  return value.replace(/^\/+/, "");
}

function candidateLooksLikeServiceNowTarget(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^javascript:/i.test(trimmed)) return false;
  return (
    /\.do(?:\?|$)/i.test(trimmed) ||
    /^\$?[a-z0-9_]+(?:_list)?\.do(?:\?|$)/i.test(trimmed) ||
    /^(?:kb|sp|catalog|com\.glideapp)\?/i.test(trimmed)
  );
}

function buildServiceNowTargetUrlFromHref(
  origin: string,
  href: string,
): { target: string; targetUrl: string } | null {
  const target = stripServiceNowShellTarget(href).trim();
  if (!candidateLooksLikeServiceNowTarget(target)) return null;
  return {
    target,
    targetUrl: `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`,
  };
}

function serviceNowHrefHasTruncatedModuleParam(href: string): boolean {
  const match = /(?:[?&])sysparm_userpref_module=([0-9a-f]{1,31})(?:$|[&#])/i.exec(
    href,
  );
  return Boolean(match);
}

function appendServiceNowModuleParam(target: string, sysId: string): string {
  if (!sysId || /(?:^|[?&])sysparm_userpref_module=/i.test(target)) {
    return target;
  }
  return `${target}${target.includes("?") ? "&" : "?"}sysparm_userpref_module=${encodeURIComponent(sysId)}`;
}

function buildServiceNowModuleTarget(
  module: ServiceNowModuleRecord,
): string | null {
  for (const hint of module.targetHints) {
    const target = stripServiceNowShellTarget(hint).trim();
    if (candidateLooksLikeServiceNowTarget(target)) {
      return appendServiceNowModuleParam(target, module.sysId);
    }
  }

  const table =
    module.table ||
    (/^[a-z][a-z0-9_]*$/i.test(module.name) && module.name.includes("_")
      ? module.name
      : "");
  if (!table) return null;
  const target = table.endsWith(".do")
    ? table
    : table.endsWith("_list")
      ? `${table}.do`
      : `${table}_list.do`;
  return appendServiceNowModuleParam(target, module.sysId);
}

function scoreServiceNowModuleCandidate(
  module: ServiceNowModuleRecord,
  application: string,
  path: string[],
  target: string | null,
): number {
  const leaf = path[path.length - 1] || "";
  const leafKey = serviceNowMatchKey(leaf);
  const titleKey = serviceNowMatchKey(module.title);
  const nameKey = serviceNowMatchKey(module.name);
  const appKey = serviceNowMatchKey(application);
  const moduleAppKey = serviceNowMatchKey(module.application);
  const searchableKey = serviceNowMatchKey(
    [
      module.title,
      module.application,
      module.name,
      module.table,
      module.linkType,
      ...module.targetHints,
    ].join(" "),
  );

  let score = 0;
  if (titleKey === leafKey) score += 100;
  else if (titleKey.includes(leafKey) || leafKey.includes(titleKey))
    score += 55;
  if (nameKey === leafKey) score += 25;
  else if (nameKey.includes(leafKey)) score += 15;
  if (appKey) {
    if (moduleAppKey === appKey) score += 60;
    else if (moduleAppKey.includes(appKey) || appKey.includes(moduleAppKey)) {
      score += 25;
    }
  }
  for (const segment of path.slice(0, -1)) {
    const segmentKey = serviceNowMatchKey(segment);
    if (segmentKey && searchableKey.includes(segmentKey)) score += 12;
  }
  if (target) score += 10;
  return score;
}

function serviceNowModuleMatchesLeaf(
  module: ServiceNowModuleRecord,
  leaf: string,
): boolean {
  const leafKey = serviceNowMatchKey(leaf);
  const titleKey = serviceNowMatchKey(module.title);
  const nameKey = serviceNowMatchKey(module.name);
  return (
    titleKey === leafKey ||
    titleKey.includes(leafKey) ||
    leafKey.includes(titleKey) ||
    nameKey === leafKey ||
    nameKey.includes(leafKey)
  );
}

async function getServiceNowTabOrigin(
  tabId: number,
): Promise<{ ok: true; origin: string } | { ok: false; reason: string }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const origin = new URL(tab.url || "").origin;
    if (!isServiceNowOrigin(origin)) {
      return { ok: false, reason: "not_servicenow_origin" };
    }
    return { ok: true, origin };
  } catch {
    return { ok: false, reason: "missing_tab_origin" };
  }
}

function decodeServiceNowClassicTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const marker = "/now/nav/ui/classic/params/target/";
    const index = parsed.pathname.indexOf(marker);
    if (index >= 0) {
      const encodedTarget = parsed.pathname.slice(index + marker.length);
      return `${decodeURIComponent(encodedTarget)}${parsed.search}`;
    }
    return `${parsed.pathname.replace(/^\/+/, "")}${parsed.search}`;
  } catch {
    return "";
  }
}

async function detectAlreadyOpenServiceNowModule(
  tabId: number,
  origin: string,
  path: string[],
): Promise<ServiceNowCurrentModuleMatch> {
  const leaf = path[path.length - 1] || "";
  const leafKey = serviceNowMatchKey(leaf);
  if (!leafKey) return { ok: false, reason: "empty_module_path" };

  let tabUrl = "";
  try {
    const tab = await chrome.tabs.get(tabId);
    tabUrl = getTabUrl(tab);
    if (new URL(tabUrl).origin !== origin) {
      return { ok: false, reason: "origin_mismatch" };
    }
  } catch {
    return { ok: false, reason: "missing_tab_url" };
  }

  const pageTarget = decodeServiceNowClassicTarget(tabUrl);
  const results = await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN" as any,
      func: () => {
        const visibleText = (node: Element): string => {
          const style = window.getComputedStyle(node);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return "";
          }
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 && rect.height <= 0) return "";
          return [
            node.textContent ?? "",
            node.getAttribute("aria-label") ?? "",
            node.getAttribute("title") ?? "",
          ]
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        };
        const headingSelector = [
          "h1",
          "h2",
          '[role="heading"]',
          '[title$="Context Menu"]',
          ".navbar-title",
          ".page-title",
        ].join(",");
        const headings = Array.from(document.querySelectorAll(headingSelector))
          .map(visibleText)
          .filter(Boolean)
          .slice(0, 12);
        return {
          title: document.title || "",
          url: location.href,
          target: location.href,
          headings,
        };
      },
    })
    .catch(() => []);

  const matchedBy: string[] = [];
  let bestTitle = "";
  let bestUrl = tabUrl;
  let bestTarget = pageTarget;

  for (const result of results ?? []) {
    const value = result.result as
      | {
          title?: string;
          url?: string;
          target?: string;
          headings?: string[];
        }
      | undefined;
    if (!value) continue;
    const frameUrl = typeof value.url === "string" ? value.url : "";
    if (frameUrl) {
      try {
        if (new URL(frameUrl).origin !== origin) continue;
      } catch {
        continue;
      }
    }
    const title = typeof value.title === "string" ? value.title : "";
    const headings = Array.isArray(value.headings) ? value.headings : [];
    const target = frameUrl ? decodeServiceNowClassicTarget(frameUrl) : pageTarget;
    const titleKey = serviceNowMatchKey(title);
    const headingMatches = headings.filter((heading) => {
      const key = serviceNowMatchKey(heading.replace(/\bcontext menu\b/gi, ""));
      return key === leafKey || key.includes(leafKey);
    });
    const titleMatches = titleKey === leafKey || titleKey.includes(leafKey);
    const targetLooksLikeModule =
      /\.do(?:\?|$)/i.test(target) && !/\b(?:home|login)\b/i.test(target);

    if ((titleMatches || headingMatches.length > 0) && targetLooksLikeModule) {
      if (titleMatches) matchedBy.push(`title:${title}`);
      matchedBy.push(
        ...headingMatches.map((heading) => `heading:${heading}`),
      );
      bestTitle = title || headingMatches[0] || bestTitle;
      bestUrl = frameUrl || bestUrl;
      bestTarget = target || bestTarget;
      break;
    }
  }

  if (matchedBy.length === 0) {
    return { ok: false, reason: "current_module_not_matched" };
  }

  return {
    ok: true,
    title: bestTitle || leaf,
    url: bestUrl,
    target: bestTarget,
    matchedBy: [...new Set(matchedBy)],
  };
}

async function fetchServiceNowTableRecords(
  origin: string,
  table: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const search = new URLSearchParams(params);
    const response = await fetch(
      `${origin}/api/now/table/${encodeURIComponent(table)}?${search.toString()}`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`lookup_http_${response.status}`);
    }
    const payload = await response.json().catch(() => null);
    return Array.isArray(payload?.result) ? payload.result : [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchServiceNowTableRecordsFromPage(
  tabId: number,
  table: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const frameIds = await getFrameIdsForMainWorldBridge(tabId);
  const inject = (frameId: number) =>
    chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN" as any,
      func: async (
        tableName: string,
        requestParams: Record<string, string>,
      ) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4_000);
        try {
          const search = new URLSearchParams(requestParams);
          const url = new URL(
            `/api/now/table/${encodeURIComponent(tableName)}?${search.toString()}`,
            window.location.origin,
          ).href;
          const response = await fetch(url, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          });
          if (!response.ok) {
            return { ok: false, reason: `lookup_http_${response.status}` };
          }
          const payload = await response.json().catch(() => null);
          return {
            ok: true,
            records: Array.isArray(payload?.result) ? payload.result : [],
          };
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            return { ok: false, reason: "lookup_timeout" };
          }
          return {
            ok: false,
            reason:
              error instanceof Error && error.message
                ? `lookup_failed:${error.message.slice(0, 80)}`
                : "lookup_failed",
          };
        } finally {
          clearTimeout(timer);
        }
      },
      args: [table, params],
    });

  let lastReason = "lookup_failed";
  for (const frameId of frameIds) {
    const results = await Promise.race([
      inject(frameId),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("ServiceNow table lookup timed out")),
          5_000,
        ),
      ),
    ]).catch(() => null);
    for (const result of results ?? []) {
      const value = result.result as
        | { ok: true; records: Record<string, unknown>[] }
        | { ok: false; reason: string }
        | undefined;
      if (!value) continue;
      if (value.ok) return value.records;
      if (!value.ok && typeof value.reason === "string") {
        lastReason = value.reason;
      }
    }
  }
  throw new Error(lastReason);
}

async function requestServiceNowDomSnapshot(
  tabId: number,
): Promise<DomSnapshot | null> {
  try {
    await waitForDomReady(tabId, { timeoutMs: 250, waitForElements: true });
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "DOM_SNAPSHOT_REQUEST",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      payload: { refresh: true, autoDismiss: false },
    });
    const snapshot = response?.payload?.snapshot;
    if (!snapshot || !Array.isArray(snapshot.elements)) return null;
    return snapshot as DomSnapshot;
  } catch {
    return null;
  }
}

async function waitForServiceNowDomSnapshot(
  tabId: number,
  initialSnapshot: DomSnapshot,
  predicate: (snapshot: DomSnapshot) => boolean,
  timeoutMs: number,
): Promise<DomSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let latest = initialSnapshot;
  do {
    await waitForDomReady(tabId, { timeoutMs: 500, waitForElements: true });
    const snapshot = await requestServiceNowDomSnapshot(tabId);
    if (snapshot) {
      latest = snapshot;
      if (predicate(snapshot)) return snapshot;
    }
  } while (Date.now() < deadline);
  return latest;
}

function serviceNowSnapshotElementLabel(element: TaggedElement): string {
  const seen = new Set<string>();
  return [
    element.text,
    element.attributes?.["aria-label"],
    element.attributes?.title,
  ]
    .filter((value): value is string => {
      if (typeof value !== "string" || !value.trim()) return false;
      const key = value.replace(/\s+/g, " ").trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function findServiceNowAllMenuButton(
  snapshot: DomSnapshot,
): TaggedElement | null {
  const candidates = snapshot.elements
    .filter((element) => element.isVisible && !element.isDisabled)
    .map((element) => {
      const label = serviceNowSnapshotElementLabel(element);
      const key = serviceNowMatchKey(label);
      const tagName = element.tagName.toLowerCase();
      const role = (element.role || "").toLowerCase();
      let score = 0;
      if (tagName === "button" || role === "button") score += 40;
      if (key === "all") score += 100;
      else if (key.startsWith("all")) score += 40;
      if (element.attributes?.["aria-expanded"] === "true") score += 10;
      return { element, score };
    })
    .filter((candidate) => candidate.score >= 100)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.element ?? null;
}

function findServiceNowAllMenuFilter(
  snapshot: DomSnapshot,
): TaggedElement | null {
  const candidates = snapshot.elements
    .filter(
      (element) =>
        element.isVisible &&
        !element.isDisabled &&
        element.tagName.toLowerCase() === "input",
    )
    .map((element) => {
      const attrs = element.attributes ?? {};
      const blob = serviceNowMatchKey(
        [
          attrs.placeholder,
          attrs["aria-label"],
          attrs.id,
          attrs.name,
          attrs.role,
          attrs.type,
          element.text,
        ]
          .filter((value): value is string => typeof value === "string")
          .join(" "),
      );
      let score = 0;
      if (blob.includes("filter")) score += 100;
      if (blob.includes("menu") || blob.includes("navigator")) score += 35;
      if (blob.includes("search")) score += 20;
      if (attrs.type === "search") score += 10;
      if (blob.includes("global") || blob.includes("sncwsgs")) score -= 80;
      return { element, score };
    })
    .filter((candidate) => candidate.score >= 50)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.element ?? null;
}

function scoreServiceNowSnapshotModuleCandidate(
  element: TaggedElement,
  snapshot: DomSnapshot,
  application: string,
  path: string[],
): ServiceNowSnapshotElementCandidate | null {
  if (!element.isVisible || element.isDisabled) return null;
  const tagName = element.tagName.toLowerCase();
  const role = (element.role || "").toLowerCase();
  const href = element.attributes?.href || "";
  const label = serviceNowSnapshotElementLabel(element);
  const labelKey = serviceNowMatchKey(label);
  const leaf = path[path.length - 1] || "";
  const leafKey = serviceNowMatchKey(leaf);
  if (!labelKey || !leafKey || !labelKey.includes(leafKey)) return null;

  const looksLikeModuleLink =
    (tagName === "a" || role === "link" || role === "menuitem") &&
    (candidateLooksLikeServiceNowTarget(href) ||
      href.includes("sysparm_userpref_module") ||
      /\.do(?:\?|$)/i.test(href));
  if (!looksLikeModuleLink) return null;

  const pageKey = serviceNowMatchKey(
    [snapshot.pageContent, snapshot.visibleContent, snapshot.title]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
  const appKey = serviceNowMatchKey(application);
  let score = labelKey === leafKey ? 130 : 65;
  if (labelKey.startsWith(leafKey)) score += 20;
  if (href.includes("sysparm_userpref_module")) score += 20;
  if (candidateLooksLikeServiceNowTarget(href)) score += 20;
  if (appKey && pageKey.includes(appKey)) score += 30;
  for (const segment of path.slice(0, -1)) {
    const segmentKey = serviceNowMatchKey(segment);
    if (segmentKey && pageKey.includes(segmentKey)) score += 15;
  }
  if (/view results|no exact match|filter|search/i.test(label)) score -= 80;

  return score >= 75 ? { element, label, href, score } : null;
}

function selectServiceNowSnapshotModuleCandidate(
  snapshot: DomSnapshot,
  origin: string,
  application: string,
  path: string[],
  query: string,
): ServiceNowNavigatorCandidateResult {
  const ranked = snapshot.elements
    .map((element) =>
      scoreServiceNowSnapshotModuleCandidate(
        element,
        snapshot,
        application,
        path,
      ),
    )
    .filter(
      (candidate): candidate is ServiceNowSnapshotElementCandidate =>
        candidate !== null,
    )
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return { ok: false, reason: "snapshot_candidate_not_found" };

  const target = buildServiceNowTargetUrlFromHref(origin, best.href);
  const safeTarget = serviceNowHrefHasTruncatedModuleParam(best.href)
    ? null
    : target;
  if (!target && typeof best.element.tag !== "number") {
    return { ok: false, reason: "snapshot_candidate_missing_href" };
  }
  return {
    ok: true,
    query,
    candidateText: best.label,
    href: best.href,
    target: safeTarget?.target ?? null,
    targetUrl: safeTarget?.targetUrl ?? null,
    frameId: 0,
    elementTag: best.element.tag,
  };
}

async function prepareServiceNowSnapshotNavigatorCandidate(
  tabId: number,
  origin: string,
  application: string,
  path: string[],
): Promise<ServiceNowNavigatorCandidateResult> {
  const leaf = path[path.length - 1] || "";
  const searchValues = [
    application,
    leaf,
    path.join(" "),
    application ? `${application} ${leaf}` : "",
  ]
    .map((value) => value.trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  if (!leaf || searchValues.length === 0) {
    return { ok: false, reason: "empty_module_path" };
  }

  let snapshot = await requestServiceNowDomSnapshot(tabId);
  if (!snapshot) {
    await ensureContentScript(tabId, 1_500).catch(() => false);
    snapshot = await requestServiceNowDomSnapshot(tabId);
  }
  if (!snapshot) return { ok: false, reason: "snapshot_unavailable" };

  let candidate = selectServiceNowSnapshotModuleCandidate(
    snapshot,
    origin,
    application,
    path,
    "existing snapshot",
  );
  if (candidate.ok) return candidate;

  let filter = findServiceNowAllMenuFilter(snapshot);
  if (!filter) {
    const allButton = findServiceNowAllMenuButton(snapshot);
    if (allButton) {
      await executeContentTool(
        ToolName.CLICK_ELEMENT,
        { id: allButton.tag },
        tabId,
      );
      snapshot = await waitForServiceNowDomSnapshot(
        tabId,
        snapshot,
        (nextSnapshot) =>
          Boolean(findServiceNowAllMenuFilter(nextSnapshot)) ||
          selectServiceNowSnapshotModuleCandidate(
            nextSnapshot,
            origin,
            application,
            path,
            "visible snapshot",
          ).ok,
        4_000,
      );
      filter = findServiceNowAllMenuFilter(snapshot);
      candidate = selectServiceNowSnapshotModuleCandidate(
        snapshot,
        origin,
        application,
        path,
        "visible snapshot",
      );
      if (candidate.ok) return candidate;
    }
  }

  let lastReason = candidate.reason;
  for (const query of searchValues) {
    filter = findServiceNowAllMenuFilter(snapshot) ?? filter;
    if (!filter) {
      lastReason = "snapshot_filter_not_found";
      continue;
    }
    const typeResult = await executeContentTool(
      ToolName.TYPE_TEXT,
      { id: filter.tag, text: query },
      tabId,
    );
    if (typeResult.startsWith("Error:")) {
      lastReason = "snapshot_filter_type_failed";
      continue;
    }
    snapshot = await waitForServiceNowDomSnapshot(
      tabId,
      snapshot,
      (nextSnapshot) =>
        selectServiceNowSnapshotModuleCandidate(
          nextSnapshot,
          origin,
          application,
          path,
          query,
        ).ok,
      4_000,
    );
    candidate = selectServiceNowSnapshotModuleCandidate(
      snapshot,
      origin,
      application,
      path,
      query,
    );
    if (candidate.ok) return candidate;
    lastReason = candidate.reason;
  }

  return { ok: false, reason: lastReason };
}

async function prepareServiceNowNavigatorCandidate(
  tabId: number,
  origin: string,
  application: string,
  path: string[],
): Promise<ServiceNowNavigatorCandidateResult> {
  const leaf = path[path.length - 1] || "";
  const searchValues = [
    application,
    leaf,
    path.join(" "),
    application ? `${application} ${leaf}` : "",
  ]
    .map((value) => value.trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  if (!leaf || searchValues.length === 0) {
    return { ok: false, reason: "empty_module_path" };
  }

  const runInFrame = (frameId: number) =>
    chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN" as any,
      func: async (
        appName: string,
        modulePath: string[],
        queries: string[],
      ) => {
        const delay = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const normalize = (value: string): string =>
          value.replace(/\s+/g, " ").trim().toLowerCase();
        const leafLabel = modulePath[modulePath.length - 1] || "";
        const leafKey = normalize(leafLabel);
        const appKey = normalize(appName);
        const pathKeys = modulePath.map(normalize).filter(Boolean);
        const view = window;

        const isVisible = (node: Element): boolean => {
          if (!node.isConnected) return false;
          const style = view.getComputedStyle(node);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return (
            rect.width > 0 ||
            rect.height > 0 ||
            Boolean(node.textContent?.trim())
          );
        };

        const textOf = (node: Element): string =>
          [
            node.textContent ?? "",
            node.getAttribute("aria-label") ?? "",
            node.getAttribute("title") ?? "",
          ]
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        const queryAllDeep = (selector: string): Element[] => {
          const found: Element[] = [];
          const visit = (root: ParentNode) => {
            const nodes = Array.from(root.querySelectorAll(selector));
            found.push(...nodes);
            for (const node of Array.from(root.querySelectorAll("*"))) {
              if (node instanceof HTMLElement && node.shadowRoot) {
                visit(node.shadowRoot);
              }
            }
          };
          visit(document);
          return found;
        };

        const dispatchPointerClick = (node: HTMLElement) => {
          node.scrollIntoView?.({ block: "center", inline: "center" });
          const rect = node.getBoundingClientRect();
          const mouseInit: MouseEventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            button: 0,
          };
          try {
            node.dispatchEvent(
              new view.PointerEvent("pointerdown", {
                ...mouseInit,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                buttons: 1,
              }),
            );
          } catch {
            // PointerEvent is optional in some page contexts.
          }
          node.dispatchEvent(
            new view.MouseEvent("mousedown", { ...mouseInit, buttons: 1 }),
          );
          try {
            node.dispatchEvent(
              new view.PointerEvent("pointerup", {
                ...mouseInit,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                buttons: 0,
              }),
            );
          } catch {
            // PointerEvent is optional in some page contexts.
          }
          node.dispatchEvent(new view.MouseEvent("mouseup", mouseInit));
          node.click();
        };

        const clickableSelector =
          'a,button,[role="button"],[role="menuitem"],[role="link"]';
        const findAllButton = (): HTMLElement | null => {
          for (const node of queryAllDeep(clickableSelector)) {
            if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
            const text = normalize(textOf(node));
            if (text === "all" || text.startsWith("all ")) return node;
          }
          return null;
        };

        const findFilterInput = (): HTMLInputElement | null => {
          const inputs = queryAllDeep("input").filter(
            (node): node is HTMLInputElement =>
              node instanceof HTMLInputElement && isVisible(node),
          );
          const score = (input: HTMLInputElement): number => {
            const blob = normalize(
              [
                input.placeholder,
                input.getAttribute("aria-label") ?? "",
                input.id,
                input.name,
                input.getAttribute("role") ?? "",
              ].join(" "),
            );
            let value = 0;
            if (blob.includes("filter")) value += 100;
            if (blob.includes("menu")) value += 35;
            if (blob.includes("search")) value += 20;
            if (input.type === "search") value += 10;
            return value;
          };
          const ranked = inputs
            .map((input) => ({ input, score: score(input) }))
            .sort((a, b) => b.score - a.score);
          const best = ranked[0];
          return best && best.score >= 50 ? best.input : null;
        };

        const waitForFilterInput =
          async (): Promise<HTMLInputElement | null> => {
            for (let attempt = 0; attempt < 10; attempt += 1) {
              const input = findFilterInput();
              if (input) return input;
              await delay(250);
            }
            return null;
          };

        const setInputValue = async (
          input: HTMLInputElement,
          nextValue: string,
        ) => {
          input.focus();
          const setter = Object.getOwnPropertyDescriptor(
            view.HTMLInputElement.prototype,
            "value",
          )?.set;
          if (setter) setter.call(input, "");
          else input.value = "";
          input.dispatchEvent(
            new view.InputEvent("input", {
              bubbles: true,
              cancelable: true,
              composed: true,
              inputType: "deleteContentBackward",
            }),
          );
          for (const char of nextValue) {
            input.dispatchEvent(
              new view.KeyboardEvent("keydown", {
                key: char,
                bubbles: true,
                cancelable: true,
                composed: true,
              }),
            );
            if (setter) setter.call(input, input.value + char);
            else input.value += char;
            input.dispatchEvent(
              new view.InputEvent("input", {
                bubbles: true,
                cancelable: true,
                composed: true,
                data: char,
                inputType: "insertText",
              }),
            );
            input.dispatchEvent(
              new view.KeyboardEvent("keyup", {
                key: char,
                bubbles: true,
                cancelable: true,
                composed: true,
              }),
            );
            await delay(10);
          }
          input.dispatchEvent(
            new view.Event("change", { bubbles: true, composed: true }),
          );
        };

        const candidateScore = (node: HTMLElement): number => {
          const text = normalize(textOf(node));
          if (!text || !leafKey || !text.includes(leafKey)) return 0;
          const context = normalize(
            [
              text,
              node.closest("li,div,section,nav")?.textContent ?? "",
              node.parentElement?.textContent ?? "",
            ].join(" "),
          );
          const href = node.getAttribute("href") ?? "";
          const looksLikeModuleLink =
            node.tagName.toLowerCase() === "a" &&
            (/\.do(?:\?|$)/i.test(href) ||
              href.includes("sysparm_userpref_module") ||
              href.startsWith("$"));
          const parentPathMatched = pathKeys
            .slice(0, -1)
            .some((segmentKey) => context.includes(segmentKey));
          if (leafKey === "all" && !looksLikeModuleLink && !parentPathMatched) {
            return 0;
          }
          let score = text === leafKey ? 120 : 60;
          if (text.startsWith(leafKey)) score += 20;
          if (looksLikeModuleLink) score += 25;
          if (appKey && context.includes(appKey)) score += 30;
          for (const segmentKey of pathKeys.slice(0, -1)) {
            if (context.includes(segmentKey)) score += 15;
          }
          if (/view results|no exact match|filter|search/i.test(text)) {
            score -= 80;
          }
          return score;
        };

        const findModuleCandidate = (): {
          node: HTMLElement;
          text: string;
        } | null => {
          let best: { node: HTMLElement; text: string; score: number } | null =
            null;
          for (const node of queryAllDeep(clickableSelector)) {
            if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
            const score = candidateScore(node);
            if (score < 50) continue;
            if (!best || score > best.score) {
              best = { node, text: textOf(node), score };
            }
          }
          return best ? { node: best.node, text: best.text } : null;
        };

        const waitForModuleCandidate = async (
          timeoutMs: number,
        ): Promise<{ node: HTMLElement; text: string } | null> => {
          const deadline = Date.now() + timeoutMs;
          do {
            const candidate = findModuleCandidate();
            if (candidate) return candidate;
            await delay(250);
          } while (Date.now() < deadline);
          return null;
        };

        const returnCandidate = (
          candidate: { node: HTMLElement; text: string },
          query: string,
        ) => {
          const href =
            candidate.node instanceof HTMLAnchorElement
              ? candidate.node.getAttribute("href") || candidate.node.href || ""
              : candidate.node.getAttribute("href") || "";
          return {
            ok: true,
            query,
            candidateText: candidate.text || leafLabel,
            href,
          };
        };

        const preExistingCandidate = await waitForModuleCandidate(500);
        if (preExistingCandidate) {
          return returnCandidate(preExistingCandidate, "existing navigator");
        }

        const allButton = findAllButton();
        const navigatorAlreadyOpen =
          Boolean(findFilterInput()) ||
          allButton?.getAttribute("aria-expanded") === "true";
        if (allButton && !navigatorAlreadyOpen) {
          dispatchPointerClick(allButton);
          await delay(1_500);
        }

        const openedCandidate = await waitForModuleCandidate(2_500);
        if (openedCandidate) {
          return returnCandidate(openedCandidate, "visible navigator");
        }

        for (const query of queries) {
          const input = await waitForFilterInput();
          if (input) {
            await setInputValue(input, query);
          }
          const candidate = await waitForModuleCandidate(input ? 2_500 : 750);
          if (candidate) {
            return returnCandidate(candidate, query);
          }
        }

        return { ok: false, reason: "navigator_candidate_not_found" };
      },
      args: [application, path, searchValues],
    });

  const frameIds = await getFrameIdsForMainWorldBridge(tabId);
  let lastReason = "navigator_script_failed";
  for (const frameId of frameIds) {
    const results = await runInFrame(frameId).catch(() => null);
    const value = results?.[0]?.result as
      | (
          | { ok: true; query: string; candidateText: string; href: string }
          | {
              ok: false;
              reason: string;
            }
        )
      | undefined;
    if (!value) {
      lastReason = "navigator_script_failed";
      continue;
    }
    if (!value.ok) {
      lastReason = value.reason;
      continue;
    }

    const target = buildServiceNowTargetUrlFromHref(origin, value.href);
    return {
      ok: true,
      query: value.query,
      candidateText: value.candidateText,
      href: value.href,
      target: target?.target ?? null,
      targetUrl: target?.targetUrl ?? null,
      frameId,
    };
  }

  return { ok: false, reason: lastReason };
}

async function withServiceNowTiming<T>(
  promise: Promise<T>,
): Promise<TimedServiceNowResult<T>> {
  const startedAt = Date.now();
  try {
    return {
      value: await promise,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "failed",
      durationMs: Date.now() - startedAt,
    };
  }
}

function formatServiceNowDuration(durationMs: number): string {
  return `${Math.max(0, Math.round(durationMs))}ms`;
}

function summarizeServiceNowMetadataOutcome(
  outcome: TimedServiceNowResult<
    ResolvedServiceNowModule | ServiceNowModuleResolutionFailure
  > | null,
  startedAt: number,
): string {
  if (!outcome) {
    return `Metadata: pending after ${formatServiceNowDuration(Date.now() - startedAt)}`;
  }
  if (outcome.error) {
    return `Metadata: ${outcome.error} in ${formatServiceNowDuration(outcome.durationMs)}`;
  }
  const value = outcome.value;
  if (!value) {
    return `Metadata: no result in ${formatServiceNowDuration(outcome.durationMs)}`;
  }
  return value.ok
    ? `Metadata: resolved ${value.module.title} in ${formatServiceNowDuration(outcome.durationMs)}`
    : `Metadata: ${value.reason} in ${formatServiceNowDuration(outcome.durationMs)}`;
}

function summarizeServiceNowNavigatorOutcome(
  outcome: TimedServiceNowResult<ServiceNowNavigatorCandidateResult> | null,
  startedAt: number,
): string {
  if (!outcome) {
    return `Navigator: pending after ${formatServiceNowDuration(Date.now() - startedAt)}`;
  }
  if (outcome.error) {
    return `Navigator: ${outcome.error} in ${formatServiceNowDuration(outcome.durationMs)}`;
  }
  const value = outcome.value;
  if (!value) {
    return `Navigator: no result in ${formatServiceNowDuration(outcome.durationMs)}`;
  }
  return value.ok
    ? `Navigator: candidate ${value.candidateText} via ${value.query} in ${formatServiceNowDuration(outcome.durationMs)}`
    : `Navigator: ${value.reason} in ${formatServiceNowDuration(outcome.durationMs)}`;
}

function serviceNowModuleEvidence(
  detail: Record<string, unknown>,
): EvidenceEvent[] {
  const base = {
    source: ToolName.OPEN_SERVICENOW_MODULE,
    confidence: "high" as const,
    observedAt: new Date().toISOString(),
    supportsTaskGoal: true,
  };
  return [
    {
      ...base,
      type: "navigation_reached",
      detail,
    },
    {
      ...base,
      type: "goal_state_verified",
      detail,
    },
  ];
}

async function commitResolvedServiceNowModule(
  tabId: number,
  resolved: ResolvedServiceNowModule,
): Promise<void> {
  clearTabReady(tabId);
  await chrome.tabs.update(tabId, { url: resolved.targetUrl });
  await waitForNavigation(tabId, 10_000);
  await waitForContentScriptReady(tabId, 2_000);
}

async function commitServiceNowNavigatorCandidate(
  tabId: number,
  candidate: Extract<ServiceNowNavigatorCandidateResult, { ok: true }>,
): Promise<
  "navigator_href" | "navigator_click" | "navigator_click_unavailable"
> {
  clearTabReady(tabId);
  if (typeof candidate.elementTag === "number") {
    const clickResult = await executeContentTool(
      ToolName.CLICK_ELEMENT,
      { id: candidate.elementTag },
      tabId,
    );
    if (!clickResult.startsWith("Error:")) {
      await waitForNavigation(tabId, 10_000);
      await waitForContentScriptReady(tabId, 2_000);
      return "navigator_click";
    }
  }

  if (candidate.targetUrl) {
    await chrome.tabs.update(tabId, { url: candidate.targetUrl });
    await waitForNavigation(tabId, 10_000);
    await waitForContentScriptReady(tabId, 2_000);
    return "navigator_href";
  }

  const results = await chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [candidate.frameId] },
      world: "MAIN" as any,
      func: (candidateText: string, candidateHref: string) => {
        const normalize = (value: string): string =>
          value.replace(/\s+/g, " ").trim().toLowerCase();
        const targetText = normalize(candidateText);
        const targetHref = candidateHref.trim();
        const view = window;
        const isVisible = (node: Element): boolean => {
          if (!node.isConnected) return false;
          const style = view.getComputedStyle(node);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return false;
          }
          const rect = node.getBoundingClientRect();
          return rect.width > 0 || rect.height > 0;
        };
        const textOf = (node: Element): string =>
          [
            node.textContent ?? "",
            node.getAttribute("aria-label") ?? "",
            node.getAttribute("title") ?? "",
          ]
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        const queryAllDeep = (selector: string): Element[] => {
          const found: Element[] = [];
          const visit = (root: ParentNode) => {
            found.push(...Array.from(root.querySelectorAll(selector)));
            for (const node of Array.from(root.querySelectorAll("*"))) {
              if (node instanceof HTMLElement && node.shadowRoot) {
                visit(node.shadowRoot);
              }
            }
          };
          visit(document);
          return found;
        };
        const click = (node: HTMLElement) => {
          node.scrollIntoView?.({ block: "center", inline: "center" });
          node.dispatchEvent(
            new view.MouseEvent("mousedown", {
              bubbles: true,
              cancelable: true,
              composed: true,
            }),
          );
          node.dispatchEvent(
            new view.MouseEvent("mouseup", {
              bubbles: true,
              cancelable: true,
              composed: true,
            }),
          );
          node.click();
        };
        for (const node of queryAllDeep(
          'a,button,[role="button"],[role="menuitem"],[role="link"]',
        )) {
          if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
          const href = node.getAttribute("href") || "";
          const text = normalize(textOf(node));
          const hrefMatches = targetHref && href === targetHref;
          const textMatches =
            targetText && (text === targetText || text.includes(targetText));
          if (hrefMatches || textMatches) {
            click(node);
            return true;
          }
        }
        return false;
      },
      args: [candidate.candidateText, candidate.href],
    })
    .catch(() => null);
  const clicked = Boolean(results?.[0]?.result);
  if (!clicked) return "navigator_click_unavailable";
  await waitForNavigation(tabId, 10_000);
  await waitForContentScriptReady(tabId, 2_000);
  return "navigator_click";
}

async function resolveServiceNowModule(
  tabId: number,
  application: string,
  path: string[],
  knownOrigin?: string,
): Promise<ResolvedServiceNowModule | ServiceNowModuleResolutionFailure> {
  let origin: string;
  if (knownOrigin) {
    origin = knownOrigin;
  } else {
    const originResult = await getServiceNowTabOrigin(tabId);
    if (!originResult.ok) return originResult;
    origin = originResult.origin;
  }

  const leaf = path[path.length - 1] || "";
  const safeLeaf = cleanServiceNowQueryValue(leaf);
  if (!safeLeaf) return { ok: false, reason: "empty_module_path" };

  let records: Record<string, unknown>[] = [];
  const lookupParams = {
    sysparm_query: `titleLIKE${safeLeaf}^ORnameLIKE${safeLeaf}^ORsys_nameLIKE${safeLeaf}`,
    sysparm_fields:
      "sys_id,title,sys_name,application,menu,name,table,link_type,url,link,arguments,query,filter,path,sys_scope",
    sysparm_limit: "100",
    sysparm_display_value: "all",
  };
  try {
    records = await fetchServiceNowTableRecords(
      origin,
      "sys_app_module",
      lookupParams,
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "module_lookup_failed";
    if (shouldRetryServiceNowLookupInPage(reason)) {
      try {
        records = await fetchServiceNowTableRecordsFromPage(
          tabId,
          "sys_app_module",
          lookupParams,
        );
      } catch (pageError) {
        return {
          ok: false,
          reason:
            pageError instanceof Error
              ? pageError.message
              : "module_lookup_failed",
        };
      }
    } else {
      return {
        ok: false,
        reason,
      };
    }
  }

  const modules = records
    .map(parseServiceNowModuleRecord)
    .filter((module) => module.sysId && module.title);
  if (modules.length === 0) {
    return { ok: false, reason: "no_matching_modules", candidateCount: 0 };
  }

  const ranked = modules
    .map((module) => {
      const target = buildServiceNowModuleTarget(module);
      return {
        module,
        target,
        score: scoreServiceNowModuleCandidate(
          module,
          application,
          path,
          target,
        ),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.module.title.length - b.module.title.length;
    });

  const selected = ranked.find(
    (candidate) =>
      candidate.target &&
      candidate.score >= 65 &&
      serviceNowModuleMatchesLeaf(candidate.module, leaf),
  );
  const candidates = ranked.slice(0, 8).map((candidate) => candidate.module);
  if (!selected?.target) {
    return {
      ok: false,
      reason: "no_confident_module_match",
      candidateCount: modules.length,
      candidates,
    };
  }

  const targetUrl = `${origin}/now/nav/ui/classic/params/target/${encodeURIComponent(selected.target)}`;
  return {
    ok: true,
    module: selected.module,
    target: selected.target,
    targetUrl,
    candidateCount: modules.length,
    score: selected.score,
    candidates,
  };
}

function summarizeServiceNowModuleCandidates(
  candidates: ServiceNowModuleRecord[] | undefined,
): string {
  if (!candidates?.length) return "";
  return candidates
    .slice(0, 5)
    .map((candidate) => {
      const target = buildServiceNowModuleTarget(candidate) || "no target";
      return `- ${candidate.application || "Unknown app"} > ${candidate.title} (${candidate.sysId}) -> ${target}`;
    })
    .join("\n");
}

async function resolveServiceNowReferenceFromBackground(
  tabId: number,
  referenceTable: string,
  displayValue: string,
): Promise<{ ok: true; sysId: string } | { ok: false; reason: string }> {
  const trimmedValue = displayValue.trim();
  if (!trimmedValue) return { ok: false, reason: "empty_display_value" };

  let origin: string;
  try {
    const tab = await chrome.tabs.get(tabId);
    origin = new URL(tab.url || "").origin;
  } catch {
    return { ok: false, reason: "missing_tab_origin" };
  }

  const safeValue = trimmedValue.replace(/\^/g, "");
  const queryFields = [
    "name",
    "display_name",
    "number",
    "user_name",
    "email",
    "first_name",
    "last_name",
  ];
  const exactQuery = ["name", "display_name", "number", "user_name", "email"]
    .map((field) => `${field}=${safeValue}`)
    .join("^OR");
  const referencePath = `${origin}/api/now/table/${encodeURIComponent(referenceTable)}`;

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const fetchReferenceRecords = async (
      query: string,
    ): Promise<Record<string, unknown>[]> => {
      const params = new URLSearchParams({
        sysparm_query: query,
        sysparm_fields:
          "sys_id,name,display_name,number,user_name,email,first_name,last_name",
        sysparm_limit: "5",
        sysparm_display_value: "all",
      });
      const url = `${referencePath}?${params.toString()}`;
      const response = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`lookup_http_${response.status}`);
      }
      const payload = await response.json();
      return Array.isArray(payload?.result) ? payload.result : [];
    };

    const recordsPromise = (async () => {
      let records = await fetchReferenceRecords(exactQuery);
      if (records.length === 0 && referenceTable === "sys_user") {
        const parts = safeValue.split(/\s+/).filter(Boolean);
        const firstName = parts[0] || "";
        const lastName = parts.slice(1).join(" ");
        if (firstName && lastName) {
          records = await fetchReferenceRecords(
            `first_name=${firstName}^last_name=${lastName}`,
          );
        }
      }
      if (records.length === 0) {
        records = await fetchReferenceRecords(
          ["name", "display_name", "user_name", "email"]
            .map((field) => `${field}LIKE${safeValue}`)
            .join("^OR"),
        );
      }
      return records;
    })();

    const timeoutPromise = new Promise<Record<string, unknown>[]>(
      (_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("lookup_timeout"));
        }, 4_000);
      },
    );
    const records = await Promise.race([recordsPromise, timeoutPromise]);
    if (records.length === 0) {
      return { ok: false, reason: "no_matching_record" };
    }

    const normalize = (candidate: string): string =>
      candidate.trim().toLowerCase();
    const selected =
      records.find(
        (record: Record<string, unknown>) =>
          queryFields.some((field) => {
            return (
              normalize(unwrapServiceNowFieldValue(record[field])) ===
              normalize(trimmedValue)
            );
          }) ||
          normalize(
            `${unwrapServiceNowFieldValue(record.first_name)} ${unwrapServiceNowFieldValue(record.last_name)}`,
          ) === normalize(trimmedValue),
      ) ?? records[0];
    const sysId = unwrapServiceNowFieldValue(selected.sys_id);
    return sysId ? { ok: true, sysId } : { ok: false, reason: "no_sys_id" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "lookup_failed";
    return {
      ok: false,
      reason:
        message === "lookup_timeout" || message.startsWith("lookup_http_")
          ? message
          : "lookup_failed",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function resolveServiceNowReferenceFromPage(
  tabId: number,
  args: Record<string, unknown>,
  candidate: ServiceNowReferenceCandidate,
  displayValue: string,
): Promise<{ ok: true; sysId: string } | { ok: false; reason: string }> {
  const id = args.id;
  if (typeof id !== "number" && typeof id !== "string") {
    return { ok: false, reason: "missing_element_id" };
  }

  try {
    const frameIds = await getFrameIdsForMainWorldBridge(tabId);
    const inject = (frameId: number) =>
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN" as any,
        func: async (
          tagId: string,
          fieldPath: string,
          referenceTable: string,
          rawDisplayValue: string,
        ) => {
          const selector = `[data-os-tag="${tagId.replace(/"/g, '\\"')}"]`;
          const input =
            document.querySelector(selector) ??
            document.getElementById(`sys_display.${fieldPath}`) ??
            Array.from(
              document.getElementsByName(`sys_display.${fieldPath}`),
            )[0] ??
            null;
          if (!(input instanceof HTMLInputElement)) {
            return { ok: false, reason: "field_not_found" };
          }

          const displayValue = rawDisplayValue.trim();
          if (!displayValue)
            return { ok: false, reason: "empty_display_value" };

          const unwrap = (fieldValue: unknown): string => {
            if (typeof fieldValue === "string") return fieldValue;
            if (fieldValue && typeof fieldValue === "object") {
              const obj = fieldValue as Record<string, unknown>;
              if (typeof obj.value === "string") return obj.value;
              if (typeof obj.display_value === "string") {
                return obj.display_value;
              }
            }
            return "";
          };
          const queryFields = [
            "name",
            "display_name",
            "number",
            "user_name",
            "email",
          ];
          const query = queryFields
            .map((field) => `${field}=${displayValue.replace(/\^/g, "")}`)
            .join("^OR");
          const params = new URLSearchParams({
            sysparm_query: query,
            sysparm_fields: "sys_id,name,display_name,number,user_name,email",
            sysparm_limit: "5",
            sysparm_display_value: "all",
          });
          const lookup = fetch(
            `/api/now/table/${encodeURIComponent(referenceTable)}?${params.toString()}`,
            { credentials: "same-origin" },
          )
            .then(async (response) => {
              if (!response.ok) {
                return { ok: false, reason: `lookup_http_${response.status}` };
              }
              const payload = await response.json();
              const records = Array.isArray(payload?.result)
                ? payload.result
                : [];
              if (records.length === 0) {
                return { ok: false, reason: "no_matching_record" };
              }
              const normalize = (candidate: string): string =>
                candidate.trim().toLowerCase();
              const selected =
                records.find((record: Record<string, unknown>) =>
                  queryFields.some(
                    (field) =>
                      normalize(unwrap(record[field])) ===
                      normalize(displayValue),
                  ),
                ) ?? records[0];
              const sysId = unwrap(selected.sys_id);
              return sysId
                ? { ok: true, sysId }
                : { ok: false, reason: "no_sys_id" };
            })
            .catch(() => ({ ok: false, reason: "lookup_failed" }));

          return Promise.race([
            lookup,
            new Promise((resolve) =>
              setTimeout(
                () => resolve({ ok: false, reason: "lookup_timeout" }),
                4_000,
              ),
            ),
          ]);
        },
        args: [
          String(id),
          candidate.fieldPath,
          candidate.referenceTable,
          displayValue,
        ],
      });

    let lastReason = "field_not_found";
    for (const frameId of frameIds) {
      const results = await Promise.race([
        inject(frameId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("ServiceNow reference lookup timed out")),
            4_500,
          ),
        ),
      ]).catch(() => null);
      for (const result of results ?? []) {
        const value = result.result as
          | { ok: true; sysId: string }
          | { ok: false; reason: string }
          | undefined;
        if (!value) continue;
        if (value.ok && value.sysId) return value;
        if (!value.ok && typeof value.reason === "string") {
          lastReason = value.reason;
        }
      }
    }
    return { ok: false, reason: lastReason };
  } catch {
    return { ok: false, reason: "lookup_failed" };
  }
}

async function commitServiceNowReferenceInMainWorld(
  tabId: number,
  args: Record<string, unknown>,
  candidate: ServiceNowReferenceCandidate,
  sysId: string,
  displayValue: string,
): Promise<boolean> {
  const id = args.id;
  if (typeof id !== "number" && typeof id !== "string") return false;

  try {
    const frameIds = await getFrameIdsForMainWorldBridge(tabId);
    const inject = (frameId: number) =>
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN" as any,
        func: (
          tagId: string,
          fieldPath: string,
          fieldName: string,
          resolvedSysId: string,
          resolvedDisplayValue: string,
        ) => {
          const selector = `[data-os-tag="${tagId.replace(/"/g, '\\"')}"]`;
          const input =
            document.querySelector(selector) ??
            document.getElementById(`sys_display.${fieldPath}`) ??
            Array.from(
              document.getElementsByName(`sys_display.${fieldPath}`),
            )[0] ??
            null;
          if (!(input instanceof HTMLInputElement)) return false;

          const hiddenControl =
            document.getElementById(fieldPath) ??
            Array.from(document.getElementsByName(fieldPath))[0] ??
            null;
          let committed = false;
          const gForm = (window as any).g_form;
          if (typeof gForm?.setValue === "function") {
            try {
              gForm.setValue(fieldName, resolvedSysId, resolvedDisplayValue);
              committed = true;
            } catch {
              // Hidden field fallback below covers frames without usable g_form.
            }
          }
          if (hiddenControl instanceof HTMLInputElement) {
            hiddenControl.value = resolvedSysId;
            hiddenControl.dispatchEvent(
              new Event("input", { bubbles: true, composed: true }),
            );
            hiddenControl.dispatchEvent(
              new Event("change", { bubbles: true, composed: true }),
            );
            committed = true;
          }

          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          if (setter) {
            setter.call(input, resolvedDisplayValue);
          } else {
            input.value = resolvedDisplayValue;
          }
          input.setAttribute("value", resolvedDisplayValue);
          input.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              cancelable: true,
              composed: true,
              data: resolvedDisplayValue,
              inputType: "insertText",
            }),
          );
          input.dispatchEvent(
            new Event("change", { bubbles: true, composed: true }),
          );
          input.dispatchEvent(
            new Event("blur", { bubbles: true, composed: true }),
          );
          return committed;
        },
        args: [
          String(id),
          candidate.fieldPath,
          candidate.fieldName,
          sysId,
          displayValue,
        ],
      });

    for (const frameId of frameIds) {
      const results = await Promise.race([
        inject(frameId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("ServiceNow reference commit timed out")),
            2_000,
          ),
        ),
      ]).catch(() => null);
      if (results?.some((result) => result.result === true)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function selectServiceNowReferenceAutocompleteInMainWorld(
  tabId: number,
  args: Record<string, unknown>,
  candidate: ServiceNowReferenceCandidate,
  displayValue: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const id = args.id;
  if (typeof id !== "number" && typeof id !== "string") {
    return { ok: false, reason: "missing_element_id" };
  }

  try {
    const frameIds = await getFrameIdsForMainWorldBridge(tabId);
    const inject = (frameId: number) =>
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN" as any,
        func: async (
          tagId: string,
          fieldPath: string,
          fieldName: string,
          rawDisplayValue: string,
        ) => {
          const selector = `[data-os-tag="${tagId.replace(/"/g, '\\"')}"]`;
          const input =
            document.querySelector(selector) ??
            document.getElementById(`sys_display.${fieldPath}`) ??
            Array.from(
              document.getElementsByName(`sys_display.${fieldPath}`),
            )[0] ??
            null;
          if (!(input instanceof HTMLInputElement)) {
            return { ok: false, reason: "field_not_found" };
          }

          const displayValue = rawDisplayValue.trim();
          if (!displayValue)
            return { ok: false, reason: "empty_display_value" };

          const delay = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value: string): string =>
            value.replace(/\s+/g, " ").trim().toLowerCase();
          const normalizedDisplay = normalize(displayValue);
          const hiddenControl = () =>
            document.getElementById(fieldPath) ??
            Array.from(document.getElementsByName(fieldPath))[0] ??
            null;
          const getCommittedValue = (): string => {
            const gForm = (window as any).g_form;
            try {
              if (typeof gForm?.getValue === "function") {
                const value = gForm.getValue(fieldName);
                if (typeof value === "string" && value.trim()) {
                  return value.trim();
                }
              }
            } catch {
              // Fall through to hidden control lookup.
            }

            const hidden = hiddenControl();
            if (hidden instanceof HTMLInputElement && hidden.value.trim()) {
              return hidden.value.trim();
            }
            return "";
          };
          const isCommittedValue = (value: string): boolean =>
            !!value && normalize(value) !== normalizedDisplay;

          if (isCommittedValue(getCommittedValue())) return { ok: true };

          const view = input.ownerDocument?.defaultView ?? window;
          const setter = Object.getOwnPropertyDescriptor(
            view.HTMLInputElement.prototype,
            "value",
          )?.set;
          const setInputValue = (nextValue: string) => {
            if (setter) {
              setter.call(input, nextValue);
            } else {
              input.value = nextValue;
            }
          };
          const dispatchKeyboard = (
            type: string,
            key: string,
            init: KeyboardEventInit = {},
          ) => {
            const keyCode =
              key === "Enter"
                ? 13
                : key === "Backspace"
                  ? 8
                  : key.length === 1
                    ? key.toUpperCase().charCodeAt(0)
                    : undefined;
            input.dispatchEvent(
              new view.KeyboardEvent(type, {
                key,
                code: key === "Enter" ? "Enter" : undefined,
                keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true,
                composed: true,
                ...init,
              }),
            );
          };
          const dispatchInput = (data: string | null, inputType: string) => {
            input.dispatchEvent(
              new view.InputEvent("input", {
                bubbles: true,
                cancelable: true,
                composed: true,
                data,
                inputType,
              }),
            );
          };
          const emitAutocompleteSearch = async (searchValue: string) => {
            input.focus();
            try {
              input.setSelectionRange(0, input.value.length);
            } catch {
              // Some specialized inputs do not support selection ranges.
            }
            dispatchKeyboard("keydown", "a", { ctrlKey: true });
            dispatchKeyboard("keyup", "a", { ctrlKey: true });
            dispatchKeyboard("keydown", "Backspace");
            setInputValue("");
            dispatchInput(null, "deleteContentBackward");
            dispatchKeyboard("keyup", "Backspace");
            for (const char of searchValue) {
              dispatchKeyboard("keydown", char);
              setInputValue(input.value + char);
              dispatchInput(char, "insertText");
              dispatchKeyboard("keyup", char);
              await delay(15);
            }
            input.dispatchEvent(
              new view.Event("change", { bubbles: true, composed: true }),
            );
            dispatchKeyboard("keydown", searchValue.slice(-1) || " ");
            dispatchKeyboard("keyup", searchValue.slice(-1) || " ");
          };
          const isVisible = (node: Element): boolean => {
            if (!node.isConnected) return false;
            const style = view.getComputedStyle(node);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0"
            ) {
              return false;
            }
            const rect = node.getBoundingClientRect();
            return (
              rect.width > 0 || rect.height > 0 || !!node.textContent?.trim()
            );
          };
          const optionSelectors = [
            '[role="option"]',
            "tr[role='option']",
            ".ac_results tr",
            ".ac_results li",
            ".autocomplete tr",
            ".autocomplete li",
            ".typeahead tr",
            ".typeahead li",
            ".select2-results__option",
            ".ui-menu-item",
            "li.ui-menu-item",
            "[id^='AC.'] tr",
            "[id^='AC.'] li",
            "[aria-selected]",
          ];
          const optionMatches = (node: Element): boolean => {
            const text = normalize(node.textContent ?? "");
            if (!text) return false;
            if (text.includes(normalizedDisplay)) return true;
            const tokens = normalizedDisplay.split(" ").filter(Boolean);
            return (
              tokens.length > 0 && tokens.every((token) => text.includes(token))
            );
          };
          const findMatchingOption = (): HTMLElement | null => {
            const seen = new Set<Element>();
            for (const optionSelector of optionSelectors) {
              for (const node of Array.from(
                document.querySelectorAll(optionSelector),
              )) {
                if (seen.has(node)) continue;
                seen.add(node);
                if (
                  node instanceof HTMLElement &&
                  isVisible(node) &&
                  optionMatches(node)
                ) {
                  return node;
                }
              }
            }
            return null;
          };
          const extractSysId = (node: Element): string => {
            const attrs = [
              "sys_id",
              "sys-id",
              "data-sys-id",
              "data-sysid",
              "data-value",
              "data-id",
              "value",
            ];
            for (const attr of attrs) {
              const value = node.getAttribute(attr);
              if (value && /^[0-9a-f]{32}$/i.test(value)) return value;
            }
            const htmlMatch = node.outerHTML.match(/[0-9a-f]{32}/i);
            return htmlMatch?.[0] ?? "";
          };
          const forceCommit = (sysId: string): boolean => {
            if (!sysId) return false;
            let committed = false;
            const gForm = (window as any).g_form;
            try {
              if (typeof gForm?.setValue === "function") {
                gForm.setValue(fieldName, sysId, displayValue);
                committed = true;
              }
            } catch {
              // Hidden field fallback below covers frames without usable g_form.
            }
            const hidden = hiddenControl();
            if (hidden instanceof HTMLInputElement) {
              hidden.value = sysId;
              hidden.dispatchEvent(
                new view.Event("input", { bubbles: true, composed: true }),
              );
              hidden.dispatchEvent(
                new view.Event("change", { bubbles: true, composed: true }),
              );
              committed = true;
            }
            setInputValue(displayValue);
            input.setAttribute("value", displayValue);
            input.dispatchEvent(
              new view.Event("change", { bubbles: true, composed: true }),
            );
            return committed;
          };
          const clickOption = (option: HTMLElement) => {
            option.scrollIntoView?.({ block: "center", inline: "center" });
            const rect = option.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            const mouseInit: MouseEventInit = {
              bubbles: true,
              cancelable: true,
              composed: true,
              view,
              clientX,
              clientY,
              button: 0,
            };
            const pointerInit: PointerEventInit = {
              ...mouseInit,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
            };
            try {
              option.dispatchEvent(
                new view.PointerEvent("pointerdown", {
                  ...pointerInit,
                  buttons: 1,
                }),
              );
            } catch {
              // PointerEvent may be unavailable in older page contexts.
            }
            option.dispatchEvent(
              new view.MouseEvent("mousedown", { ...mouseInit, buttons: 1 }),
            );
            try {
              option.dispatchEvent(
                new view.PointerEvent("pointerup", {
                  ...pointerInit,
                  buttons: 0,
                }),
              );
            } catch {
              // PointerEvent may be unavailable in older page contexts.
            }
            option.dispatchEvent(new view.MouseEvent("mouseup", mouseInit));
            option.click();
          };

          const rawTokens = displayValue.split(/\s+/).filter(Boolean);
          const searchValues = [
            displayValue,
            rawTokens[0],
            rawTokens[0]?.length > 3 ? rawTokens[0].slice(0, 3) : null,
          ].filter(
            (value, index, values): value is string =>
              typeof value === "string" &&
              value.trim().length > 0 &&
              values.indexOf(value) === index,
          );

          for (const searchValue of searchValues) {
            for (let attempt = 0; attempt < 14; attempt++) {
              if (attempt === 0 || attempt === 5) {
                await emitAutocompleteSearch(searchValue);
              }

              const option = findMatchingOption();
              if (option) {
                const sysId = extractSysId(option);
                if (forceCommit(sysId)) {
                  await delay(100);
                  if (isCommittedValue(getCommittedValue()))
                    return { ok: true };
                }

                clickOption(option);
                for (let verify = 0; verify < 12; verify++) {
                  await delay(100);
                  if (isCommittedValue(getCommittedValue()))
                    return { ok: true };
                }
                return { ok: false, reason: "selection_unverified" };
              }

              await delay(100);
            }
          }

          dispatchKeyboard("keydown", "Enter");
          dispatchKeyboard("keyup", "Enter");
          for (let verify = 0; verify < 8; verify++) {
            await delay(100);
            if (isCommittedValue(getCommittedValue())) return { ok: true };
          }
          setInputValue(displayValue);
          input.dispatchEvent(
            new view.Event("change", { bubbles: true, composed: true }),
          );
          return { ok: false, reason: "no_matching_option" };
        },
        args: [
          String(id),
          candidate.fieldPath,
          candidate.fieldName,
          displayValue,
        ],
      });

    let lastReason = "field_not_found";
    for (const frameId of frameIds) {
      const results = await Promise.race([
        inject(frameId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("ServiceNow autocomplete select timed out")),
            5_000,
          ),
        ),
      ]).catch(() => null);
      for (const result of results ?? []) {
        const value = result.result as
          | { ok: true }
          | { ok: false; reason: string }
          | undefined;
        if (!value) continue;
        if (value.ok) return value;
        if (!value.ok && typeof value.reason === "string") {
          lastReason = value.reason;
        }
      }
    }
    return { ok: false, reason: lastReason };
  } catch {
    return { ok: false, reason: "autocomplete_failed" };
  }
}

async function mirrorTextInputInMainWorld(
  tabId: number,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const id = args.id;
  const text = args.text;
  if (
    (typeof id !== "number" && typeof id !== "string") ||
    typeof text !== "string"
  ) {
    return;
  }

  try {
    const frameIds = await getFrameIdsForMainWorldBridge(tabId);
    const inject = (frameId: number) =>
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN" as any,
        func: (tagId: string, value: string) => {
          const selector = `[data-os-tag="${tagId.replace(/"/g, '\\"')}"]`;
          const el = document.querySelector(selector);
          if (!el) return;

          if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement
          ) {
            const isAutocompleteLikeTextInput = (
              input: HTMLInputElement,
            ): boolean => {
              const role = input.getAttribute("role")?.toLowerCase() ?? "";
              const blob = [
                input.id,
                input.name,
                input.className,
                input.getAttribute("autocomplete"),
                input.getAttribute("aria-label"),
                input.getAttribute("aria-controls"),
                input.getAttribute("aria-haspopup"),
                input.getAttribute("aria-autocomplete"),
                input.getAttribute("placeholder"),
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

              return (
                role === "combobox" ||
                input.hasAttribute("list") ||
                input.hasAttribute("aria-autocomplete") ||
                /\b(combo|autocomplete|typeahead|suggest|lookup|reference)\b/.test(
                  blob,
                ) ||
                /\bsys_display\./.test(blob)
              );
            };

            const detectServiceNowReference = (
              input: HTMLInputElement,
            ): string | undefined => {
              const displayValue = value.trim();
              const displayName = input.name || input.id;
              if (!displayName.startsWith("sys_display.")) {
                return undefined;
              }
              if (!displayValue) {
                return "servicenow_reference_failed:empty_display_value";
              }

              const fieldPath = displayName.slice("sys_display.".length);
              const fieldName = fieldPath.includes(".")
                ? fieldPath.slice(fieldPath.indexOf(".") + 1)
                : fieldPath;
              const hiddenControl =
                document.getElementById(fieldPath) ??
                Array.from(document.getElementsByName(fieldPath))[0] ??
                null;

              const getReferenceAttr = (
                node: Element | null | undefined,
              ): string | null => {
                if (!node) return null;
                for (const attr of [
                  "data-ref",
                  "data-reference",
                  "data-ref-table",
                  "data-reference-table",
                  "reference",
                  "ref",
                ]) {
                  const attrValue = node.getAttribute(attr);
                  if (attrValue) return attrValue;
                }
                return null;
              };

              const inferReferenceTable = (): string | null => {
                const attrRef =
                  getReferenceAttr(input) ?? getReferenceAttr(hiddenControl);
                if (attrRef) return attrRef;

                const gForm = (window as any).g_form;
                try {
                  const uiElement =
                    gForm?.getGlideUIElement?.(fieldName) ??
                    gForm?.getControl?.(fieldName) ??
                    null;
                  for (const prop of [
                    "reference",
                    "referenceTable",
                    "refTable",
                    "refName",
                    "tableName",
                  ]) {
                    const propValue = uiElement?.[prop];
                    if (typeof propValue === "string" && propValue) {
                      return propValue;
                    }
                  }
                } catch {
                  // Fall through to common ServiceNow reference field names.
                }

                const commonRefs: Record<string, string> = {
                  assigned_to: "sys_user",
                  caller_id: "sys_user",
                  opened_by: "sys_user",
                  resolved_by: "sys_user",
                  assignment_group: "sys_user_group",
                  rfc: "change_request",
                  problem_id: "problem",
                  parent_incident: "incident",
                  business_service: "cmdb_ci_service",
                  service_offering: "service_offering",
                  cmdb_ci: "cmdb_ci",
                };
                return commonRefs[fieldName] ?? null;
              };

              const referenceTable = inferReferenceTable();
              if (!referenceTable) {
                return "servicenow_reference_failed:no_reference_table";
              }

              return `servicenow_reference_candidate:${JSON.stringify({
                fieldPath,
                fieldName,
                referenceTable,
              })}`;
            };

            if (
              el instanceof HTMLInputElement &&
              isAutocompleteLikeTextInput(el)
            ) {
              return detectServiceNowReference(el);
            }

            const commitServiceNowField = (): string | undefined => {
              const host = location.hostname.toLowerCase();
              if (
                !host.endsWith(".service-now.com") &&
                !host.endsWith(".servicenow.com")
              ) {
                return undefined;
              }
              const rawName = [
                (el as HTMLInputElement | HTMLTextAreaElement).name,
                (el as HTMLInputElement | HTMLTextAreaElement).id,
              ].find(
                (candidate) => candidate && !/^sys_original\./i.test(candidate),
              );
              if (!rawName) return undefined;
              if (/\b(?:search|typeahead|filter|query)\b/i.test(rawName)) {
                return undefined;
              }
              if (
                el instanceof HTMLInputElement &&
                [
                  "button",
                  "submit",
                  "reset",
                  "hidden",
                  "checkbox",
                  "radio",
                  "file",
                ].includes(el.type.toLowerCase())
              ) {
                return undefined;
              }
              const fieldName = rawName.includes(".")
                ? rawName.slice(rawName.lastIndexOf(".") + 1)
                : rawName;
              if (
                !fieldName ||
                (fieldName === rawName && !/^[a-z][a-z0-9_]*$/i.test(fieldName))
              ) {
                return undefined;
              }

              const gForm = (window as any).g_form;
              if (typeof gForm?.setValue !== "function") return undefined;
              try {
                gForm.setValue(fieldName, value);
                const committed =
                  typeof gForm?.getValue === "function"
                    ? String(gForm.getValue(fieldName) ?? "")
                    : value;
                return committed === value
                  ? "servicenow_field_committed"
                  : "servicenow_field_commit_attempted";
              } catch {
                return undefined;
              }
            };

            const dispatchInput = (
              data: string | null,
              inputType: string,
              previousValue: string,
            ) => {
              const tracker = (el as any)._valueTracker;
              if (tracker && typeof tracker.setValue === "function") {
                tracker.setValue(previousValue);
              }
              el.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  data,
                  inputType,
                }),
              );
            };
            const proto =
              el instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            const setValue = (nextValue: string) => {
              if (setter) {
                setter.call(el, nextValue);
              } else {
                el.value = nextValue;
              }
            };
            const setAndNotify = (
              nextValue: string,
              inputType: string,
              data: string | null,
            ) => {
              const previousValue = el.value;
              setValue(nextValue);
              dispatchInput(data, inputType, previousValue);
            };

            // React's value tracker may already match the visible DOM value after
            // the isolated-world action. Force a real MAIN-world value transition
            // so framework onChange handlers update state before submit clicks.
            el.focus();
            setAndNotify("", "deleteContentBackward", null);
            setAndNotify(value, "insertText", value);
            if (el instanceof HTMLInputElement) {
              el.setAttribute("value", value);
            }
            el.dispatchEvent(
              new Event("change", { bubbles: true, composed: true }),
            );
            return commitServiceNowField();
          }

          if ((el as HTMLElement).isContentEditable) {
            (el as HTMLElement).textContent = value;
            el.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                composed: true,
                data: value,
                inputType: "insertText",
              }),
            );
            el.dispatchEvent(
              new Event("change", { bubbles: true, composed: true }),
            );
          }
        },
        args: [String(id), text],
      });

    for (const frameId of frameIds) {
      const results = await Promise.race([
        inject(frameId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Main-world text bridge timed out")),
            5_000,
          ),
        ),
      ]).catch(() => null);
      const value = results?.find(
        (result) => typeof result.result === "string",
      )?.result;
      if (typeof value === "string") return value;
    }
    return undefined;
  } catch {
    // Best-effort: the content-script action already updated the visible DOM.
    return undefined;
  }
}

async function clickElementInMainWorld(
  tabId: number,
  args: Record<string, unknown>,
): Promise<boolean> {
  const id = args.id;
  if (typeof id !== "number" && typeof id !== "string") return false;

  try {
    const results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN" as any,
        func: async (tagId: string) => {
          const selector = `[data-os-tag="${tagId.replace(/"/g, '\\"')}"]`;
          const el = document.querySelector(selector);
          if (!(el instanceof HTMLElement)) return false;

          el.scrollIntoView({ block: "center", inline: "center" });
          const rect = el.getBoundingClientRect();
          const clientX = rect.left + rect.width / 2;
          const clientY = rect.top + rect.height / 2;
          const mouseInit: MouseEventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX,
            clientY,
            button: 0,
          };
          const pointerInit: PointerEventInit = {
            ...mouseInit,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          };

          try {
            el.dispatchEvent(
              new PointerEvent("pointerdown", {
                ...pointerInit,
                buttons: 1,
              }),
            );
          } catch {
            // PointerEvent may be unavailable in older page contexts.
          }
          el.dispatchEvent(
            new MouseEvent("mousedown", { ...mouseInit, buttons: 1 }),
          );
          el.focus({ preventScroll: true });
          try {
            el.dispatchEvent(
              new PointerEvent("pointerup", { ...pointerInit, buttons: 0 }),
            );
          } catch {
            // PointerEvent may be unavailable in older page contexts.
          }
          el.dispatchEvent(new MouseEvent("mouseup", mouseInit));
          el.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return true;
        },
        args: [String(id)],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Main-world click bridge timed out")),
          2_000,
        ),
      ),
    ]);
    return results?.some((result) => result.result === true) ?? false;
  } catch {
    // Best-effort: the content-script click already ran.
    return false;
  }
}

async function runReadOnlyPageInspector(
  tabId: number,
  func: (...args: any[]) => string,
  args: unknown[],
  emptyMessage: string,
): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN" as any,
      func,
      args,
    });
    const frames = (results || [])
      .map((result, index) =>
        typeof result.result === "string" && result.result.trim()
          ? `Frame ${index + 1}:\n${result.result.trim()}`
          : "",
      )
      .filter(Boolean);
    return frames.length > 0 ? frames.join("\n\n") : emptyMessage;
  } catch (e: any) {
    return `Error inspecting page: ${e.message}`;
  }
}

async function runAsyncReadOnlyPageInspector(
  tabId: number,
  func: (...args: any[]) => Promise<string> | string,
  args: unknown[],
  emptyMessage: string,
): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN" as any,
      func,
      args,
    });
    const frames = (results || [])
      .map((result, index) =>
        typeof result.result === "string" && result.result.trim()
          ? `Frame ${index + 1}:\n${result.result.trim()}`
          : "",
      )
      .filter(Boolean);
    return frames.length > 0 ? frames.join("\n\n") : emptyMessage;
  } catch (e: any) {
    return `Error inspecting page: ${e.message}`;
  }
}

// --- Registration ---

export function registerTools() {
  toolRegistry.register(
    ToolName.CLICK_ELEMENT,
    CLICK_DEF,
    async (args, tabId) => {
      const result = await executeContentTool(
        ToolName.CLICK_ELEMENT,
        args,
        tabId,
      );
      // Main-world click bridge is a fallback only. A successful content-script
      // click already activates React/Vue handlers on normal pages; mirroring it
      // here would double-submit buttons and double-advance pagination.
      const resultText = String(result);
      if (resultText.startsWith("Click intercepted!")) {
        const bridged = await clickElementInMainWorld(tabId, args);
        if (bridged) {
          return `Clicked [${String(args.id)}] via main-world event bridge after content-script interception.`;
        }
      }
      return result;
    },
  );
  toolRegistry.register(
    ToolName.TYPE_TEXT,
    TYPE_TEXT_DEF,
    async (args, tabId) => {
      const result = await executeContentTool(ToolName.TYPE_TEXT, args, tabId);
      // Main-world text bridge: controlled inputs in frameworks such as React can
      // ignore input events created in the extension's isolated world. Mirror the
      // final value and input/change events in MAIN so framework state matches the
      // visible DOM before later clicks submit the value.
      if (!String(result).startsWith("Error:")) {
        const bridgeStatus = await mirrorTextInputInMainWorld(tabId, args);
        const serviceNowCandidate =
          parseServiceNowReferenceCandidate(bridgeStatus);
        if (serviceNowCandidate && typeof args.text === "string") {
          let resolved = await resolveServiceNowReferenceFromBackground(
            tabId,
            serviceNowCandidate.referenceTable,
            args.text,
          );
          let autocompleteReason: string | null = null;
          let shouldTryAutocomplete =
            !resolved.ok &&
            (resolved.reason === "lookup_http_401" ||
              resolved.reason === "lookup_failed" ||
              resolved.reason === "lookup_timeout");
          if (!resolved.ok && resolved.reason === "lookup_http_401") {
            const pageResolved = await resolveServiceNowReferenceFromPage(
              tabId,
              args,
              serviceNowCandidate,
              args.text,
            );
            resolved = pageResolved;
            shouldTryAutocomplete = !resolved.ok;
          }
          if (!resolved.ok && shouldTryAutocomplete) {
            const selected =
              await selectServiceNowReferenceAutocompleteInMainWorld(
                tabId,
                args,
                serviceNowCandidate,
                args.text,
              );
            if (selected.ok) {
              return `${String(result)} (ServiceNow reference value committed)`;
            }
            autocompleteReason = selected.reason;
          }
          if (resolved.ok) {
            const committed = await commitServiceNowReferenceInMainWorld(
              tabId,
              args,
              serviceNowCandidate,
              resolved.sysId,
              args.text,
            );
            return committed
              ? `${String(result)} (ServiceNow reference value committed)`
              : `${String(result)} (ServiceNow reference commit failed: no_commit_target)`;
          }
          const suffix = autocompleteReason
            ? `${resolved.reason}; autocomplete_${autocompleteReason}`
            : resolved.reason;
          return `${String(result)} (ServiceNow reference commit failed: ${suffix})`;
        }
        if (bridgeStatus === "servicenow_reference_committed") {
          return `${String(result)} (ServiceNow reference value committed)`;
        }
        if (bridgeStatus === "servicenow_field_committed") {
          return `${String(result)} (ServiceNow field value committed)`;
        }
        if (bridgeStatus === "servicenow_field_commit_attempted") {
          return `${String(result)} (ServiceNow field value commit attempted)`;
        }
        if (bridgeStatus?.startsWith("servicenow_reference_failed:")) {
          return `${String(result)} (ServiceNow reference commit failed: ${bridgeStatus.slice("servicenow_reference_failed:".length)})`;
        }
      }
      return result;
    },
  );
  toolRegistry.register(ToolName.SCROLL_PAGE, SCROLL_PAGE_DEF, (args, tabId) =>
    executeContentTool(ToolName.SCROLL_PAGE, args, tabId),
  );
  toolRegistry.register(ToolName.READ_PAGE, READ_PAGE_DEF, (args, tabId) =>
    executeContentTool(ToolName.READ_PAGE, args, tabId),
  );

  // Content Script Tools (already implemented in content/actions.ts)
  toolRegistry.register(
    ToolName.HOVER_ELEMENT,
    HOVER_ELEMENT_DEF,
    (args, tabId) => executeContentTool(ToolName.HOVER_ELEMENT, args, tabId),
  );
  toolRegistry.register(
    ToolName.FIND_ELEMENT,
    FIND_ELEMENT_DEF,
    (args, tabId) => executeContentTool(ToolName.FIND_ELEMENT, args, tabId),
  );
  toolRegistry.register(
    ToolName.SELECT_OPTION,
    SELECT_OPTION_DEF,
    (args, tabId) => executeContentTool(ToolName.SELECT_OPTION, args, tabId),
  );
  toolRegistry.register(ToolName.PRESS_KEY, PRESS_KEY_DEF, (args, tabId) =>
    executeContentTool(ToolName.PRESS_KEY, args, tabId),
  );
  toolRegistry.register(
    ToolName.DRAG_AND_DROP,
    DRAG_AND_DROP_DEF,
    async (args, tabId) => {
      const sourceId = args.sourceId as number;
      const targetId = args.targetId as number;

      // Pre-validation: request a fresh snapshot and check both IDs exist
      try {
        const snapResponse = await chrome.tabs.sendMessage(tabId, {
          type: "DOM_SNAPSHOT_REQUEST",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: { refresh: true },
        });
        const elements = snapResponse?.payload?.snapshot?.elements;
        if (elements && Array.isArray(elements)) {
          const sourceExists = elements.some((el: any) => el.tag === sourceId);
          const targetExists = elements.some((el: any) => el.tag === targetId);

          if (!sourceExists || !targetExists) {
            const missing = [];
            if (!sourceExists) missing.push(`sourceId [${sourceId}]`);
            if (!targetExists) missing.push(`targetId [${targetId}]`);

            // Find similar elements to suggest
            const draggables = elements
              .filter(
                (el: any) =>
                  el.attributes?.draggable === "true" || el.tagName === "li",
              )
              .slice(0, 8);
            const suggestions =
              draggables.length > 0
                ? `\nAvailable draggable/list elements: ${draggables.map((el: any) => `[${el.tag}] ${el.tagName} "${(el.text || "").slice(0, 30)}"`).join(", ")}`
                : "";

            return `Error: Stale element IDs — ${missing.join(" and ")} no longer exist on the page.${suggestions}\nCall read_page to get fresh element IDs before retrying.`;
          }
        }
      } catch {
        // Pre-validation failed (non-critical) — proceed with execution anyway
      }

      return executeContentTool(ToolName.DRAG_AND_DROP, args, tabId);
    },
  );
  toolRegistry.register(
    ToolName.HIDE_ELEMENT,
    HIDE_ELEMENT_DEF,
    (args, tabId) => executeContentTool(ToolName.HIDE_ELEMENT, args, tabId),
  );

  toolRegistry.register(
    ToolName.DISMISS_OVERLAYS,
    DISMISS_OVERLAYS_DEF,
    async (_args, tabId) => {
      logger.info("tools", "dismiss_overlays", { tabId });
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "DISMISS_MODALS",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          payload: {},
        });
        const { dismissed, remainingOverlay } = response.payload;
        let msg =
          dismissed > 0
            ? `Dismissed ${dismissed} overlay(s).`
            : "No overlays found.";
        if (remainingOverlay) {
          msg += ` Warning: overlay [${remainingOverlay.tagId}] still covers ${remainingOverlay.coveragePercent}% of viewport. Use hide_element to remove it.`;
        }
        return msg;
      } catch (e: any) {
        return `Error dismissing overlays: ${e.message}`;
      }
    },
  );

  // Escalation tool (intercepted by agent loop before executor runs)
  toolRegistry.register(ToolName.ESCALATE, ESCALATE_DEF, async (args) => {
    // This executor is a fallback — the loop intercepts escalate before reaching here
    return `Escalation requested: ${(args.reason as string) || "no reason given"}`;
  });

  toolRegistry.register(ToolName.CLARIFY, CLARIFY_DEF, async (args) => {
    // This executor is a fallback — the loop intercepts clarify before reaching here
    return `Clarification requested: ${(args.question as string) || "no question given"}`;
  });

  // Service Worker Tools (chrome.* APIs)
  toolRegistry.register(
    ToolName.NAVIGATE,
    NAVIGATE_DEF,
    async (args, tabId) => {
      const url = args.url as string | undefined;
      const query = args.query as string | undefined;

      if (url && query) return "Error: provide url OR query, not both.";
      if (!url && !query) return "Error: provide either url or query.";

      const target = url ? url : `search: "${query}"`;
      logger.info("tools", "navigate", { tabId, url, query, target });

      const allowedOrigins = await getAllowedNavigationOrigins();
      if (allowedOrigins.length > 0) {
        if (query) {
          return (
            `Error: External web search is blocked for this task. Allowed origin` +
            `${allowedOrigins.length === 1 ? "" : "s"}: ${allowedOrigins.join(", ")}. ` +
            "Use the current application's own navigation or search controls instead."
          );
        }
        const targetOrigin = normalizeOrigin(url!);
        const normalizedAllowed = allowedOrigins
          .map(normalizeOrigin)
          .filter((origin): origin is string => Boolean(origin));
        if (!targetOrigin || !normalizedAllowed.includes(targetOrigin)) {
          return navigationBoundaryError(
            url!,
            normalizedAllowed.length > 0 ? normalizedAllowed : allowedOrigins,
          );
        }
      }

      clearTabReady(tabId);
      if (url) {
        const urlResult = sanitizeUrl(url);
        if (!urlResult.ok) return `Error: ${urlResult.error}`;
        await chrome.tabs.update(tabId, { url: urlResult.value });
      } else {
        await chrome.search.query({ text: query!, disposition: "CURRENT_TAB" });
      }

      await waitForNavigation(tabId);
      await waitForContentScriptReady(tabId, 2000);
      return `Navigated to ${target}. Page has loaded. Fresh page snapshot is available.`;
    },
  );

  toolRegistry.register(
    ToolName.OPEN_SERVICENOW_MODULE,
    OPEN_SERVICENOW_MODULE_DEF,
    async (args, tabId) => {
      const application =
        typeof args.application === "string" ? args.application.trim() : "";
      const path = Array.isArray(args.path)
        ? args.path
            .filter((segment): segment is string => typeof segment === "string")
            .map((segment) => segment.trim())
            .filter(Boolean)
        : [];
      const shouldRun = args.run !== false;

      if (path.length === 0) {
        return "Error: open_servicenow_module requires a non-empty path array.";
      }

      logger.info("tools", "open_servicenow_module", {
        tabId,
        application,
        path,
        shouldRun,
      });

      const originResult = await getServiceNowTabOrigin(tabId);
      if (!originResult.ok) {
        return [
          `Error: Could not resolve ServiceNow module (${originResult.reason}).`,
          `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
        ].join("\n");
      }

      const alreadyOpen = await detectAlreadyOpenServiceNowModule(
        tabId,
        originResult.origin,
        path,
      );
      if (alreadyOpen.ok) {
        const result = [
          "ServiceNow module is already open.",
          `Winning path: current_page`,
          `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
          `Page title: ${alreadyOpen.title}`,
          `Target: ${alreadyOpen.target}`,
          `URL: ${alreadyOpen.url}`,
          `Matched by: ${alreadyOpen.matchedBy.join("; ")}`,
        ].join("\n");
        return {
          result,
          evidence: serviceNowModuleEvidence({
            winningPath: "current_page",
            application: application || "unknown",
            path,
            moduleTitle: path[path.length - 1],
            target: alreadyOpen.target,
            targetUrl: alreadyOpen.url,
            matchedBy: alreadyOpen.matchedBy,
          }),
        };
      }

      if (!shouldRun) {
        const resolved = await resolveServiceNowModule(
          tabId,
          application,
          path,
          originResult.origin,
        );
        if (!resolved.ok) {
          const candidateLines = summarizeServiceNowModuleCandidates(
            resolved.candidates,
          );
          return [
            `Error: Could not resolve ServiceNow module (${resolved.reason}).`,
            `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
            resolved.candidateCount !== undefined
              ? `Candidate count: ${resolved.candidateCount}`
              : "",
            candidateLines ? `Top candidates:\n${candidateLines}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        }

        return [
          "Resolved ServiceNow module.",
          `Application: ${resolved.module.application || application || "unknown"}`,
          `Module: ${resolved.module.title}`,
          `Module sys_id: ${resolved.module.sysId}`,
          `Target: ${resolved.target}`,
          `Target URL: ${resolved.targetUrl}`,
          `Candidate count: ${resolved.candidateCount}`,
        ].join("\n");
      }

      const raceStartedAt = Date.now();
      let metadataOutcome: TimedServiceNowResult<
        ResolvedServiceNowModule | ServiceNowModuleResolutionFailure
      > | null = null;
      let navigatorOutcome: TimedServiceNowResult<ServiceNowNavigatorCandidateResult> | null =
        null;
      let metadataPending = true;
      let navigatorPending = true;
      let navigatorCommitFailure: string | null = null;
      const metadataPromise = withServiceNowTiming(
        resolveServiceNowModule(tabId, application, path, originResult.origin),
      ).then((outcome) => ({ source: "metadata" as const, outcome }));
      const navigatorPromise = withServiceNowTiming(
        (async () => {
          const snapshotCandidate =
            await prepareServiceNowSnapshotNavigatorCandidate(
              tabId,
              originResult.origin,
              application,
              path,
            );
          if (snapshotCandidate.ok) return snapshotCandidate;
          const navigatorCandidate = await prepareServiceNowNavigatorCandidate(
            tabId,
            originResult.origin,
            application,
            path,
          );
          if (navigatorCandidate.ok) return navigatorCandidate;
          return {
            ok: false,
            reason: `${snapshotCandidate.reason}; ${navigatorCandidate.reason}`,
          } as ServiceNowNavigatorCandidateResult;
        })(),
      ).then((outcome) => ({ source: "navigator" as const, outcome }));

      while (metadataPending || navigatorPending) {
        const next = await Promise.race(
          [
            metadataPending ? metadataPromise : null,
            navigatorPending ? navigatorPromise : null,
          ].filter(
            (
              promise,
            ): promise is typeof metadataPromise | typeof navigatorPromise =>
              Boolean(promise),
          ),
        );

        if (next.source === "metadata") {
          metadataPending = false;
          metadataOutcome = next.outcome;
          const resolved = metadataOutcome.value;
          if (resolved?.ok) {
            await commitResolvedServiceNowModule(tabId, resolved);
            const result = [
              "Opened ServiceNow module.",
              "Winning path: metadata",
              `Application: ${resolved.module.application || application || "unknown"}`,
              `Module: ${resolved.module.title}`,
              `Module sys_id: ${resolved.module.sysId}`,
              `Target: ${resolved.target}`,
              `Target URL: ${resolved.targetUrl}`,
              `Candidate count: ${resolved.candidateCount}`,
              summarizeServiceNowMetadataOutcome(
                metadataOutcome,
                raceStartedAt,
              ),
              summarizeServiceNowNavigatorOutcome(
                navigatorOutcome,
                raceStartedAt,
              ),
            ].join("\n");
            return {
              result,
              evidence: serviceNowModuleEvidence({
                winningPath: "metadata",
                application:
                  resolved.module.application || application || "unknown",
                path,
                moduleTitle: resolved.module.title,
                moduleSysId: resolved.module.sysId,
                target: resolved.target,
                targetUrl: resolved.targetUrl,
              }),
            };
          }
          continue;
        }

        navigatorPending = false;
        navigatorOutcome = next.outcome;
        const candidate = navigatorOutcome.value;
        if (candidate?.ok) {
          try {
            const commitPath = await commitServiceNowNavigatorCandidate(
              tabId,
              candidate,
            );
            if (commitPath !== "navigator_click_unavailable") {
              const result = [
                "Opened ServiceNow module via navigator fallback.",
                `Winning path: ${commitPath}`,
                `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
                `Navigator query: ${candidate.query}`,
                `Candidate: ${candidate.candidateText}`,
                candidate.target ? `Target: ${candidate.target}` : "",
                candidate.targetUrl ? `Target URL: ${candidate.targetUrl}` : "",
                summarizeServiceNowMetadataOutcome(
                  metadataOutcome,
                  raceStartedAt,
                ),
                summarizeServiceNowNavigatorOutcome(
                  navigatorOutcome,
                  raceStartedAt,
                ),
              ]
                .filter(Boolean)
                .join("\n");
              return {
                result,
                evidence: serviceNowModuleEvidence({
                  winningPath: commitPath,
                  application: application || "unknown",
                  path,
                  candidate: candidate.candidateText,
                  navigatorQuery: candidate.query,
                  target: candidate.target ?? null,
                  targetUrl: candidate.targetUrl ?? null,
                }),
              };
            }
            navigatorCommitFailure = commitPath;
          } catch (error) {
            navigatorCommitFailure =
              error instanceof Error
                ? error.message
                : "navigator_commit_failed";
          }
        }
      }

      const resolved = metadataOutcome?.value;
      const candidateLines =
        resolved && !resolved.ok
          ? summarizeServiceNowModuleCandidates(resolved.candidates)
          : "";
      return [
        `Error: Could not resolve ServiceNow module (${
          resolved && !resolved.ok
            ? resolved.reason
            : metadataOutcome?.error || "metadata_unavailable"
        }).`,
        `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
        summarizeServiceNowMetadataOutcome(metadataOutcome, raceStartedAt),
        summarizeServiceNowNavigatorOutcome(navigatorOutcome, raceStartedAt),
        navigatorCommitFailure
          ? `Navigator commit reason: ${navigatorCommitFailure}`
          : "",
        resolved && !resolved.ok && resolved.candidateCount !== undefined
          ? `Candidate count: ${resolved.candidateCount}`
          : "",
        candidateLines ? `Top candidates:\n${candidateLines}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  );

  toolRegistry.register(
    ToolName.SEARCH_KNOWLEDGE_BASE,
    SEARCH_KNOWLEDGE_BASE_DEF,
    async (args, tabId) => {
      const question =
        typeof args.question === "string" ? args.question.trim() : "";
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const answerType =
        args.answerType === "number" || args.answerType === "text"
          ? args.answerType
          : "auto";
      const maxResults = Math.min(
        Math.max(Number(args.maxResults ?? 5) || 5, 1),
        10,
      );

      if (!question) {
        return "Error: search_knowledge_base requires a question.";
      }

      logger.info("tools", "search_knowledge_base", {
        tabId,
        question: question.slice(0, 160),
        query,
        answerType,
        maxResults,
      });

      return runAsyncReadOnlyPageInspector(
        tabId,
        async (
          input: {
            question: string;
            query: string;
            answerType: string;
            maxResults: number;
          },
        ) => {
          const normalize = (value: unknown) =>
            String(value ?? "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          const stopWords = new Set([
            "a",
            "an",
            "and",
            "are",
            "answer",
            "as",
            "at",
            "be",
            "by",
            "base",
            "company",
            "does",
            "each",
            "for",
            "following",
            "from",
            "how",
            "in",
            "is",
            "it",
            "knowledge",
            "make",
            "many",
            "of",
            "on",
            "or",
            "our",
            "requested",
            "should",
            "the",
            "this",
            "to",
            "typically",
            "using",
            "what",
            "when",
            "where",
            "who",
            "with",
            "would",
            "year",
            "your",
          ]);
          const keywords = (text: string) => {
            const words = normalize(text)
              .toLowerCase()
              .match(/[a-z0-9]+/g);
            return [...new Set(words ?? [])].filter(
              (word) => word.length > 2 && !stopWords.has(word),
            );
          };
          const terms = keywords(`${input.question} ${input.query}`);
          const answerIntentTerms = new Set([
            "amount",
            "count",
            "number",
            "percent",
            "percentage",
            "total",
          ]);
          const questionTopicTerms = keywords(input.question).filter(
            (term) => !answerIntentTerms.has(term),
          );
          const hasHiringQuestion =
            /\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(
              input.question,
            );
          const expandedTopicVariants = hasHiringQuestion
            ? [
                "new hires",
                "hires",
                "hiring",
                "recruitment",
                "headcount",
                "careers opportunities",
                "talent acquisition",
                "team expansion",
              ]
            : [];
          const hasQuestionTopicCue = (text: string) => {
            if (hasHiringQuestion) {
              return /\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(
                text,
              );
            }
            const lower = normalize(text).toLowerCase();
            return (
              questionTopicTerms.length === 0 ||
              questionTopicTerms.some((term) => {
                if (lower.includes(term)) return true;
                if (term.endsWith("s") && lower.includes(term.slice(0, -1))) {
                  return true;
                }
                return false;
              })
            );
          };
          const queryText =
            input.query ||
            terms.slice(0, 6).join(" ") ||
            normalize(input.question);
          const uniqueNonEmpty = (values: string[]) =>
            values
              .map((value) => value.trim())
              .filter(
                (value, index, all) => Boolean(value) && all.indexOf(value) === index,
              );
          const queryVariants = uniqueNonEmpty([
            questionTopicTerms.slice(0, 4).join(" "),
            questionTopicTerms.slice(0, 2).join(" "),
            questionTopicTerms[0] ?? "",
            queryText,
            terms.slice(0, 3).join(" "),
            terms.slice(0, 2).join(" "),
            terms[0] ?? "",
            ...expandedTopicVariants,
          ]);
          const renderedSearchQueryText =
            questionTopicTerms.slice(0, 3).join(" ") || queryText;
          const wantsNumber =
            input.answerType === "number" ||
            (input.answerType === "auto" &&
              /\b(number|count|how many|percent|percentage|amount|total|year|date)\b/i.test(
                input.question,
              ));
          const scoreText = (text: string) => {
            const lower = normalize(text).toLowerCase();
            let score = 0;
            for (const term of terms) {
              if (lower.includes(term)) score += term.length > 5 ? 3 : 2;
            }
            if (/\b(new hires?|hire|hiring|recruitment|recruits?)\b/i.test(text)) {
              score += 5;
            }
            if (
              hasHiringQuestion &&
              /\b(?:careers?|opportunit(?:y|ies)|talent acquisition|team expansion)\b/i.test(
                text,
              )
            ) {
              score += 4;
            }
            if (/\b(year|annual|annually|each year|per year)\b/i.test(text)) {
              score += 4;
            }
            if (/\b\d[\d,]*(?:\.\d+)?\b/.test(text)) score += 3;
            if (/\b(views?|rating|updated|authored|metadata|kb\d+)\b/i.test(text)) {
              score -= 8;
            }
            return score;
          };
          const absoluteUrl = (href: string) => {
            try {
              return new URL(href, location.href).href;
            } catch {
              return "";
            }
          };
          const startedAt = Date.now();
          const hasBudget = () => Date.now() - startedAt < 18000;
          const fetchWithTimeout = async (
            url: string,
            init: RequestInit = {},
            timeoutMs = 4000,
          ) => {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
              return await fetch(url, {
                ...init,
                signal: controller.signal,
              });
            } finally {
              window.clearTimeout(timeout);
            }
          };
          const targetUrl = (href: string) => {
            const direct = absoluteUrl(href);
            if (!direct) return "";
            try {
              const parsed = new URL(direct);
              if (parsed.pathname.includes("/now/nav/ui/classic/params/target/")) {
                const encoded = parsed.pathname.split("/target/")[1] || "";
                return new URL(decodeURIComponent(encoded) + parsed.search, parsed.origin).href;
              }
            } catch {
              return direct;
            }
            return direct;
          };
          const isKnowledgeArticleUrl = (url: string) =>
            /(?:kb_article_view|\/article-|sys_kb_id=|sysparm_article=|kb_knowledge\.do|kb_view\.do)/i.test(
              url,
            );
          const searchUrls = () => {
            const urls = new Set<string>();
            try {
              const current = new URL(location.href);
              const currentKnowledgeBase = current.searchParams.get("kb_knowledge_base");
              for (const variant of queryVariants) {
                const encoded = encodeURIComponent(variant);
                if (current.pathname.includes("/kb")) {
                  urls.add(new URL(`?id=kb_search&query=${encoded}`, current.href).href);
                  if (currentKnowledgeBase) {
                    urls.add(
                      new URL(
                        `?id=kb_search&kb_knowledge_base=${encodeURIComponent(
                          currentKnowledgeBase,
                        )}&query=${encoded}`,
                        current.href,
                      ).href,
                    );
                  }
                }
                urls.add(new URL(`/kb?id=kb_search&query=${encoded}`, current.origin).href);
                urls.add(new URL(`/sp?id=kb_search&query=${encoded}`, current.origin).href);
              }
            } catch {
              // Ignore malformed locations.
            }
            return [...urls];
          };
          const scopedKnowledgeSearchUrlsFromDocument = (doc: Document) => {
            const encoded = encodeURIComponent(queryText);
            const urls = new Set<string>();
            for (const anchor of [
              ...doc.querySelectorAll<HTMLAnchorElement>("a[href]"),
            ]) {
              const href = anchor.getAttribute("href") || "";
              let parsed: URL;
              try {
                parsed = new URL(href, location.href);
              } catch {
                continue;
              }
              const knowledgeBase = parsed.searchParams.get("kb_knowledge_base");
              if (!knowledgeBase) continue;
              parsed.searchParams.set("id", "kb_search");
              parsed.searchParams.set("query", queryText);
              urls.add(parsed.href);
              try {
                urls.add(
                  new URL(
                    `/kb?id=kb_search&kb_knowledge_base=${encodeURIComponent(
                      knowledgeBase,
                    )}&query=${encoded}`,
                    location.origin,
                  ).href,
                );
              } catch {
                // Keep the href-based scoped search URL.
              }
            }
            return [...urls].slice(0, 8);
          };
          const collectDeep = <T extends Element>(
            root: Document | DocumentFragment | Element,
            selector: string,
          ): T[] => {
            const results = [
              ...root.querySelectorAll<T>(selector),
            ];
            for (const element of root.querySelectorAll<Element>("*")) {
              const shadowRoot = element.shadowRoot;
              if (shadowRoot) {
                results.push(...collectDeep<T>(shadowRoot, selector));
              }
            }
            return results;
          };
          const textFromDom = (
            root: Document | DocumentFragment | Element | ChildNode | null,
          ) => {
            const parts: string[] = [];
            const visit = (node: ChildNode | Document | DocumentFragment | null) => {
              if (!node || parts.join(" ").length > 60000) return;
              if (node.nodeType === Node.TEXT_NODE) {
                const text = normalize(node.textContent || "");
                if (text) parts.push(text);
                return;
              }
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (/^(script|style|noscript|svg)$/i.test(element.tagName)) {
                  return;
                }
                if (element.shadowRoot) visit(element.shadowRoot);
              }
              for (const child of [...node.childNodes]) visit(child);
            };
            visit(root);
            return normalize(parts.join(" "));
          };
          const cleanDocument = (doc: Document) =>
            normalize((doc.body as HTMLElement | null)?.innerText || textFromDom(doc));
          const resultLinksFromDocument = (doc: Document) => {
            const links = collectDeep<HTMLAnchorElement>(doc, "a[href]");
            const nearbyTextForAnchor = (anchor: HTMLAnchorElement) => {
              const title = normalize(
                anchor.innerText ||
                  textFromDom(anchor) ||
                  anchor.getAttribute("aria-label") ||
                  anchor.getAttribute("href") ||
                  "",
              );
              const focusAroundTitle = (text: string) => {
                if (text.length <= 800 || !title) return text;
                const index = text.toLowerCase().indexOf(title.toLowerCase());
                if (index < 0) return text;
                const start = Math.max(0, index - 80);
                return text.slice(start, start + 1100);
              };
              let best = title;
              let bestScore = scoreText(title);
              let current: Element | null = anchor;
              for (let depth = 0; current && depth < 7; depth += 1) {
                const text = focusAroundTitle(textFromDom(current));
                if (!text || text.length < title.length) {
                  current = current.parentElement;
                  continue;
                }
                let score = scoreText(text);
                if (text.length > title.length + 80) score += 5;
                if (text.length > 1400) score -= 3;
                if (score > bestScore) {
                  best = text;
                  bestScore = score;
                }
                current = current.parentElement;
              }
              return best;
            };
            return links
              .map((anchor) => {
                const href = anchor.getAttribute("href") || "";
                const url = targetUrl(href);
                const title = normalize(
                  anchor.innerText ||
                    anchor.textContent ||
                    anchor.getAttribute("aria-label") ||
                    href,
                );
                const nearby = nearbyTextForAnchor(anchor);
                return { title, url, snippet: nearby.slice(0, 800) };
              })
              .filter(
                (entry) =>
                  entry.url &&
                  entry.title &&
                  isKnowledgeArticleUrl(entry.url),
              );
          };
          const fetchDocument = async (url: string) => {
            const response = await fetchWithTimeout(url, {
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const html = await response.text();
            return new DOMParser().parseFromString(html, "text/html");
          };
          const textFromHtml = (html: string) => {
            const doc = new DOMParser().parseFromString(html || "", "text/html");
            return normalize(doc.body?.innerText || doc.body?.textContent || html);
          };
          const textFromJson = (value: unknown) => {
            const strings: string[] = [];
            const visit = (entry: unknown, depth: number) => {
              if (depth > 8 || strings.join(" ").length > 24000) return;
              if (typeof entry === "string") {
                const text = normalize(entry.replace(/<[^>]+>/g, " "));
                if (text.length > 2 && !/^[-_a-z0-9:/.?=&%]+$/i.test(text)) {
                  strings.push(text);
                }
                return;
              }
              if (Array.isArray(entry)) {
                for (const item of entry) visit(item, depth + 1);
                return;
              }
              if (entry && typeof entry === "object") {
                for (const item of Object.values(entry as Record<string, unknown>)) {
                  visit(item, depth + 1);
                }
              }
            };
            visit(value, 0);
            let serialized = "";
            try {
              serialized = JSON.stringify(value)
                .replace(/<[^>]+>/g, " ")
                .replace(/[{}[\]",:]/g, " ");
            } catch {
              serialized = "";
            }
            return normalize(`${strings.join(" ")} ${serialized}`);
          };
          const fetchServicePortalPageText = async (
            pageId: string,
            params: Record<string, string>,
          ) => {
            if (!hasBudget()) return "";
            try {
              const queryParams = new URLSearchParams({
                sysparm_type: "page",
                sysparm_id: pageId,
                ...params,
              });
              const response = await fetchWithTimeout(
                `/api/now/sp/page?${queryParams.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (!response.ok) return "";
              const payload = await response.json().catch(() => null);
              const text = textFromJson(payload);
              return text === "null" ? "" : text;
            } catch {
              return "";
            }
          };
          const sysKbIdFromUrl = (url: string) => {
            try {
              const parsed = new URL(url, location.href);
              return normalize(
                parsed.searchParams.get("sys_kb_id") ||
                  parsed.searchParams.get("sys_id") ||
                  parsed.searchParams.get("sysparm_article"),
              );
            } catch {
              return "";
            }
          };
          const slugFromTitle = (title: string) =>
            normalize(title)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
          const articleNumbersFromText = (text: string) => {
            const numbers = new Set<string>();
            for (const match of normalize(text).matchAll(/\bKB\d{4,}\b/gi)) {
              numbers.add(match[0].toUpperCase());
            }
            const articleMatch = normalize(text).match(/\bArticle\s+(\d{1,5})\b/i);
            if (articleMatch) {
              const articleIndex = articleMatch[1];
              numbers.add(`KB${articleIndex.padStart(7, "0")}`);
              numbers.add(`KB001${articleIndex.padStart(4, "0")}`);
            }
            return [...numbers];
          };
          const articleFetchUrls = (result: { title: string; url: string }) => {
            const urls = new Set<string>([result.url]);
            const sysKbId = sysKbIdFromUrl(result.url);
            const slug = slugFromTitle(result.title);
            try {
              const parsed = new URL(result.url, location.href);
              if (sysKbId) {
                urls.add(
                  new URL(
                    `/kb_view.do?sys_kb_id=${encodeURIComponent(sysKbId)}`,
                    parsed.origin,
                  ).href,
                );
                urls.add(
                  new URL(
                    `/kb_knowledge.do?sys_id=${encodeURIComponent(sysKbId)}`,
                    parsed.origin,
                  ).href,
                );
              }
              if (sysKbId && slug) {
                const basePath = parsed.pathname.startsWith("/kb/en")
                  ? "/kb/en"
                  : "/kb/en";
                urls.add(
                  new URL(
                    `${basePath}/${slug}?sys_kb_id=${encodeURIComponent(sysKbId)}&id=kb_article_view`,
                    parsed.origin,
                  ).href,
                );
              }
              for (const articleNumber of articleNumbersFromText(result.title)) {
                urls.add(
                  new URL(
                    `/kb_view.do?sysparm_article=${encodeURIComponent(articleNumber)}`,
                    parsed.origin,
                  ).href,
                );
              }
            } catch {
              // Keep the original URL when canonical route construction fails.
            }
            return [...urls];
          };
          const recordFromKnowledgeRow = (row: any) => {
            if (!row) return null;
            const number = normalize(
              row?.number?.display_value ?? row?.number?.value ?? row?.number,
            );
            const title = normalize(
              row?.short_description?.display_value ??
                row?.short_description?.value ??
                row?.short_description ??
                number,
            );
            const text = textFromHtml(
              normalize(row?.text?.display_value ?? row?.text?.value ?? row?.text),
            );
            if (!text) return null;
            return {
              title: number && title ? `${number} ${title}` : title,
              text,
            };
          };
          const fetchServiceNowKnowledgeRecordBySysId = async (sysId: string) => {
            if (!sysId || !hasBudget()) return null;
            try {
              const params = new URLSearchParams({
                sysparm_query: `sys_id=${sysId}`,
                sysparm_fields: "sys_id,number,short_description,text",
                sysparm_limit: "1",
                sysparm_display_value: "all",
              });
              const response = await fetchWithTimeout(
                `/api/now/table/kb_knowledge?${params.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (!response.ok) return null;
              const payload = await response.json().catch(() => null);
              const row = Array.isArray(payload?.result)
                ? payload.result[0]
                : null;
              const record = recordFromKnowledgeRow(row);
              if (record) return record;
            } catch {
              // Try the direct record API below.
            }
            try {
              const params = new URLSearchParams({
                sysparm_fields: "sys_id,number,short_description,text",
                sysparm_display_value: "all",
              });
              const response = await fetchWithTimeout(
                `/api/now/table/kb_knowledge/${encodeURIComponent(sysId)}?${params.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (response.ok) {
                const payload = await response.json().catch(() => null);
                const record = recordFromKnowledgeRow(payload?.result);
                if (record) return record;
              }
            } catch {
              // Try legacy HTML article endpoints below.
            }
            const portalText = await fetchServicePortalPageText(
              "kb_article_view",
              { sys_kb_id: sysId },
            );
            if (portalText) {
              return {
                title: `Knowledge article ${sysId}`,
                text: portalText,
              };
            }
            const legacyArticleUrls = [
              `/kb_view.do?sys_kb_id=${encodeURIComponent(sysId)}`,
              `/kb_knowledge.do?sys_id=${encodeURIComponent(sysId)}`,
            ];
            for (const url of legacyArticleUrls) {
              if (!hasBudget()) break;
              try {
                const doc = await fetchDocument(url);
                const text = cleanDocument(doc);
                if (text) {
                  return {
                    title: `Knowledge article ${sysId}`,
                    text,
                  };
                }
              } catch {
                // Keep trying available ServiceNow article shapes.
              }
            }
            return null;
          };
          const fetchServiceNowKnowledgeRecordByNumber = async (
            articleNumber: string,
          ) => {
            const number = normalize(articleNumber).toUpperCase();
            if (!number || !hasBudget()) return null;
            try {
              const params = new URLSearchParams({
                sysparm_query: `number=${number}`,
                sysparm_fields: "sys_id,number,short_description,text",
                sysparm_limit: "1",
                sysparm_display_value: "all",
              });
              const response = await fetchWithTimeout(
                `/api/now/table/kb_knowledge?${params.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (response.ok) {
                const payload = await response.json().catch(() => null);
                const row = Array.isArray(payload?.result)
                  ? payload.result[0]
                  : null;
                const record = recordFromKnowledgeRow(row);
                if (record) return record;
              }
            } catch {
              // Try classic article pages below.
            }
            const portalText = await fetchServicePortalPageText(
              "kb_article_view",
              { sysparm_article: number },
            );
            if (portalText) {
              return {
                title: `Knowledge article ${number}`,
                text: portalText,
              };
            }
            const legacyArticleUrls = [
              `/kb_view.do?sysparm_article=${encodeURIComponent(number)}`,
              `/kb_knowledge.do?sysparm_query=number=${encodeURIComponent(number)}`,
            ];
            for (const url of legacyArticleUrls) {
              if (!hasBudget()) break;
              try {
                const doc = await fetchDocument(url);
                const text = cleanDocument(doc);
                if (text) {
                  return {
                    title: `Knowledge article ${number}`,
                    text,
                  };
                }
              } catch {
                // Keep trying available ServiceNow article shapes.
              }
            }
            return null;
          };
          const fetchServiceNowKnowledgeRecords = async () => {
            const looksLikeServiceNow =
              /service-now\.com$/i.test(location.hostname) ||
              /\/now\/|\/kb(?:\?|\/|$)|\/sp(?:\?|\/|$)/i.test(location.pathname);
            if (!looksLikeServiceNow) return [];
            const records: Array<{ title: string; url: string; snippet: string; text: string }> = [];
            const seenRecordUrls = new Set<string>();
            const appendRecords = async (params: URLSearchParams) => {
              if (!hasBudget()) return;
              const response = await fetchWithTimeout(
                `/api/now/table/kb_knowledge?${params.toString()}`,
                {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                },
              );
              if (!response.ok) return;
              const payload = await response.json().catch(() => null);
              const result = Array.isArray(payload?.result) ? payload.result : [];
              for (const row of result) {
                const sysId = normalize(row?.sys_id?.value ?? row?.sys_id);
                const number = normalize(row?.number?.display_value ?? row?.number?.value ?? row?.number);
                const title = normalize(
                  row?.short_description?.display_value ??
                    row?.short_description?.value ??
                    row?.short_description ??
                    number,
                );
                const text = textFromHtml(
                  normalize(row?.text?.display_value ?? row?.text?.value ?? row?.text),
                );
                if (!title || !text) continue;
                const url = sysId
                  ? new URL(
                      `/kb?id=kb_article_view&sys_kb_id=${encodeURIComponent(sysId)}`,
                      location.origin,
                    ).href
                  : new URL(`/kb?id=kb_search&query=${encodeURIComponent(queryText)}`, location.origin).href;
                if (seenRecordUrls.has(url)) continue;
                seenRecordUrls.add(url);
                records.push({
                  title: number ? `${number} ${title}` : title,
                  url,
                  snippet: text.slice(0, 800),
                  text,
                });
              }
            };
            for (const variant of queryVariants) {
              if (!hasBudget()) break;
              const params = new URLSearchParams({
                sysparm_query: `short_descriptionLIKE${variant}^ORtextLIKE${variant}`,
                sysparm_fields: "sys_id,number,short_description,text",
                sysparm_limit: String(Math.max(input.maxResults, 5)),
                sysparm_display_value: "all",
              });
              try {
                await appendRecords(params);
              } catch {
                // Some ServiceNow portals do not expose the table API to the current user.
              }
            }
            try {
              await appendRecords(
                new URLSearchParams({
                  sysparm_query: "workflow_state=published^ORDERBYDESCsys_updated_on",
                  sysparm_fields: "sys_id,number,short_description,text",
                  sysparm_limit: "25",
                  sysparm_display_value: "all",
                }),
              );
            } catch {
              try {
                await appendRecords(
                  new URLSearchParams({
                    sysparm_fields: "sys_id,number,short_description,text",
                    sysparm_limit: "25",
                    sysparm_display_value: "all",
                  }),
                );
              } catch {
                // Keep portal results when table scanning is unavailable.
              }
            }
            return records;
          };
          const fetchServicePortalKnowledgeSearchRecords = async () => {
            const records: Array<{
              title: string;
              url: string;
              snippet: string;
              text: string;
            }> = [];
            for (const variant of queryVariants) {
              if (!hasBudget()) break;
              const text = await fetchServicePortalPageText("kb_search", {
                query: variant,
              });
              if (!text) continue;
              const url = new URL(
                `/kb?id=kb_search&query=${encodeURIComponent(variant)}`,
                location.origin,
              ).href;
              records.push({
                title: `Service Portal knowledge search: ${variant}`,
                url,
                snippet: text.slice(0, 800),
                text,
              });
            }
            return records;
          };
          const splitSentences = (text: string) =>
            normalize(text)
              .split(/(?<=[.!?])\s+|\n+/)
              .map(normalize)
              .filter((sentence) => sentence.length > 20);
          const extractAnswer = (articleText: string) => {
            const sentences = splitSentences(articleText);
            let best: { sentence: string; answer: string; score: number } | null =
              null;
            const chooseNumber = (sentence: string) => {
              const matches = [
                ...sentence.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g),
              ];
              let bestNumber: { value: string; score: number } | null = null;
              for (const match of matches) {
                const value = normalize(match[0]);
                const index = match.index ?? 0;
                const before = sentence.slice(Math.max(0, index - 80), index);
                const after = sentence.slice(index, index + 80);
                const localContext = `${before} ${after}`;
                if (/\b\d{1,3}(?:,\d{3})*\s+results?\s+for\b/i.test(localContext)) {
                  continue;
                }
                if (
                  hasHiringQuestion &&
                  /[$]|\b(?:budget|spending|costs?|expense|expenses|funding|csr|corporate social responsibility)\b/i.test(
                    localContext,
                  )
                ) {
                  continue;
                }
                let score = 0;
                if (
                  /\b(?:is|are|was|were|makes?|made|typically|usually|annual(?:ly)?|yearly|each year|per year|hires?|employees?|headcount|count|total)\b/i.test(
                    before,
                  )
                ) {
                  score += 10;
                }
                if (/\b(?:hires?|employees?|headcount|count|total)\b/i.test(after)) {
                  score += 4;
                }
                if (/\.\d+$/.test(value)) score -= 4;
                if (/\b(?:article|relevancy|rank|views?|rating|updated|authored|kb)\b/i.test(before.slice(-24))) {
                  score -= 12;
                }
                if (!bestNumber || score > bestNumber.score) {
                  bestNumber = { value, score };
                }
              }
              return bestNumber && bestNumber.score > 0 ? bestNumber.value : "";
            };
            for (const sentence of sentences) {
              const numberMatches = [
                ...sentence.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g),
              ];
              if (wantsNumber && numberMatches.length === 0) continue;
              if (wantsNumber && !hasQuestionTopicCue(sentence)) continue;
              let sentenceScore = scoreText(sentence);
              if (/\b(?:typically|usually|annually|each year|per year|new hires?)\b/i.test(sentence)) {
                sentenceScore += 8;
              }
              if (/\b(?:views?|rating|updated|authored|metadata)\b/i.test(sentence)) {
                sentenceScore -= 20;
              }
              const answer = wantsNumber
                ? chooseNumber(sentence)
                : sentence;
              if (!answer) continue;
              if (!best || sentenceScore > best.score) {
                best = { sentence, answer, score: sentenceScore };
              }
            }
            return best;
          };

          const searchResults: Array<{
            title: string;
            url: string;
            snippet: string;
            text?: string;
          }> = [];
          const seenUrls = new Set<string>();
          const currentArticleText = cleanDocument(document);
          const currentUrl = location.href;
          const hasArticleRegion = Boolean(
            collectDeep(
              document,
              "article, [role='article'], .kb-article-content, .kb_view, .kb-article-wrapper",
            ).length,
          );
          if (
            currentArticleText &&
            (isKnowledgeArticleUrl(currentUrl) || hasArticleRegion)
          ) {
            seenUrls.add(currentUrl);
            searchResults.push({
              title: normalize(document.title) || "Current knowledge article",
              url: currentUrl,
              snippet: currentArticleText.slice(0, 800),
              text: currentArticleText,
            });
          }
          const currentResults = resultLinksFromDocument(document);
          for (const entry of currentResults) {
            if (seenUrls.has(entry.url)) continue;
            seenUrls.add(entry.url);
            searchResults.push(entry);
          }
          const queuedSearchUrls = [
            ...scopedKnowledgeSearchUrlsFromDocument(document),
            ...searchUrls(),
          ];
          for (const url of queuedSearchUrls) {
            if (!hasBudget()) break;
            try {
              const doc = await fetchDocument(url);
              for (const entry of resultLinksFromDocument(doc)) {
                if (seenUrls.has(entry.url)) continue;
                seenUrls.add(entry.url);
                searchResults.push(entry);
              }
              for (const scopedUrl of scopedKnowledgeSearchUrlsFromDocument(doc)) {
                if (!hasBudget()) break;
                try {
                  const scopedDoc = await fetchDocument(scopedUrl);
                  for (const entry of resultLinksFromDocument(scopedDoc)) {
                    if (seenUrls.has(entry.url)) continue;
                    seenUrls.add(entry.url);
                    searchResults.push(entry);
                  }
                } catch {
                  // Continue with other scoped knowledge bases.
                }
              }
            } catch {
              // Try the next same-origin portal URL.
            }
          }
          for (const entry of await fetchServicePortalKnowledgeSearchRecords()) {
            if (seenUrls.has(entry.url)) continue;
            seenUrls.add(entry.url);
            searchResults.push(entry);
          }
          for (const entry of await fetchServiceNowKnowledgeRecords()) {
            if (seenUrls.has(entry.url)) continue;
            seenUrls.add(entry.url);
            searchResults.push(entry);
          }

          const rankedResults = searchResults
            .map((entry) => ({
              ...entry,
              score: scoreText(`${entry.title} ${entry.snippet}`),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(input.maxResults, 20));

          const articleCandidates: Array<{
            title: string;
            url: string;
            answer: string;
            sentence: string;
            score: number;
          }> = [];
          for (const result of rankedResults) {
            if (!hasBudget()) break;
            if (result.text) {
              const extracted = extractAnswer(
                `${result.title}. ${result.snippet}. ${result.text}`,
              );
              if (!extracted) continue;
              articleCandidates.push({
                title: result.title,
                url: result.url,
                answer: extracted.answer,
                sentence: extracted.sentence,
                score: result.score + extracted.score,
              });
              continue;
            }
            const sysKbId = sysKbIdFromUrl(result.url);
            const serviceNowRecord = await fetchServiceNowKnowledgeRecordBySysId(
              sysKbId,
            );
            if (serviceNowRecord) {
              const extracted = extractAnswer(
                `${serviceNowRecord.title || result.title}. ${result.snippet}. ${serviceNowRecord.text}`,
              );
              if (extracted) {
                articleCandidates.push({
                  title: serviceNowRecord.title || result.title,
                  url: result.url,
                  answer: extracted.answer,
                  sentence: extracted.sentence,
                  score: result.score + extracted.score + 4,
                });
                continue;
              }
            }
            for (const articleNumber of articleNumbersFromText(
              `${result.title} ${result.snippet}`,
            )) {
              if (!hasBudget()) break;
              const record = await fetchServiceNowKnowledgeRecordByNumber(
                articleNumber,
              );
              if (!record) continue;
              const extracted = extractAnswer(
                `${record.title || result.title}. ${result.snippet}. ${record.text}`,
              );
              if (extracted) {
                articleCandidates.push({
                  title: record.title || result.title,
                  url: result.url,
                  answer: extracted.answer,
                  sentence: extracted.sentence,
                  score: result.score + extracted.score + 4,
                });
                continue;
              }
            }
            let fetched:
              | { text: string; url: string; extracted: ReturnType<typeof extractAnswer> }
              | null = null;
            for (const url of articleFetchUrls(result)) {
              if (!hasBudget()) break;
              try {
                const doc = await fetchDocument(url);
                const text = cleanDocument(doc);
                const extracted = extractAnswer(
                  `${result.title}. ${result.snippet}. ${text}`,
                );
                if (extracted) {
                  fetched = { text, url, extracted };
                  break;
                }
              } catch {
                // Keep trying alternate article URL shapes for the same result.
              }
            }
            const extracted =
              fetched?.extracted ?? extractAnswer(`${result.title}. ${result.snippet}`);
            if (!extracted) continue;
            articleCandidates.push({
              title: result.title,
              url: fetched?.url ?? result.url,
              answer: extracted.answer,
              sentence: extracted.sentence,
              score: result.score + extracted.score,
            });
          }

          articleCandidates.sort((a, b) => b.score - a.score);
          const lines = [
            "Knowledge base search result.",
            `Question: ${input.question}`,
            `Search query: ${queryText}`,
          ];
          const best = articleCandidates[0];
          if (best) {
            lines.push(`Answer candidate: ${best.answer}`);
            lines.push(`Evidence article: ${best.title}`);
            lines.push(`Evidence sentence: ${best.sentence}`);
            lines.push(`Article URL: ${best.url}`);
            lines.push(
              `Completion hint: call done with summary "${best.answer}" if this answers the question.`,
            );
          } else {
            lines.push("No answer candidate found in the ranked knowledge results.");
            try {
              lines.push(
                `Rendered search URL: ${new URL(
                  `/kb?id=kb_search&query=${encodeURIComponent(
                    renderedSearchQueryText,
                  )}`,
                  location.origin,
                ).href}`,
              );
            } catch {
              // Keep ranked-result URLs as the fallback when URL construction fails.
            }
          }
          if (rankedResults.length > 0) {
            const rankedResultSnippetChars = 520;
            lines.push("Ranked results:");
            for (const result of rankedResults.slice(0, 5)) {
              lines.push(
                `- ${result.title}: ${normalize(result.snippet).slice(0, rankedResultSnippetChars)} (${result.url})`,
              );
            }
          }
          return lines.join("\n");
        },
        [{ question, query, answerType, maxResults }],
        "No readable knowledge base content found.",
      );
    },
  );

  toolRegistry.register(ToolName.CREATE_TAB, CREATE_TAB_DEF, async (args) => {
    const allowedOrigins = await getAllowedNavigationOrigins();
    if (allowedOrigins.length > 0) {
      const targetOrigin = normalizeOrigin(args.url as string);
      const normalizedAllowed = allowedOrigins
        .map(normalizeOrigin)
        .filter((origin): origin is string => Boolean(origin));
      if (!targetOrigin || !normalizedAllowed.includes(targetOrigin)) {
        return navigationBoundaryError(
          args.url as string,
          normalizedAllowed.length > 0 ? normalizedAllowed : allowedOrigins,
        );
      }
    }
    const urlResult = sanitizeUrl(args.url as string);
    if (!urlResult.ok) return `Error: ${urlResult.error}`;
    logger.info("tools", "create_tab", { url: urlResult.value });
    const tab = await chrome.tabs.create({ url: urlResult.value });
    logger.info("tools", "create_tab created", {
      tabId: tab.id,
      url: urlResult.value,
    });

    // Auto-add to active workspace if exists
    const activeWorkspace = await workspaceManager.getActiveWorkspace();
    if (activeWorkspace && tab.id) {
      try {
        await workspaceManager.addTabToWorkspace(tab.id, activeWorkspace.id);
        logger.info("tools", "create_tab grouped", {
          tabId: tab.id,
          workspace: activeWorkspace.name,
        });
        return `Created new tab (ID: ${tab.id}) with URL: ${urlResult.value} (added to ${activeWorkspace.name})`;
      } catch (e) {
        logger.warn("tools", "Failed to auto-group tab to workspace", {
          tabId: tab.id,
          error: e,
        });
      }
    }

    return `Created new tab (ID: ${tab.id}) with URL: ${urlResult.value}`;
  });

  toolRegistry.register(
    ToolName.CLOSE_TAB,
    CLOSE_TAB_DEF,
    async (args, tabId) => {
      const targetTabId = (args.tabId as number) || tabId;
      logger.info("tools", "close_tab", {
        targetTabId,
        requestedTabId: args.tabId,
        currentTabId: tabId,
      });
      try {
        await chrome.tabs.remove(targetTabId);
        return `Closed tab ${targetTabId}`;
      } catch (e: any) {
        return `Error closing tab ${targetTabId}: ${e.message}`;
      }
    },
  );

  toolRegistry.register(ToolName.SWITCH_TAB, SWITCH_TAB_DEF, async (args) => {
    const targetTabId = args.tabId as number;
    logger.info("tools", "switch_tab", { targetTabId });
    try {
      const targetTab = await chrome.tabs.get(targetTabId);
      const targetUrl = getTabUrl(targetTab);
      if (!isUsableTabUrl(targetUrl)) {
        return (
          `Error: Cannot switch to tab ${targetTabId} (${targetUrl || "about:blank"}) for this web task. ` +
          "Browser, extension, blank, and internal pages cannot run page tools. Use a controllable web tab from list_tabs or navigate the current page instead."
        );
      }
      await chrome.tabs.update(targetTabId, { active: true });
      return `Switched to tab ${targetTabId}. Fresh page snapshot is available.`;
    } catch (e: any) {
      return `Error switching to tab ${targetTabId}: ${e.message}`;
    }
  });

  toolRegistry.register(ToolName.WAIT, WAIT_DEF, async (args) => {
    // Fallback — normally intercepted in loop.ts for re-orientation
    const seconds = Math.min(Math.max((args.seconds as number) || 2, 1), 10);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return `Waited ${seconds}s`;
  });

  // Control Flow Tool
  toolRegistry.register(ToolName.DONE, DONE_DEF, async (args) => {
    return (args.summary as string) || "Task completed.";
  });

  // --- New Tools ---

  toolRegistry.register(
    ToolName.READ_ELEMENT,
    READ_ELEMENT_DEF,
    (args, tabId) => executeContentTool(ToolName.READ_ELEMENT, args, tabId),
  );

  toolRegistry.register(ToolName.RIGHT_CLICK, RIGHT_CLICK_DEF, (args, tabId) =>
    executeContentTool(ToolName.RIGHT_CLICK, args, tabId),
  );

  toolRegistry.register(
    ToolName.SET_CHECKBOX,
    SET_CHECKBOX_DEF,
    (args, tabId) => executeContentTool(ToolName.SET_CHECKBOX, args, tabId),
  );

  toolRegistry.register(
    ToolName.CLICK_COORDINATES,
    CLICK_COORDINATES_DEF,
    (args, tabId) =>
      executeContentTool(ToolName.CLICK_COORDINATES, args, tabId),
  );

  toolRegistry.register(
    ToolName.UPLOAD_FILE,
    UPLOAD_FILE_DEF,
    async (args, tabId) => {
      const profileFile =
        typeof args.profileFile === "string" ? args.profileFile.trim() : "";
      if (profileFile) {
        const result = await resolveProfileFile(profileFile);
        if (!result) {
          return `Error: Could not read profile file "${profileFile}". Ensure the backend is running and the file is configured in the local profile.`;
        }

        return executeContentTool(
          ToolName.UPLOAD_FILE,
          {
            id: args.id,
            data: result.data,
            filename: result.filename,
            mimeType: result.mimeType,
          },
          tabId,
        );
      }

      const url = typeof args.url === "string" ? args.url : "";
      if (!url) return "Error: provide either url or profileFile.";
      const urlResult = sanitizeUrl(url);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;

      try {
        const response = await fetch(urlResult.value);
        if (!response.ok)
          return `Error: fetch failed with status ${response.status}`;

        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
          return "Error: file exceeds 10MB limit.";
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 10 * 1024 * 1024) {
          return "Error: file exceeds 10MB limit.";
        }

        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        const contentType =
          response.headers.get("content-type") || "application/octet-stream";
        const urlPath = new URL(urlResult.value).pathname;
        const filename = urlPath.split("/").pop() || "file";

        return executeContentTool(
          ToolName.UPLOAD_FILE,
          {
            id: args.id,
            data: base64,
            filename,
            mimeType: contentType,
          },
          tabId,
        );
      } catch (e: any) {
        return `Error fetching file: ${e.message}`;
      }
    },
  );

  toolRegistry.register(ToolName.GO_BACK, GO_BACK_DEF, async (_args, tabId) => {
    logger.info("tools", "go_back", { tabId });
    try {
      const before = await chrome.tabs.get(tabId);
      const previousUrl = before.url || "";

      // Attempt 1: chrome.tabs.goBack (browser-level history)
      let currentUrl: string | null = null;
      try {
        clearTabReady(tabId);
        await chrome.tabs.goBack(tabId);
        await waitForNavigation(tabId);
        currentUrl = await waitForTabUrlChange(tabId, previousUrl);
      } catch {
        // chrome.tabs.goBack throws when there's no browser history entry
        // (e.g. SPA navigations via window.location.href within a single tab).
        // Fall through to the in-page fallback.
        currentUrl = null;
      }

      // Attempt 2: window.history.back() via scripting (in-page history)
      if (!currentUrl || currentUrl === "about:blank") {
        logger.warn(
          "tools",
          "tabs.goBack did not change URL, trying in-page history.back()",
          {
            tabId,
            previousUrl,
          },
        );
        try {
          clearTabReady(tabId);
          await tryInPageHistoryBack(tabId);
          await waitForNavigation(tabId);
          currentUrl = await waitForTabUrlChange(tabId, previousUrl);
        } catch {
          currentUrl = null;
        }
      }

      if (!currentUrl || currentUrl === "about:blank") {
        return previousUrl
          ? `Error going back: browser remained on ${previousUrl}. History navigation did not reach a previous page.`
          : "Error going back: browser history did not advance to a previous page.";
      }
      const ready = await ensureContentScript(tabId, 3000);
      if (ready) {
        await waitForDomReady(tabId, { timeoutMs: 300, waitForElements: true });
      } else {
        logger.warn(
          "tools",
          "go_back completed before content script recovered",
          {
            tabId,
            currentUrl,
          },
        );
      }
      return `Navigated back to ${currentUrl}. Fresh page snapshot is available.`;
    } catch (e: any) {
      return `Error going back: ${e.message}`;
    }
  });

  toolRegistry.register(ToolName.LIST_TABS, LIST_TABS_DEF, async () => {
    const tabs = await chrome.tabs.query({});
    logger.info("tools", "list_tabs", { count: tabs.length });
    return formatControllableTabLines(tabs).join("\n");
  });

  toolRegistry.register(
    ToolName.EXECUTE_JS,
    EXECUTE_JS_DEF,
    async (args, tabId) => {
      const code = args.code as string;
      logger.info("tools", "execute_js", {
        tabId,
        codeLen: code.length,
        codeSnippet: code.slice(0, 120),
      });
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: (c: string) => {
            const serialize = (value: unknown): string => {
              if (value === null || value === undefined) return String(value);
              if (typeof value === "object") {
                try {
                  return JSON.stringify(value, null, 2);
                } catch {
                  return String(value);
                }
              }
              return String(value);
            };

            const formatError = (error: unknown): string => {
              if (error instanceof Error) return error.message;
              return String(error);
            };

            try {
              // Prefer expression mode, then fall back to statement mode.
              try {
                const expressionRunner = new Function(
                  `"use strict"; return (${c});`,
                );
                return serialize(expressionRunner());
              } catch {
                const statementRunner = new Function(`"use strict"; ${c}`);
                return serialize(statementRunner());
              }
            } catch (error: unknown) {
              return `Error: ${formatError(error)}`;
            }
          },
          args: [code],
        });
        const value = results?.[0]?.result;
        if (value === undefined || value === "undefined") {
          return (
            "undefined\n\n⚠ Script returned undefined — the return value was lost. " +
            "Use a simpler expression (e.g. document.querySelector(...).textContent) " +
            "or try read_element / inspect_hidden instead. Do NOT retry the same script."
          );
        }
        return value;
      } catch (error: unknown) {
        return `Error executing JS: ${formatUnknownError(error)}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.DOWNLOAD_FILE,
    DOWNLOAD_FILE_DEF,
    async (args) => {
      const url = args.url as string;
      const filename = args.filename as string | undefined;
      const urlResult = sanitizeUrl(url);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;
      logger.info("tools", "download_file", { url: urlResult.value, filename });

      try {
        const opts: any = { url: urlResult.value };
        if (filename) {
          // Strip path traversal and absolute path components
          opts.filename = filename
            .replace(/\.\.[/\\]/g, "")
            .replace(/^[/\\]+/, "")
            .replace(/\0/g, "");
        }
        const downloadId = await chrome.downloads.download(opts);
        return `Download started (ID: ${downloadId})`;
      } catch (e: any) {
        return `Error starting download: ${e.message}`;
      }
    },
  );

  // --- Chrome API Tools ---

  toolRegistry.register(
    ToolName.GET_COOKIES,
    GET_COOKIES_DEF,
    async (args, tabId) => {
      let url = args.url as string | undefined;
      if (!url) {
        try {
          const tab = await chrome.tabs.get(tabId);
          url = tab.url;
        } catch {
          return "Error: Could not determine current tab URL.";
        }
      }
      if (!url) return "Error: No URL available.";
      logger.info("tools", "get_cookies", { url });
      try {
        const cookies = await chrome.cookies.getAll({ url });
        if (cookies.length === 0) return "No cookies found for this URL.";
        return cookies.map((c: any) => `${c.name}=${c.value}`).join("\n");
      } catch (e: any) {
        return `Error getting cookies: ${e.message}`;
      }
    },
  );

  toolRegistry.register(ToolName.SET_COOKIE, SET_COOKIE_DEF, async (args) => {
    const rawUrl = args.url as string;
    const urlResult = sanitizeUrl(rawUrl);
    if (!urlResult.ok) return `Error: ${urlResult.error}`;
    const url = urlResult.value;
    const name = args.name as string;
    const value = args.value as string;
    const domain = args.domain as string | undefined;
    const path = args.path as string | undefined;
    logger.info("tools", "set_cookie", { url, name, domain, path });
    try {
      const opts: any = { url, name, value };
      if (domain) opts.domain = domain;
      if (path) opts.path = path;
      await chrome.cookies.set(opts);
      return `Cookie "${name}" set on ${url}`;
    } catch (e: any) {
      return `Error setting cookie: ${e.message}`;
    }
  });

  toolRegistry.register(
    ToolName.DELETE_COOKIE,
    DELETE_COOKIE_DEF,
    async (args) => {
      const rawUrl = args.url as string;
      const urlResult = sanitizeUrl(rawUrl);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;
      const url = urlResult.value;
      const name = args.name as string;
      logger.info("tools", "delete_cookie", { url, name });
      try {
        await chrome.cookies.remove({ url, name });
        return `Cookie "${name}" deleted from ${url}`;
      } catch (e: any) {
        return `Error deleting cookie: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.SEARCH_HISTORY,
    SEARCH_HISTORY_DEF,
    async (args) => {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) || 20;
      logger.info("tools", "search_history", { query, maxResults });
      try {
        const items = await chrome.history.search({
          text: query,
          maxResults,
        });
        if (items.length === 0) return "No history entries found.";
        return items
          .map((item: any) => {
            const lastVisit = item.lastVisitTime
              ? new Date(item.lastVisitTime).toISOString().slice(0, 16)
              : "unknown";
            return `${item.title || "(untitled)"} — ${item.url} (visited ${item.visitCount || 1} time(s), last: ${lastVisit})`;
          })
          .join("\n");
      } catch (e: any) {
        return `Error searching history: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.INSPECT_HIDDEN,
    INSPECT_HIDDEN_DEF,
    async (args, tabId) => {
      const pattern = (args.pattern as string) || "";
      const maxResults = Math.min(
        Math.max((args.maxResults as number) || 25, 1),
        50,
      );

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN" as any,
          func: (pat: string, max: number) => {
            const SKIP_TAGS = new Set([
              "SCRIPT",
              "STYLE",
              "NOSCRIPT",
              "META",
              "LINK",
              "HEAD",
              "BR",
              "HR",
              "WBR",
              "TEMPLATE",
            ]);
            const startTime = performance.now();
            const TIME_BUDGET = 50; // ms
            const TEXT_MAX = 200;

            interface HiddenEntry {
              method: string;
              selector: string;
              text: string;
            }
            const found: HiddenEntry[] = [];
            const seenTexts = new Set<string>();

            function getDirectText(el: Element): string {
              let text = "";
              for (const node of el.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                  text += (node as Text).textContent || "";
                }
              }
              return text.trim();
            }

            function describeElement(el: Element): string {
              const tag = el.tagName.toLowerCase();
              const id = el.id ? `#${el.id}` : "";
              const cls =
                el.className && typeof el.className === "string"
                  ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}`
                  : "";
              return `${tag}${id}${cls}`.slice(0, 60);
            }

            function isAncestorHidden(el: Element): string | null {
              let current = el.parentElement;
              let depth = 0;
              while (current && depth < 10) {
                if (current.tagName === "BODY" || current.tagName === "HTML")
                  break;
                const style = getComputedStyle(current);
                if (style.display === "none") return `parent(display:none)`;
                if (style.visibility === "hidden")
                  return `parent(visibility:hidden)`;
                if (parseFloat(style.opacity) === 0) return `parent(opacity:0)`;
                if (current.getAttribute("aria-hidden") === "true")
                  return `parent(aria-hidden)`;
                current = current.parentElement;
                depth++;
              }
              return null;
            }

            function detectHiding(el: Element): string | null {
              // aria-hidden on the element itself
              if (el.getAttribute("aria-hidden") === "true")
                return "aria-hidden";

              const style = getComputedStyle(el);

              if (style.display === "none") return "display:none";
              if (style.visibility === "hidden") return "visibility:hidden";
              if (parseFloat(style.opacity) === 0) return "opacity:0";

              // clip / clip-path
              if (
                style.clip === "rect(0px, 0px, 0px, 0px)" ||
                style.clipPath === "inset(100%)" ||
                style.clipPath === "polygon(0px 0px, 0px 0px, 0px 0px)"
              ) {
                return "clip";
              }

              // Zero-size with overflow hidden
              const rect = el.getBoundingClientRect();
              if (
                rect.width === 0 &&
                rect.height === 0 &&
                (style.overflow === "hidden" || style.overflow === "clip")
              ) {
                return "zero-size+overflow:hidden";
              }

              // Off-screen positioning
              if (
                rect.right < -500 ||
                rect.bottom < -500 ||
                rect.left > window.innerWidth + 500 ||
                rect.top > window.innerHeight + 500
              ) {
                return "off-screen";
              }

              // Negative text-indent
              const textIndent = parseFloat(style.textIndent);
              if (textIndent < -500) return "text-indent";

              // Color camouflage: text color matches background
              if (
                style.color &&
                style.backgroundColor &&
                style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                style.backgroundColor !== "transparent" &&
                style.color === style.backgroundColor
              ) {
                return "color-camouflage";
              }

              // Font-size: 0
              if (parseFloat(style.fontSize) === 0) return "font-size:0";

              // Check parent hiding
              return isAncestorHidden(el);
            }

            const allElements = document.querySelectorAll("*");
            for (let i = 0; i < allElements.length; i++) {
              if (performance.now() - startTime > TIME_BUDGET) break;
              if (found.length >= max) break;

              const el = allElements[i];
              if (SKIP_TAGS.has(el.tagName)) continue;
              // Skip SVG internals
              if (el.closest("svg") && el.tagName !== "SVG") continue;

              const method = detectHiding(el);
              if (!method) continue;

              // Prefer direct text to avoid duplicates from parent containers
              let text = getDirectText(el);
              if (!text) text = (el.textContent || "").trim();
              if (!text) continue;

              // Truncate
              if (text.length > TEXT_MAX)
                text = text.slice(0, TEXT_MAX) + "...";

              // Pattern filter
              if (pat && !text.toLowerCase().includes(pat.toLowerCase()))
                continue;

              // Dedup by text
              if (seenTexts.has(text)) continue;
              seenTexts.add(text);

              found.push({
                method,
                selector: describeElement(el),
                text,
              });
            }

            // Sort by text length descending (longer = more meaningful)
            found.sort((a, b) => b.text.length - a.text.length);

            const elapsed = Math.round(performance.now() - startTime);
            if (found.length === 0) {
              return `No hidden elements found${pat ? ` matching "${pat}"` : ""} (scanned in ${elapsed}ms).`;
            }

            const lines = found.map(
              (entry, idx) =>
                `${idx + 1}. [${entry.method}] ${entry.selector}\n   Text: "${entry.text}"`,
            );
            return `Found ${found.length} hidden element(s)${pat ? ` matching "${pat}"` : ""} (scanned in ${elapsed}ms):\n\n${lines.join("\n\n")}`;
          },
          args: [pattern, maxResults],
        });
        const value = results?.[0]?.result;
        return value !== undefined ? value : "No hidden elements found.";
      } catch (e: any) {
        return `Error scanning hidden elements: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.INSPECT_CHART,
    INSPECT_CHART_DEF,
    async (args, tabId) => {
      const pattern = (args.pattern as string) || "";
      const maxResults = Math.min(
        Math.max((args.maxResults as number) || 30, 1),
        100,
      );
      return runReadOnlyPageInspector(
        tabId,
        (pat: string, max: number) => {
          const norm = (value: unknown) =>
            String(value ?? "")
              .replace(/\s+/g, " ")
              .trim();
          const include = (value: string) =>
            !pat || value.toLowerCase().includes(pat.toLowerCase());
          const lines: string[] = [
            `URL: ${location.href}`,
            `Title: ${document.title}`,
          ];
          const sections: string[] = [];
          const seen = new Set<string>();
          const push = (label: string, value: unknown, force = false) => {
            const text = norm(value);
            if (
              !text ||
              (!force && !include(text)) ||
              seen.has(`${label}:${text}`)
            )
              return;
            seen.add(`${label}:${text}`);
            sections.push(`- ${label}: ${text.slice(0, 240)}`);
          };
          const formatNumber = (value: unknown) => {
            if (typeof value === "number" && Number.isFinite(value)) {
              return String(value);
            }
            return norm(value);
          };
          const toNumber = (value: unknown): number | null => {
            if (typeof value === "number" && Number.isFinite(value)) {
              return value;
            }
            const text = norm(value).replace(/,/g, "");
            if (!text) return null;
            const parsed = Number(text);
            return Number.isFinite(parsed) ? parsed : null;
          };
          const firstText = (values: unknown[]) => {
            for (const value of values) {
              const text = norm(value);
              if (text) return text;
            }
            return "";
          };

          const highcharts = (window as any).Highcharts;
          if (highcharts?.charts) {
            highcharts.charts
              .filter(Boolean)
              .slice(0, 8)
              .forEach((chart: any, chartIndex: number) => {
                const chartTitle =
                  chart.title?.textStr || chart.options?.title?.text;
                const chartType = chart.options?.chart?.type || chart.type;
                const chartMatches =
                  !pat ||
                  include(chartTitle || "") ||
                  include(chart.options?.subtitle?.text || "") ||
                  include(chart.renderTo?.textContent || "");
                push(
                  `Highcharts ${chartIndex + 1} title`,
                  chartTitle,
                  chartMatches,
                );
                push(
                  `Highcharts ${chartIndex + 1} type`,
                  chartType,
                  chartMatches,
                );
                const categories = chart.xAxis?.[0]?.categories;
                const dataRows =
                  typeof chart.getDataRows === "function"
                    ? chart.getDataRows()
                    : null;
                if (Array.isArray(dataRows)) {
                  dataRows
                    .slice(0, max + 1)
                    .forEach((row: unknown, rowIndex: number) => {
                      const text = Array.isArray(row)
                        ? row.map(formatNumber).join(" | ")
                        : norm(row);
                      push(
                        rowIndex === 0 ? "Data row header" : "Data row",
                        text,
                        chartMatches,
                      );
                    });
                }
                const points: string[] = [];
                for (const series of chart.series || []) {
                  const seriesName = norm(series?.name) || "series";
                  const seriesMatches = chartMatches || include(seriesName);
                  if (series?.name) push(`Series`, series.name, chartMatches);
                  const seriesPoints =
                    Array.isArray(series?.points) && series.points.length > 0
                      ? series.points
                      : Array.isArray(series?.data)
                        ? series.data
                        : [];
                  const total =
                    toNumber(series?.total) ??
                    seriesPoints.reduce((sum: number, point: any) => {
                      return sum + (toNumber(point?.y ?? point?.value) ?? 0);
                    }, 0);
                  for (const point of seriesPoints.slice(0, max)) {
                    const label = firstText([
                      point?.origXValue,
                      point?.category,
                      point?.name,
                      Array.isArray(categories)
                        ? categories[point?.x]
                        : undefined,
                      point?.x,
                    ]);
                    const rawValue = point?.y ?? point?.value;
                    const count = toNumber(rawValue);
                    const percent =
                      toNumber(point?.percent ?? point?.percentage) ??
                      (count !== null && total > 0
                        ? Math.round((count / total) * 100000000) / 1000000
                        : null);
                    const fields = [
                      `count=${formatNumber(rawValue)}`,
                      percent !== null
                        ? `percent=${formatNumber(percent)}`
                        : "",
                      total > 0 ? `series_total=${formatNumber(total)}` : "",
                    ].filter(Boolean);
                    const pointText = `${seriesName} ${label || points.length + 1}: ${fields.join("; ")}`;
                    if (seriesMatches || include(pointText)) {
                      points.push(pointText);
                    }
                    if (points.length >= max) break;
                  }
                  if (points.length >= max) break;
                }
                if (points.length > 0) {
                  push(`Highcharts ${chartIndex + 1} title`, chartTitle, true);
                }
                for (const point of points) push("Point", point, true);
              });
          }

          const chartLike = [
            ...document.querySelectorAll(
              "svg, canvas, [role='img'], [aria-label*='chart' i], [class*='chart' i], [class*='highcharts' i]",
            ),
          ].slice(0, 12);
          chartLike.forEach((el, index) => {
            const label = norm(
              [
                el.getAttribute("aria-label"),
                el.getAttribute("title"),
                el.getAttribute("data-highcharts-chart"),
              ]
                .filter(Boolean)
                .join(" "),
            );
            push(`Chart element ${index + 1}`, label);
            const svgText = [...el.querySelectorAll("title, text, tspan")]
              .map((node) => norm(node.textContent))
              .filter(Boolean)
              .slice(0, max)
              .join(" | ");
            push(`Chart text ${index + 1}`, svgText);
          });

          if (pat) {
            const scripts = [
              ...document.querySelectorAll<HTMLScriptElement>(
                "script[type='application/json'], script:not([src])",
              ),
            ].slice(0, 20);
            for (const script of scripts) {
              const text = norm(script.textContent);
              if (!text || !include(text)) continue;
              const lower = text.toLowerCase();
              const index = lower.indexOf(pat.toLowerCase());
              const start = Math.max(0, index - 160);
              const end = Math.min(text.length, index + pat.length + 240);
              push("Chart metadata snippet", text.slice(start, end), true);
            }
          }

          if (sections.length === 0) {
            lines.push(
              `No chart data found${pat ? ` matching "${pat}"` : ""}.`,
            );
          } else {
            lines.push(`Chart evidence${pat ? ` matching "${pat}"` : ""}:`);
            lines.push(...sections.slice(0, max + 20));
          }
          return lines.join("\n");
        },
        [pattern, maxResults],
        "No chart data found.",
      );
    },
  );

  toolRegistry.register(
    ToolName.INSPECT_TABLE,
    INSPECT_TABLE_DEF,
    async (args, tabId) => {
      const maxRows = Math.min(Math.max((args.maxRows as number) || 10, 1), 50);
      return runReadOnlyPageInspector(
        tabId,
        (max: number) => {
          const norm = (value: unknown) =>
            String(value ?? "")
              .replace(/\s+/g, " ")
              .trim();
          const lines: string[] = [
            `URL: ${location.href}`,
            `Title: ${document.title}`,
          ];
          const params = new URLSearchParams(location.search);
          const interestingParams = [
            "sysparm_query",
            "sysparm_fixed_query",
            "sysparm_first_row",
            "sysparm_order",
            "sysparm_orderby",
            "sysparm_sort",
            "sysparm_view",
          ]
            .map((key) => [key, params.get(key)] as const)
            .filter(([, value]) => value);
          if (interestingParams.length > 0) {
            lines.push(
              `URL state: ${interestingParams.map(([k, v]) => `${k}=${v}`).join("; ")}`,
            );
          }

          const tables = [
            ...document.querySelectorAll(
              "table, [role='grid'], [role='table']",
            ),
          ].slice(0, 8);
          if (tables.length === 0) {
            const rows = [
              ...document.querySelectorAll(
                "[role='row'], tr, li, [class*='row' i]",
              ),
            ].slice(0, max);
            if (rows.length === 0)
              return `${lines.join("\n")}\nNo table or row-like data surface found.`;
            lines.push(`Row-like surface (${rows.length} sampled rows):`);
            rows.forEach((row, index) =>
              lines.push(
                `${index + 1}. ${norm(row.textContent).slice(0, 240)}`,
              ),
            );
            return lines.join("\n");
          }

          tables.forEach((table, tableIndex) => {
            const headers = [
              ...table.querySelectorAll("th, [role='columnheader']"),
            ]
              .map((header) => {
                const text = norm(header.textContent);
                const sort =
                  header.getAttribute("aria-sort") ||
                  header.getAttribute("data-sort") ||
                  header.getAttribute("sort");
                return sort ? `${text} (${sort})` : text;
              })
              .filter(Boolean);
            lines.push(`Table ${tableIndex + 1}:`);
            if (headers.length > 0)
              lines.push(`Columns: ${headers.join(" | ")}`);
            const rows = [...table.querySelectorAll("tbody tr, [role='row']")]
              .filter((row) => norm(row.textContent))
              .slice(0, max);
            rows.forEach((row, rowIndex) => {
              const cells = [
                ...row.querySelectorAll(
                  "td, th, [role='cell'], [role='gridcell']",
                ),
              ]
                .map((cell) => norm(cell.textContent))
                .filter(Boolean);
              lines.push(
                `${rowIndex + 1}. ${(cells.length > 0 ? cells.join(" | ") : norm(row.textContent)).slice(0, 320)}`,
              );
            });
          });
          return lines.join("\n");
        },
        [maxRows],
        "No table data found.",
      );
    },
  );

  toolRegistry.register(
    ToolName.INSPECT_FILTER_STATE,
    INSPECT_FILTER_STATE_DEF,
    async (args, tabId) => {
      const pattern = (args.pattern as string) || "";
      const maxResults = Math.min(
        Math.max((args.maxResults as number) || 30, 1),
        80,
      );
      return runReadOnlyPageInspector(
        tabId,
        (pat: string, max: number) => {
          const norm = (value: unknown) =>
            String(value ?? "")
              .replace(/\s+/g, " ")
              .trim();
          const include = (text: string) =>
            !pat || text.toLowerCase().includes(pat.toLowerCase());
          const lines: string[] = [
            `URL: ${location.href}`,
            `Title: ${document.title}`,
          ];
          const params = new URLSearchParams(location.search);
          const queryParams = [
            "sysparm_query",
            "sysparm_fixed_query",
            "sysparm_filter",
            "filter",
            "q",
          ]
            .map((key) => [key, params.get(key)] as const)
            .filter(([, value]) => value);
          if (queryParams.length > 0) {
            lines.push(
              `Query state: ${queryParams.map(([k, v]) => `${k}=${v}`).join("; ")}`,
            );
          }

          const candidates = [
            ...document.querySelectorAll(
              "button, input, select, textarea, [role='button'], [role='combobox'], [class*='filter' i], [id*='filter' i], [aria-label*='filter' i], [title*='filter' i]",
            ),
          ];
          const seen = new Set<string>();
          const items: string[] = [];
          for (const el of candidates) {
            const control = el as
              | HTMLInputElement
              | HTMLSelectElement
              | HTMLTextAreaElement;
            const text = norm(
              [
                el.getAttribute("aria-label"),
                el.getAttribute("title"),
                el.getAttribute("name"),
                el.getAttribute("id"),
                control.value,
                el.textContent,
              ]
                .filter(Boolean)
                .join(" "),
            );
            if (!text || !include(text)) continue;
            const key = `${el.tagName}:${text}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push(`- <${el.tagName.toLowerCase()}> ${text.slice(0, 220)}`);
            if (items.length >= max) break;
          }
          if (items.length === 0) {
            lines.push(
              `No filter controls or state found${pat ? ` matching "${pat}"` : ""}.`,
            );
          } else {
            lines.push(
              `Filter controls/state${pat ? ` matching "${pat}"` : ""}:`,
            );
            lines.push(...items);
          }
          return lines.join("\n");
        },
        [pattern, maxResults],
        "No filter state found.",
      );
    },
  );

  toolRegistry.register(
    ToolName.APPLY_LIST_FILTER,
    APPLY_LIST_FILTER_DEF,
    async (args, tabId) => {
      const rawConditions = Array.isArray(args.conditions)
        ? args.conditions
        : [];
      const conditions = rawConditions
        .map((condition) => {
          const obj =
            condition && typeof condition === "object"
              ? (condition as Record<string, unknown>)
              : {};
          const field = typeof obj.field === "string" ? obj.field.trim() : "";
          const operator =
            typeof obj.operator === "string" ? obj.operator.trim() : "is";
          const value =
            typeof obj.value === "string"
              ? obj.value
              : obj.value == null
                ? ""
                : String(obj.value);
          return field ? { field, operator, value } : null;
        })
        .filter(
          (
            condition,
          ): condition is { field: string; operator: string; value: string } =>
            Boolean(condition),
        );

      if (conditions.length === 0) {
        return "Error: apply_list_filter requires at least one condition with a field.";
      }

      const join =
        typeof args.join === "string" && args.join.toUpperCase() === "AND"
          ? "AND"
          : "OR";
      const table = typeof args.table === "string" ? args.table.trim() : "";
      const shouldRun = args.run !== false;

      try {
        let currentTabUrl = "";
        try {
          currentTabUrl = (await chrome.tabs.get(tabId)).url || "";
        } catch {
          currentTabUrl = "";
        }
        const currentHost = (() => {
          try {
            return new URL(currentTabUrl).hostname.toLowerCase();
          } catch {
            return "";
          }
        })();
        const inferredTable = inferServiceNowListTableFromUrl(currentTabUrl);
        const effectiveTable = table || inferredTable;
        const referenceValueOverrides: Array<{
          index: number;
          field: string;
          referenceTable: string;
          displayValue: string;
          sysId: string;
        }> = [];
        if (
          currentHost.endsWith(".service-now.com") ||
          currentHost === "service-now.com"
        ) {
          for (let index = 0; index < conditions.length; index += 1) {
            const condition = conditions[index];
            const displayValue = condition.value.trim();
            const operator = condition.operator.trim().toLowerCase();
            if (!displayValue || operator.includes("empty")) continue;
            const referenceTable =
              commonServiceNowReferenceTableForField(condition.field) ||
              commonServiceNowReferenceTableForField(
                normalizeServiceNowReferenceKey(condition.field),
              );
            if (!referenceTable) continue;
            const resolved = await resolveServiceNowReferenceFromBackground(
              tabId,
              referenceTable,
              displayValue,
            );
            if (resolved.ok) {
              referenceValueOverrides.push({
                index,
                field: condition.field,
                referenceTable,
                displayValue,
                sysId: resolved.sysId,
              });
            }
          }
        }

        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "MAIN" as any,
            func: async (payload: {
              conditions: { field: string; operator: string; value: string }[];
              join: "AND" | "OR";
              table: string;
              referenceValueOverrides: {
                index: number;
                field: string;
                referenceTable: string;
                displayValue: string;
                sysId: string;
              }[];
            }) => {
              type FieldMeta = {
                name: string;
                label: string;
                type: string;
                reference: string;
              };
              type AppliedCondition = {
                field: string;
                label: string;
                operator: string;
                displayValue: string;
                encodedValue: string;
                predicate: string;
                type: string;
              };

              const normalize = (value: unknown): string =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
              const keyFor = (value: unknown): string =>
                normalize(value).replace(/[^a-z0-9]+/g, "");
              const unwrap = (value: unknown): string => {
                if (typeof value === "string") return value;
                if (value && typeof value === "object") {
                  const obj = value as Record<string, unknown>;
                  if (typeof obj.value === "string") return obj.value;
                  if (typeof obj.display_value === "string") {
                    return obj.display_value;
                  }
                }
                return "";
              };
              const displayOf = (value: unknown): string => {
                if (typeof value === "string") return value;
                if (value && typeof value === "object") {
                  const obj = value as Record<string, unknown>;
                  if (typeof obj.display_value === "string") {
                    return obj.display_value;
                  }
                  if (typeof obj.value === "string") return obj.value;
                }
                return "";
              };
              const cleanQueryValue = (value: string): string =>
                value.replace(/\^/g, "").trim();
              const serviceNowListMatch = /\/([^/?#]+)_list\.do\b/i.exec(
                location.pathname,
              );
              const listApi = (() => {
                const win = window as any;
                const glide = win.GlideList2;
                if (!glide || typeof glide.get !== "function") return null;
                const candidates = [
                  ...(document.querySelectorAll("[data-list_id]") as any),
                ]
                  .map((element: Element) =>
                    element.getAttribute("data-list_id"),
                  )
                  .filter(Boolean);
                for (const id of candidates) {
                  try {
                    const list = glide.get(id);
                    if (list) return list;
                  } catch {
                    // Try the next list candidate.
                  }
                }
                try {
                  if (win.g_list) return win.g_list;
                } catch {
                  return null;
                }
                return null;
              })();

              const tableFromList =
                listApi && typeof listApi.getTableName === "function"
                  ? String(listApi.getTableName() || "")
                  : "";
              const tableFromUrl = serviceNowListMatch?.[1] || "";
              const tableName = tableFromList || tableFromUrl;
              if (!tableName || !serviceNowListMatch) {
                return {
                  ok: false,
                  reason: "not_servicenow_list_frame",
                  url: location.href,
                  title: document.title,
                };
              }
              if (payload.table) {
                const requested = keyFor(payload.table);
                const title = keyFor(document.title);
                if (
                  requested &&
                  requested !== keyFor(tableName) &&
                  !title.includes(requested)
                ) {
                  return {
                    ok: false,
                    reason: "table_mismatch",
                    table: tableName,
                    url: location.href,
                    title: document.title,
                  };
                }
              }

              const fetchJson = async (
                path: string,
                params: Record<string, string>,
              ): Promise<Record<string, unknown>[]> => {
                const search = new URLSearchParams(params);
                const controller = new AbortController();
                const timer = window.setTimeout(() => controller.abort(), 3000);
                try {
                  const headers: Record<string, string> = {
                    Accept: "application/json",
                  };
                  const token = String((window as any).g_ck || "");
                  if (token) headers["X-UserToken"] = token;
                  const response = await fetch(`${path}?${search.toString()}`, {
                    credentials: "same-origin",
                    headers,
                    signal: controller.signal,
                  });
                  if (!response.ok) return [];
                  const payload = await response.json().catch(() => null);
                  return Array.isArray(payload?.result) ? payload.result : [];
                } catch {
                  return [];
                } finally {
                  window.clearTimeout(timer);
                }
              };

              const fields = new Map<string, FieldMeta>();
              const addField = (
                name: string,
                label = name,
                type = "",
                reference = "",
              ) => {
                const fieldName = name.trim();
                if (!fieldName) return;
                const existing = fields.get(fieldName);
                fields.set(fieldName, {
                  name: fieldName,
                  label: label.trim() || existing?.label || fieldName,
                  type: type || existing?.type || "",
                  reference: reference || existing?.reference || "",
                });
              };
              const dictionaryTablesFor = (table: string): string[] => {
                const normalized = table.trim();
                const inherited: Record<string, string[]> = {
                  alm_hardware: [
                    "alm_hardware",
                    "alm_asset",
                    "cmdb_ci",
                    "cmdb",
                  ],
                  alm_asset: ["alm_asset", "cmdb_ci", "cmdb"],
                  change_request: ["change_request", "task"],
                  incident: ["incident", "task"],
                  problem: ["problem", "task"],
                };
                return inherited[normalized] || [normalized];
              };
              const addCommonListFields = (table: string) => {
                if (table === "alm_hardware" || table === "alm_asset") {
                  addField("asset_function", "Asset function", "choice", "");
                  addField(
                    "model_category",
                    "Model category",
                    "reference",
                    "cmdb_model_category",
                  );
                  addField("assigned_to", "Assigned to", "reference", "sys_user");
                  addField("substatus", "Substate", "choice", "");
                  addField("vendor", "Vendor", "reference", "core_company");
                  addField("cost", "Cost", "decimal", "");
                }
                if (table === "sc_cat_item") {
                  addField("type", "Type", "choice", "");
                  addField("category", "Category", "reference", "sc_category");
                  addField("active", "Active", "boolean", "");
                }
                if (
                  table === "change_request" ||
                  table === "incident" ||
                  table === "problem"
                ) {
                  addField("assigned_to", "Assigned to", "reference", "sys_user");
                  addField("short_description", "Short description", "string", "");
                  addField("state", "State", "choice", "");
                }
                if (table === "change_request") {
                  addField("chg_model", "Model", "reference", "chg_model");
                }
                if (table === "incident") {
                  addField("caller_id", "Caller", "reference", "sys_user");
                  addField("category", "Category", "choice", "");
                  addField("priority", "Priority", "choice", "");
                  addField("impact", "Impact", "choice", "");
                  addField("urgency", "Urgency", "choice", "");
                  addField(
                    "assignment_group",
                    "Assignment group",
                    "reference",
                    "sys_user_group",
                  );
                }
              };

              for (const th of [
                ...document.querySelectorAll(
                  `[id^="hdr_"] th[name], table.data_list_table th[name], th[name]`,
                ),
              ]) {
                const name = th.getAttribute("name") || "";
                const label =
                  th.getAttribute("glide_label") ||
                  th.getAttribute("aria-label") ||
                  th.querySelector("a")?.textContent ||
                  th.textContent ||
                  name;
                addField(name, label);
              }

              if (tableName === "incident") {
                addField("caller_id", "Caller", "reference", "sys_user");
                addField("category", "Category", "choice", "");
                addField("priority", "Priority", "choice", "");
                addField("impact", "Impact", "choice", "");
                addField("urgency", "Urgency", "choice", "");
                addField("state", "State", "choice", "");
                addField("assigned_to", "Assigned to", "reference", "sys_user");
                addField(
                  "assignment_group",
                  "Assignment group",
                  "reference",
                  "sys_user_group",
                );
              }

              addCommonListFields(tableName);

              {
                const dictRecords = await fetchJson(
                  "/api/now/table/sys_dictionary",
                  {
                    sysparm_query: `nameIN${dictionaryTablesFor(tableName).join(",")}^internal_type!=collection`,
                    sysparm_fields:
                      "element,column_label,internal_type,reference",
                    sysparm_limit: "1000",
                    sysparm_display_value: "all",
                  },
                );
                for (const record of dictRecords) {
                  const name = unwrap(record.element);
                  addField(
                    name,
                    unwrap(record.column_label) || name,
                    unwrap(record.internal_type),
                    unwrap(record.reference),
                  );
                }
                addCommonListFields(tableName);
              }

              const byKey = new Map<string, FieldMeta>();
              for (const field of fields.values()) {
                byKey.set(keyFor(field.name), field);
                byKey.set(keyFor(field.label), field);
              }

              const resolveField = (
                requestedField: string,
              ): FieldMeta | null => {
                const normalized = keyFor(requestedField);
                const snake = normalize(requestedField).replace(
                  /[^a-z0-9]+/g,
                  "_",
                );
                if (fields.has(snake)) return fields.get(snake) || null;
                if (fields.has(`${snake}_id`))
                  return fields.get(`${snake}_id`) || null;
                const direct = byKey.get(normalized);
                if (direct) return direct;
                for (const field of fields.values()) {
                  if (
                    keyFor(field.label).includes(normalized) ||
                    normalized.includes(keyFor(field.label))
                  ) {
                    return field;
                  }
                }
                return null;
              };

              const resolveValueFromCurrentTable = async (
                field: FieldMeta,
                displayValue: string,
                conditionIndex: number,
              ): Promise<string> => {
                if (!displayValue.trim()) return "";
                const predicates: string[] = [];
                for (
                  let index = 0;
                  index < payload.conditions.length;
                  index += 1
                ) {
                  if (index === conditionIndex) continue;
                  const condition = payload.conditions[index];
                  const otherField = resolveField(condition.field);
                  if (!otherField) continue;
                  const operator = normalize(condition.operator || "is");
                  const value = condition.value ?? "";
                  const rawType = normalize(otherField.type);
                  if (
                    operator.includes("not") ||
                    operator.includes("start") ||
                    operator.includes("empty") ||
                    !value.trim() ||
                    rawType.includes("reference") ||
                    rawType.includes("choice") ||
                    rawType === "boolean" ||
                    rawType === "integer"
                  ) {
                    continue;
                  }
                  predicates.push(
                    `${otherField.name}=${cleanQueryValue(value)}`,
                  );
                  if (predicates.length >= 3) break;
                }
                if (predicates.length === 0) return "";
                const records = await fetchJson(
                  `/api/now/table/${encodeURIComponent(tableName)}`,
                  {
                    sysparm_query: predicates.join("^"),
                    sysparm_fields: field.name,
                    sysparm_limit: "5",
                    sysparm_display_value: "all",
                  },
                );
                const wanted = normalize(displayValue);
                for (const record of records) {
                  const cell = record[field.name];
                  const rawValue = unwrap(cell);
                  const display = displayOf(cell);
                  if (
                    normalize(display) === wanted ||
                    normalize(rawValue) === wanted
                  ) {
                    return rawValue || display;
                  }
                }
                return "";
              };

              const resolveChoiceValue = async (
                field: FieldMeta,
                displayValue: string,
                conditionIndex: number,
              ): Promise<string> => {
                const incidentChoiceFallbacks: Record<
                  string,
                  Record<string, string>
                > = {
                  category: {
                    inquiryhelp: "inquiry",
                    inquiry: "inquiry",
                    software: "software",
                    hardware: "hardware",
                    network: "network",
                    database: "database",
                  },
                  state: {
                    new: "1",
                    inprogress: "2",
                    onhold: "3",
                    resolved: "6",
                    closed: "7",
                    canceled: "8",
                  },
                  priority: {
                    critical: "1",
                    "1critical": "1",
                    high: "2",
                    "2high": "2",
                    moderate: "3",
                    "3moderate": "3",
                    low: "4",
                    "4low": "4",
                    planning: "5",
                    "5planning": "5",
                  },
                  impact: {
                    high: "1",
                    "1high": "1",
                    medium: "2",
                    "2medium": "2",
                    low: "3",
                    "3low": "3",
                  },
                  urgency: {
                    high: "1",
                    "1high": "1",
                    medium: "2",
                    "2medium": "2",
                    low: "3",
                    "3low": "3",
                  },
                };
                const fallback =
                  tableName === "incident"
                    ? incidentChoiceFallbacks[field.name]?.[
                        keyFor(displayValue)
                      ]
                    : undefined;
                if (fallback) return fallback;

                const choices = await fetchJson("/api/now/table/sys_choice", {
                  sysparm_query: `nameIN${dictionaryTablesFor(tableName).join(",")}^element=${field.name}`,
                  sysparm_fields: "value,label",
                  sysparm_limit: "500",
                  sysparm_display_value: "all",
                });
                const wanted = keyFor(displayValue);
                const choice = choices.find((record) => {
                  const value = unwrap(record.value);
                  const label = unwrap(record.label);
                  return keyFor(value) === wanted || keyFor(label) === wanted;
                });
                if (choice) return unwrap(choice.value);
                const recordValue = await resolveValueFromCurrentTable(
                  field,
                  displayValue,
                  conditionIndex,
                );
                if (recordValue) return recordValue;
                if (field.name === "asset_function") {
                  const assetFunctionFallbacks: Record<string, string> = {
                    primary: "primary",
                    secondary: "secondary",
                  };
                  const fallback = assetFunctionFallbacks[wanted];
                  if (fallback) return fallback;
                }
                if (/^--\s*none\s*--$/i.test(displayValue.trim())) return "";
                if (/^[a-z][a-z0-9 _-]*$/i.test(displayValue.trim())) {
                  return displayValue.trim().toLowerCase().replace(/\s+/g, "_");
                }
                return displayValue;
              };

              const resolveReferenceValue = async (
                field: FieldMeta,
                displayValue: string,
                conditionIndex: number,
              ): Promise<string> => {
                if (!field.reference || !displayValue.trim())
                  return displayValue;
                const override = payload.referenceValueOverrides.find(
                  (candidate) =>
                    candidate.index === conditionIndex &&
                    candidate.referenceTable === field.reference &&
                    normalize(candidate.displayValue) ===
                      normalize(displayValue),
                );
                if (override?.sysId) return override.sysId;
                const recordValue = await resolveValueFromCurrentTable(
                  field,
                  displayValue,
                  conditionIndex,
                );
                if (recordValue) return recordValue;
                const safe = cleanQueryValue(displayValue);
                const queryFields = [
                  "name",
                  "title",
                  "label",
                  "display_name",
                  "number",
                  "user_name",
                  "email",
                  "first_name",
                  "last_name",
                ];
                const referencePath = `/api/now/table/${encodeURIComponent(field.reference)}`;
                const fetchReferenceRecords = (query: string) =>
                  fetchJson(referencePath, {
                    sysparm_query: query,
                    sysparm_fields:
                      "sys_id,name,title,label,display_name,number,user_name,email,first_name,last_name",
                    sysparm_limit: "5",
                    sysparm_display_value: "all",
                  });
                const exactQuery = [
                  "name",
                  "title",
                  "label",
                  "display_name",
                  "number",
                  "user_name",
                  "email",
                ]
                  .map((queryField) => `${queryField}=${safe}`)
                  .join("^OR");
                let records = await fetchReferenceRecords(exactQuery);
                if (records.length === 0 && field.reference === "sys_user") {
                  const parts = safe.split(/\s+/).filter(Boolean);
                  const firstName = parts[0] || "";
                  const lastName = parts.slice(1).join(" ");
                  if (firstName && lastName) {
                    records = await fetchReferenceRecords(
                      `first_name=${firstName}^last_name=${lastName}`,
                    );
                  }
                }
                if (records.length === 0) {
                  records = await fetchReferenceRecords(
                    [
                      "name",
                      "title",
                      "label",
                      "display_name",
                      "user_name",
                      "email",
                    ]
                      .map((queryField) => `${queryField}LIKE${safe}`)
                      .join("^OR"),
                  );
                }
                const wanted = normalize(displayValue);
                const selected =
                  records.find(
                    (record) =>
                      queryFields.some(
                        (queryField) =>
                          normalize(unwrap(record[queryField])) === wanted,
                      ) ||
                      normalize(
                        `${unwrap(record.first_name)} ${unwrap(record.last_name)}`,
                      ) === wanted,
                  ) || records[0];
                return selected
                  ? unwrap(selected.sys_id) || displayValue
                  : displayValue;
              };

              const resolveEncodedValue = async (
                field: FieldMeta,
                displayValue: string,
                conditionIndex: number,
              ): Promise<string> => {
                const rawType = normalize(field.type);
                if (
                  rawType.includes("choice") ||
                  rawType === "boolean" ||
                  rawType === "integer"
                ) {
                  return cleanQueryValue(
                    await resolveChoiceValue(
                      field,
                      displayValue,
                      conditionIndex,
                    ),
                  );
                }
                if (rawType.includes("reference") || field.reference) {
                  return cleanQueryValue(
                    await resolveReferenceValue(
                      field,
                      displayValue,
                      conditionIndex,
                    ),
                  );
                }
                return cleanQueryValue(displayValue);
              };

              const buildPredicate = async (
                condition: { field: string; operator: string; value: string },
                conditionIndex: number,
              ): Promise<AppliedCondition> => {
                const field = resolveField(condition.field);
                if (!field) {
                  throw new Error(`unknown_field:${condition.field}`);
                }
                const operator = normalize(condition.operator || "is");
                const displayValue = condition.value ?? "";
                if (
                  operator.includes("empty") ||
                  displayValue.trim().length === 0
                ) {
                  return {
                    field: field.name,
                    label: field.label,
                    operator: "is empty",
                    displayValue,
                    encodedValue: "",
                    predicate: `${field.name}ISEMPTY`,
                    type: field.type,
                  };
                }
                const encodedValue = await resolveEncodedValue(
                  field,
                  displayValue,
                  conditionIndex,
                );
                const encodedOperator =
                  operator.includes("not") && !operator.includes("empty")
                    ? "!="
                    : operator.includes("start")
                      ? "STARTSWITH"
                      : "=";
                return {
                  field: field.name,
                  label: field.label,
                  operator: condition.operator || "is",
                  displayValue,
                  encodedValue,
                  predicate:
                    encodedOperator === "=" || encodedOperator === "!="
                      ? `${field.name}${encodedOperator}${encodedValue}`
                      : `${field.name}${encodedOperator}${encodedValue}`,
                  type: field.type,
                };
              };

              try {
                const applied: AppliedCondition[] = [];
                for (
                  let index = 0;
                  index < payload.conditions.length;
                  index += 1
                ) {
                  applied.push(
                    await buildPredicate(payload.conditions[index], index),
                  );
                }
                const separator = payload.join === "AND" ? "^" : "^OR";
                const query = applied
                  .map((condition) => condition.predicate)
                  .join(separator);
                const target = `${tableName}_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
                return {
                  ok: true,
                  platform: "servicenow",
                  table: tableName,
                  query,
                  targetUrl: `${location.origin}/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`,
                  frameUrl: location.href,
                  currentQuery:
                    listApi && typeof listApi.getQuery === "function"
                      ? String(listApi.getQuery() || "")
                      : "",
                  conditions: applied,
                };
              } catch (error) {
                return {
                  ok: false,
                  reason:
                    error instanceof Error
                      ? error.message
                      : "filter_build_failed",
                  table: tableName,
                  availableFields: [...fields.values()]
                    .slice(0, 80)
                    .map((field) => `${field.label} (${field.name})`),
                  url: location.href,
                };
              }
            },
            args: [
              {
                conditions,
                join,
                table: effectiveTable,
                referenceValueOverrides,
              },
            ],
          }),
          APPLY_LIST_FILTER_SCRIPT_TIMEOUT_MS,
          "apply_list_filter planning",
        );

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter(Boolean);
        const applied = plans.find(
          (plan) => plan?.ok === true && typeof plan.targetUrl === "string",
        );
        if (!applied) {
          const reason =
            plans.find((plan) => typeof plan?.reason === "string")?.reason ||
            "no_supported_list_surface";
          const fields = plans.find((plan) =>
            Array.isArray(plan?.availableFields),
          )?.availableFields as string[] | undefined;
          return [
            `Error: Could not apply a structured list filter (${String(reason)}).`,
            fields?.length
              ? `Available fields included: ${fields.slice(0, 20).join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }

        const targetUrl = String(applied.targetUrl);
        const query = String(applied.query || "");
        const tableName = String(applied.table || "list");
        const conditionLines = Array.isArray(applied.conditions)
          ? (applied.conditions as Record<string, unknown>[])
              .map(
                (condition) =>
                  `- ${String(condition.label || condition.field)} ${String(condition.operator || "is")} "${String(condition.displayValue ?? "")}" -> ${String(condition.predicate || "")}`,
              )
              .join("\n")
          : "";

        if (shouldRun) {
          const currentTab = await chrome.tabs.get(tabId);
          const currentOrigin = normalizeOrigin(currentTab.url || "");
          const targetOrigin = normalizeOrigin(targetUrl);
          if (currentOrigin && targetOrigin && currentOrigin !== targetOrigin) {
            return navigationBoundaryError(targetUrl, [currentOrigin]);
          }
          await chrome.tabs.update(tabId, { url: targetUrl });
          await waitForNavigation(tabId, 10_000);
        }

        return [
          `${shouldRun ? "Applied" : "Built"} ${tableName} list filter.`,
          `Query state: sysparm_query=${query}`,
          conditionLines ? `Conditions:\n${conditionLines}` : "",
          shouldRun ? `Navigated to filtered list: ${targetUrl}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      } catch (e: any) {
        return `Error applying list filter: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.APPLY_LIST_SORT,
    APPLY_LIST_SORT_DEF,
    async (args, tabId) => {
      const rawSorts = Array.isArray(args.sorts) ? args.sorts : [];
      const sorts = rawSorts
        .map((sort) => {
          const obj =
            sort && typeof sort === "object"
              ? (sort as Record<string, unknown>)
              : {};
          const field = typeof obj.field === "string" ? obj.field.trim() : "";
          const direction =
            typeof obj.direction === "string"
              ? obj.direction.trim()
              : "ascending";
          return field ? { field, direction } : null;
        })
        .filter((sort): sort is { field: string; direction: string } =>
          Boolean(sort),
        );

      if (sorts.length === 0) {
        return "Error: apply_list_sort requires at least one sort clause with a field.";
      }

      const table = typeof args.table === "string" ? args.table.trim() : "";
      const shouldRun = args.run !== false;

      try {
        let currentTabUrl = "";
        try {
          currentTabUrl = (await chrome.tabs.get(tabId)).url || "";
        } catch {
          currentTabUrl = "";
        }
        const effectiveTable =
          table || inferServiceNowListTableFromUrl(currentTabUrl);

        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "MAIN" as any,
            func: async (payload: {
              sorts: { field: string; direction: string }[];
              table: string;
            }) => {
              type FieldMeta = {
                name: string;
                label: string;
                type: string;
                reference: string;
              };
              type AppliedSort = {
                field: string;
                label: string;
                direction: "asc" | "desc";
                predicate: string;
              };

              const normalize = (value: unknown): string =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
              const keyFor = (value: unknown): string =>
                normalize(value).replace(/[^a-z0-9]+/g, "");
              const unwrap = (value: unknown): string => {
                if (typeof value === "string") return value;
                if (value && typeof value === "object") {
                  const obj = value as Record<string, unknown>;
                  if (typeof obj.value === "string") return obj.value;
                  if (typeof obj.display_value === "string") {
                    return obj.display_value;
                  }
                }
                return "";
              };
              const serviceNowListMatch = /\/([^/?#]+)_list\.do\b/i.exec(
                location.pathname,
              );
              const listApi = (() => {
                const win = window as any;
                const glide = win.GlideList2;
                if (!glide || typeof glide.get !== "function") return null;
                const candidates = [
                  ...(document.querySelectorAll("[data-list_id]") as any),
                ]
                  .map((element: Element) =>
                    element.getAttribute("data-list_id"),
                  )
                  .filter(Boolean);
                for (const id of candidates) {
                  try {
                    const list = glide.get(id);
                    if (list) return list;
                  } catch {
                    // Try the next list candidate.
                  }
                }
                try {
                  if (win.g_list) return win.g_list;
                } catch {
                  return null;
                }
                return null;
              })();

              const tableFromList =
                listApi && typeof listApi.getTableName === "function"
                  ? String(listApi.getTableName() || "")
                  : "";
              const tableFromUrl = serviceNowListMatch?.[1] || "";
              const tableName = tableFromList || tableFromUrl;
              if (!tableName || !serviceNowListMatch) {
                return {
                  ok: false,
                  reason: "not_servicenow_list_frame",
                  url: location.href,
                  title: document.title,
                };
              }
              const hasListSurface =
                Boolean(listApi) ||
                Boolean(
                  document.querySelector(
                    "table.data_list_table, [data-list_id], th[name], [id$='_table']",
                  ),
                );
              if (!hasListSurface && !tableFromUrl) {
                return {
                  ok: false,
                  reason: "no_list_surface_in_frame",
                  table: tableName,
                  url: location.href,
                  title: document.title,
                };
              }

              if (payload.table) {
                const requested = keyFor(payload.table);
                const title = keyFor(document.title);
                if (
                  requested &&
                  requested !== keyFor(tableName) &&
                  !title.includes(requested)
                ) {
                  return {
                    ok: false,
                    reason: "table_mismatch",
                    table: tableName,
                    url: location.href,
                    title: document.title,
                  };
                }
              }

              const fetchJson = async (
                path: string,
                params: Record<string, string>,
              ): Promise<Record<string, unknown>[]> => {
                const search = new URLSearchParams(params);
                const controller = new AbortController();
                const timer = window.setTimeout(() => controller.abort(), 3000);
                try {
                  const headers: Record<string, string> = {
                    Accept: "application/json",
                  };
                  const token = String((window as any).g_ck || "");
                  if (token) headers["X-UserToken"] = token;
                  const response = await fetch(`${path}?${search.toString()}`, {
                    credentials: "same-origin",
                    headers,
                    signal: controller.signal,
                  });
                  if (!response.ok) return [];
                  const payload = await response.json().catch(() => null);
                  return Array.isArray(payload?.result) ? payload.result : [];
                } catch {
                  return [];
                } finally {
                  window.clearTimeout(timer);
                }
              };

              const fields = new Map<string, FieldMeta>();
              const addField = (
                name: string,
                label = name,
                type = "",
                reference = "",
              ) => {
                const fieldName = name.trim();
                if (!fieldName) return;
                const existing = fields.get(fieldName);
                fields.set(fieldName, {
                  name: fieldName,
                  label: label.trim() || existing?.label || fieldName,
                  type: type || existing?.type || "",
                  reference: reference || existing?.reference || "",
                });
              };
              const dictionaryTablesFor = (table: string): string[] => {
                const normalized = table.trim();
                const inherited: Record<string, string[]> = {
                  alm_hardware: [
                    "alm_hardware",
                    "alm_asset",
                    "cmdb_ci",
                    "cmdb",
                  ],
                  alm_asset: ["alm_asset", "cmdb_ci", "cmdb"],
                  change_request: ["change_request", "task"],
                  incident: ["incident", "task"],
                  problem: ["problem", "task"],
                };
                return inherited[normalized] || [normalized];
              };
              const addCommonListFields = (table: string) => {
                if (table === "alm_hardware" || table === "alm_asset") {
                  addField("asset_function", "Asset function", "choice", "");
                  addField(
                    "model_category",
                    "Model category",
                    "reference",
                    "cmdb_model_category",
                  );
                  addField("assigned_to", "Assigned to", "reference", "sys_user");
                  addField("substatus", "Substate", "choice", "");
                  addField("vendor", "Vendor", "reference", "core_company");
                  addField("cost", "Cost", "decimal", "");
                }
                if (
                  table === "change_request" ||
                  table === "incident" ||
                  table === "problem"
                ) {
                  addField("assigned_to", "Assigned to", "reference", "sys_user");
                  addField("closed_by", "Closed by", "reference", "sys_user");
                  addField("description", "Description", "string", "");
                  addField("short_description", "Short description", "string", "");
                  addField("state", "State", "choice", "");
                }
                if (table === "change_request") {
                  addField("chg_model", "Model", "reference", "chg_model");
                }
              };

              for (const th of [
                ...document.querySelectorAll(
                  `[id^="hdr_"] th[name], table.data_list_table th[name], th[name]`,
                ),
              ]) {
                const name = th.getAttribute("name") || "";
                const label =
                  th.getAttribute("glide_label") ||
                  th.getAttribute("aria-label") ||
                  th.querySelector("a")?.textContent ||
                  th.textContent ||
                  name;
                addField(name, label);
              }

              if (tableName === "incident") {
                addField("number", "Number");
                addField("task_effective_number", "Effective number");
                addField("calendar_duration", "Duration");
                addField("business_duration", "Business duration");
                addField("business_stc", "Business resolve time");
                addField("activity_due", "Activity due");
                addField("assigned_to", "Assigned to", "reference", "sys_user");
                addField(
                  "assignment_group",
                  "Assignment group",
                  "reference",
                  "sys_user_group",
                );
                addField("closed_by", "Closed by", "reference", "sys_user");
                addField("caller_id", "Caller", "reference", "sys_user");
              }

              addCommonListFields(tableName);

              const hasKnownField = (requestedField: string): boolean => {
                const normalized = keyFor(requestedField);
                const snake = normalize(requestedField).replace(
                  /[^a-z0-9]+/g,
                  "_",
                );
                if (fields.has(snake) || fields.has(`${snake}_id`)) return true;
                for (const field of fields.values()) {
                  if (
                    keyFor(field.name) === normalized ||
                    keyFor(field.label) === normalized
                  ) {
                    return true;
                  }
                }
                return false;
              };

              if (!payload.sorts.every((sort) => hasKnownField(sort.field))) {
                const dictRecords = await fetchJson(
                  "/api/now/table/sys_dictionary",
                  {
                    sysparm_query: `nameIN${dictionaryTablesFor(tableName).join(",")}^internal_type!=collection`,
                    sysparm_fields:
                      "element,column_label,internal_type,reference",
                    sysparm_limit: "1000",
                    sysparm_display_value: "all",
                  },
                );
                for (const record of dictRecords) {
                  const name = unwrap(record.element);
                  addField(
                    name,
                    unwrap(record.column_label) || name,
                    unwrap(record.internal_type),
                    unwrap(record.reference),
                  );
                }
              }

              const byKey = new Map<string, FieldMeta>();
              for (const field of fields.values()) {
                byKey.set(keyFor(field.name), field);
                byKey.set(keyFor(field.label), field);
              }

              const resolveField = (
                requestedField: string,
              ): FieldMeta | null => {
                const normalized = keyFor(requestedField);
                const snake = normalize(requestedField).replace(
                  /[^a-z0-9]+/g,
                  "_",
                );
                if (fields.has(snake)) return fields.get(snake) || null;
                if (fields.has(`${snake}_id`))
                  return fields.get(`${snake}_id`) || null;
                const direct = byKey.get(normalized);
                if (direct) return direct;
                const partial = [...fields.values()]
                  .filter((field) => {
                    const labelKey = keyFor(field.label);
                    return (
                      labelKey.includes(normalized) ||
                      normalized.includes(labelKey)
                    );
                  })
                  .sort(
                    (a, b) => keyFor(a.label).length - keyFor(b.label).length,
                  );
                return partial[0] || null;
              };

              const normalizeDirection = (direction: string): "asc" | "desc" =>
                normalize(direction).startsWith("desc") ? "desc" : "asc";

              try {
                const applied: AppliedSort[] = payload.sorts.map((sort) => {
                  const field = resolveField(sort.field);
                  if (!field) throw new Error(`unknown_field:${sort.field}`);
                  const direction = normalizeDirection(sort.direction);
                  const predicate = `ORDERBY${direction === "desc" ? "DESC" : ""}${field.name}`;
                  return {
                    field: field.name,
                    label: field.label,
                    direction,
                    predicate,
                  };
                });
                const currentQuery =
                  listApi && typeof listApi.getQuery === "function"
                    ? String(listApi.getQuery() || "")
                    : new URLSearchParams(location.search).get(
                        "sysparm_query",
                      ) || "";
                const baseQuery = currentQuery
                  .split("^")
                  .map((part) => part.trim())
                  .filter((part) => part && !/^ORDERBY/i.test(part))
                  .join("^");
                const query = [
                  baseQuery,
                  ...applied.map((sort) => sort.predicate),
                ]
                  .filter(Boolean)
                  .join("^");
                const target = `${tableName}_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
                return {
                  ok: true,
                  platform: "servicenow",
                  table: tableName,
                  query,
                  targetUrl: `${location.origin}/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`,
                  frameUrl: location.href,
                  sorts: applied,
                };
              } catch (error) {
                return {
                  ok: false,
                  reason:
                    error instanceof Error
                      ? error.message
                      : "sort_build_failed",
                  table: tableName,
                  availableFields: [...fields.values()]
                    .slice(0, 80)
                    .map((field) => `${field.label} (${field.name})`),
                  url: location.href,
                };
              }
            },
            args: [
              {
                sorts,
                table: effectiveTable,
              },
            ],
          }),
          12_000,
          "apply_list_sort planning",
        );

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter(Boolean);
        const applied = plans.find(
          (plan) => plan?.ok === true && typeof plan.targetUrl === "string",
        );
        if (!applied) {
          const reason =
            plans.find((plan) => typeof plan?.reason === "string")?.reason ||
            "no_supported_list_surface";
          const fields = plans.find((plan) =>
            Array.isArray(plan?.availableFields),
          )?.availableFields as string[] | undefined;
          return [
            `Error: Could not apply structured list sorting (${String(reason)}).`,
            fields?.length
              ? `Available fields included: ${fields.slice(0, 20).join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }

        const targetUrl = String(applied.targetUrl);
        const query = String(applied.query || "");
        const tableName = String(applied.table || "list");
        const sortLines = Array.isArray(applied.sorts)
          ? (applied.sorts as Record<string, unknown>[])
              .map(
                (sort) =>
                  `- ${String(sort.label || sort.field)} ${String(sort.direction || "asc")} -> ${String(sort.predicate || "")}`,
              )
              .join("\n")
          : "";

        if (shouldRun) {
          const currentTab = await chrome.tabs.get(tabId);
          const currentOrigin = normalizeOrigin(currentTab.url || "");
          const targetOrigin = normalizeOrigin(targetUrl);
          if (currentOrigin && targetOrigin && currentOrigin !== targetOrigin) {
            return navigationBoundaryError(targetUrl, [currentOrigin]);
          }
          await chrome.tabs.update(tabId, { url: targetUrl });
          await waitForNavigation(tabId, 10_000);
        }

        return [
          `${shouldRun ? "Applied" : "Built"} ${tableName} list sorting.`,
          `Query state: sysparm_query=${query}`,
          sortLines ? `Sorts:\n${sortLines}` : "",
          shouldRun ? `Navigated to sorted list: ${targetUrl}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      } catch (e: any) {
        return `Error applying list sort: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.INSPECT_CATALOG_ITEM,
    INSPECT_CATALOG_ITEM_DEF,
    async (args, tabId) => {
      const maxControls = Math.min(
        Math.max((args.maxControls as number) || 40, 1),
        80,
      );
      return runReadOnlyPageInspector(
        tabId,
        (max: number) => {
          const norm = (value: unknown) =>
            String(value ?? "")
              .replace(/\s+/g, " ")
              .trim();
          const lines: string[] = [
            `URL: ${location.href}`,
            `Title: ${document.title}`,
          ];
          const bodyText = document.body?.innerText || "";
          const priceText = norm(bodyText)
            .match(
              /(?:[$€£]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP)|annually|monthly|total|price)/gi,
            )
            ?.slice(0, 20)
            .join(" | ");
          if (priceText) lines.push(`Price/summary cues: ${priceText}`);
          const cartLines = bodyText
            .split(/\r?\n/)
            .map(norm)
            .filter(Boolean)
            .filter((line) =>
              /\b(shopping cart|cart|checkout|order status|request number|thank you|submitted|line items?|quantity|total|delivery date|req\d+|ritm\d+)\b/i.test(
                line,
              ),
            )
            .slice(0, 30);
          if (cartLines.length) {
            lines.push("Cart/order cues:");
            lines.push(...cartLines.map((line) => `- ${line.slice(0, 220)}`));
          }

          const controls = [
            ...document.querySelectorAll(
              "input, select, textarea, button, [role='button'], [role='checkbox'], [role='spinbutton']",
            ),
          ].slice(0, max * 2);
          const rows: string[] = [];
          for (const el of controls) {
            const control = el as
              | HTMLInputElement
              | HTMLSelectElement
              | HTMLTextAreaElement;
            const type =
              el.getAttribute("type") ||
              el.getAttribute("role") ||
              el.tagName.toLowerCase();
            const label = norm(
              [
                el.getAttribute("aria-label"),
                el.getAttribute("title"),
                el.getAttribute("name"),
                el.getAttribute("id"),
                el.closest("label")?.textContent,
                control.value,
                el.textContent,
              ]
                .filter(Boolean)
                .join(" "),
            );
            if (!label) continue;
            const checked =
              "checked" in control && typeof control.checked === "boolean"
                ? ` checked=${control.checked}`
                : "";
            rows.push(`- ${type}${checked}: ${label.slice(0, 220)}`);
            if (rows.length >= max) break;
          }
          if (rows.length === 0) lines.push("No catalog controls found.");
          else {
            lines.push("Catalog controls:");
            lines.push(...rows);
          }
          return lines.join("\n");
        },
        [maxControls],
        "No catalog item state found.",
      );
    },
  );

  toolRegistry.register(
    ToolName.CONFIGURE_CATALOG_ITEM,
    CONFIGURE_CATALOG_ITEM_DEF,
    async (args, tabId) => {
      const quantity =
        args.quantity === undefined || args.quantity === null
          ? null
          : String(args.quantity);
      const textFields = Array.isArray(args.textFields)
        ? args.textFields
            .filter(
              (field: any) =>
                typeof field?.field === "string" &&
                typeof field?.value === "string" &&
                field.field.trim(),
            )
            .map((field: any) => ({
              field: field.field.trim(),
              value: field.value,
            }))
        : [];
      const optionFields = Array.isArray(args.optionFields)
        ? args.optionFields
            .filter(
              (field: any) =>
                typeof field?.field === "string" &&
                typeof field?.value === "string" &&
                field.field.trim(),
            )
            .map((field: any) => ({
              field: field.field.trim(),
              value: field.value,
            }))
        : [];
      const checkboxes = Array.isArray(args.checkboxes)
        ? args.checkboxes
            .filter(
              (checkbox: any) =>
                typeof checkbox?.label === "string" &&
                typeof checkbox?.checked === "boolean" &&
                checkbox.label.trim(),
            )
            .map((checkbox: any) => ({
              label: checkbox.label.trim(),
              checked: checkbox.checked,
            }))
        : [];
      const submit = args.submit === true;
      const submitButton =
        typeof args.submitButton === "string" && args.submitButton.trim()
          ? args.submitButton.trim()
          : null;
      const continueToCheckout = args.continueToCheckout === true;

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: "MAIN" as any,
          func: async (input: {
            quantity: string | null;
            textFields: Array<{ field: string; value: string }>;
            optionFields: Array<{ field: string; value: string }>;
            checkboxes: Array<{ label: string; checked: boolean }>;
            submit: boolean;
            submitButton: string | null;
            continueToCheckout: boolean;
          }) => {
            const sleep = (ms: number) =>
              new Promise((resolve) => setTimeout(resolve, ms));
            const norm = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
            const display = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const visible = (el: Element | null) => {
              if (!el || !(el instanceof HTMLElement)) return false;
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.opacity !== "0" &&
                rect.width > 0 &&
                rect.height > 0
              );
            };
            const escapeCss = (value: string) =>
              window.CSS?.escape
                ? window.CSS.escape(value)
                : value.replace(/["\\]/g, "\\$&");
            const directLabelsFor = (el: Element): string[] => {
              const control = el as
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement;
              return [
                el.getAttribute("aria-label"),
                el.getAttribute("aria-labelledby"),
                el.getAttribute("title"),
                el.getAttribute("data-original-title"),
                el.getAttribute("placeholder"),
                el.getAttribute("name"),
                el.getAttribute("id"),
                el.getAttribute("control"),
                control.value,
                el.textContent,
              ]
                .map(display)
                .filter(Boolean);
            };
            const labelsFor = (el: Element): string[] => {
              const labels = directLabelsFor(el);
              const labelledBy = el.getAttribute("aria-labelledby");
              if (labelledBy) {
                for (const labelId of labelledBy.split(/\s+/)) {
                  if (!labelId) continue;
                  labels.push(document.getElementById(labelId)?.textContent);
                }
              }
              const id = el.getAttribute("id");
              if (id) {
                document
                  .querySelectorAll(`label[for="${escapeCss(id)}"]`)
                  .forEach((label) => labels.push(label.textContent));
              }
              const closestLabel = el.closest("label");
              if (closestLabel) labels.push(closestLabel.textContent);
              const previous = el.previousElementSibling;
              if (previous) labels.push(previous.textContent);
              let ancestor = el.parentElement;
              let depth = 0;
              while (ancestor && ancestor !== document.body && depth < 4) {
                const ancestorText = display(
                  ancestor.innerText || ancestor.textContent,
                );
                if (ancestorText && ancestorText.length <= 300) {
                  labels.push(ancestorText);
                }
                Array.from(ancestor.children)
                  .filter(
                    (node) =>
                      node !== el &&
                      node.matches(
                        "label, [aria-label], [title], .label, .question_text, .sc-variable-label",
                      ),
                  )
                  .forEach((node) => {
                    labels.push(
                      node.getAttribute("aria-label") ||
                        node.getAttribute("title") ||
                        node.textContent,
                    );
                  });
                ancestor = ancestor.parentElement;
                depth += 1;
              }
              return labels.map(display).filter(Boolean);
            };
            const matches = (labels: string[], expected: string) => {
              const needle = norm(expected);
              return labels.some((label) => {
                const haystack = norm(label);
                return haystack === needle || haystack.includes(needle);
              });
            };
            const triggerLibraryEvents = (
              el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
            ) => {
              const win = (el.ownerDocument?.defaultView || window) as any;
              for (const candidate of [win.jQuery, win.$j]) {
                if (typeof candidate !== "function") continue;
                try {
                  const wrapped = candidate(el);
                  wrapped?.trigger?.("change");
                  wrapped?.trigger?.("input");
                } catch {
                  // Library hooks are best-effort; native events remain primary.
                }
              }
            };
            const serviceNowFieldNamesFor = (el: Element) => {
              const rawNames = [
                el.getAttribute("name"),
                el.getAttribute("id"),
                el.getAttribute("control"),
                el.getAttribute("for"),
                el.getAttribute("aria-controls"),
              ]
                .map(display)
                .filter(Boolean);
              const names: string[] = [];
              for (const rawName of rawNames) {
                names.push(rawName);
                const withoutLabel = rawName.replace(/_label$/i, "");
                if (withoutLabel !== rawName) names.push(withoutLabel);
                const withoutNi = withoutLabel.replace(/^ni\./i, "");
                if (withoutNi !== withoutLabel) names.push(withoutNi);
              }
              return [...new Set(names)];
            };
            const commitServiceNowValue = (el: Element, value: string) => {
              const gForm = (window as any).g_form;
              if (typeof gForm?.setValue !== "function") return;
              for (const name of serviceNowFieldNamesFor(el)) {
                try {
                  gForm.setValue(name, value);
                } catch {
                  // Some visible catalog controls are not g_form fields.
                }
              }
            };
            const setNativeValue = (
              el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
              value: string,
            ) => {
              if (el instanceof HTMLSelectElement) {
                const optionIndex = [...el.options].findIndex(
                  (option) => option.value === value,
                );
                try {
                  el.scrollIntoView({ behavior: "instant", block: "center" });
                  el.focus();
                } catch {
                  // Non-visual test environments may not implement scrolling.
                }
                const setter = Object.getOwnPropertyDescriptor(
                  HTMLSelectElement.prototype,
                  "value",
                )?.set;
                if (setter) setter.call(el, value);
                else el.value = value;
                if (optionIndex >= 0) el.selectedIndex = optionIndex;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
                triggerLibraryEvents(el);
                commitServiceNowValue(el, value);
                return;
              }
              const prototype = Object.getPrototypeOf(el);
              const descriptor =
                Object.getOwnPropertyDescriptor(prototype, "value") ||
                Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value",
                );
              if (descriptor?.set) descriptor.set.call(el, value);
              el.value = value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("blur", { bubbles: true }));
              triggerLibraryEvents(el);
              commitServiceNowValue(el, value);
            };
            const setNativeChecked = (
              el: HTMLInputElement,
              checked: boolean,
            ) => {
              const descriptor =
                Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "checked",
                ) ||
                Object.getOwnPropertyDescriptor(
                  Object.getPrototypeOf(el),
                  "checked",
                );
              if (descriptor?.set) descriptor.set.call(el, checked);
              el.checked = checked;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              triggerLibraryEvents(el);
              commitServiceNowValue(el, checked ? "true" : "false");
            };
            const setRelatedCheckboxControls = (
              source: Element,
              checked: boolean,
            ) => {
              const aliases = new Set(serviceNowFieldNamesFor(source));
              if (aliases.size === 0) return;
              const value = checked ? "true" : "false";
              const controls = [
                ...document.querySelectorAll("input, select, textarea"),
              ] as Array<
                HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
              >;
              for (const control of controls) {
                if (control === source) continue;
                const names = serviceNowFieldNamesFor(control);
                if (!names.some((name) => aliases.has(name))) continue;
                if (
                  control instanceof HTMLInputElement &&
                  control.type === "checkbox"
                ) {
                  setNativeChecked(control, checked);
                } else {
                  setNativeValue(control, value);
                }
              }
            };
            const checkboxState = (el: Element): boolean | null => {
              if (el instanceof HTMLInputElement && el.type === "checkbox") {
                return el.checked;
              }
              const controlId =
                el.getAttribute("for") ||
                el.getAttribute("control") ||
                el.getAttribute("aria-controls");
              const controlled = controlId
                ? document.getElementById(controlId)
                : null;
              if (
                controlled instanceof HTMLInputElement &&
                controlled.type === "checkbox"
              ) {
                return controlled.checked;
              }
              const checked =
                el.getAttribute("aria-checked") ||
                el.getAttribute("checked") ||
                el.getAttribute("data-checked");
              if (checked === "true") return true;
              if (checked === "false") return false;
              return null;
            };
            const labelAnchorsFor = (field: string) => {
              const root = document.body || document.documentElement;
              const needle = norm(field);
              const anchors: Node[] = [];
              const walker = document.createTreeWalker(root, 4);
              let node = walker.nextNode();
              while (node) {
                const parent = node.parentElement;
                const text = norm(node.textContent);
                if (
                  parent &&
                  text &&
                  !/^(script|style|noscript)$/i.test(parent.tagName) &&
                  (text === needle || text.includes(needle))
                ) {
                  anchors.push(parent);
                }
                node = walker.nextNode();
              }
              return anchors;
            };
            const findFollowingControl = <T extends Element>(
              field: string,
              controls: T[],
            ): T | undefined => {
              for (const anchor of labelAnchorsFor(field)) {
                const control = controls.find(
                  (el) => Boolean(anchor.compareDocumentPosition(el) & 4),
                );
                if (control) return control;
              }
              return undefined;
            };
            const findQuantity = () => {
              const controls = [
                ...document.querySelectorAll(
                  "select, input:not([type='button']):not([type='submit'])",
                ),
              ] as Array<HTMLInputElement | HTMLSelectElement>;
              const visibleControls = controls.filter(visible);
              const byLabel = (
                candidates: Array<HTMLInputElement | HTMLSelectElement>,
              ) =>
                candidates.find((el) => matches(labelsFor(el), "quantity")) ||
                candidates.find((el) =>
                  /quantity|qty/i.test(`${el.id} ${el.name}`),
                );
              return (
                byLabel(visibleControls) ||
                findFollowingControl("quantity", visibleControls) ||
                byLabel(controls) ||
                findFollowingControl("quantity", controls)
              );
            };
            const setRelatedQuantityControls = (
              value: string,
              primary: HTMLInputElement | HTMLSelectElement,
            ) => {
              const controls = [
                ...document.querySelectorAll(
                  "select, input:not([type='button']):not([type='submit'])",
                ),
              ] as Array<HTMLInputElement | HTMLSelectElement>;
              for (const control of controls) {
                if (control === primary) continue;
                if (!/quantity|qty/i.test(`${control.id} ${control.name}`)) {
                  continue;
                }
                setNativeValue(control, value);
              }
            };
            const findTextControl = (field: string) => {
              const controls = [
                ...document.querySelectorAll(
                  "textarea, input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit'])",
                ),
              ] as Array<HTMLInputElement | HTMLTextAreaElement>;
              const visibleControls = controls.filter(visible);
              return (
                visibleControls.find((el) => matches(labelsFor(el), field)) ||
                findFollowingControl(field, visibleControls) ||
                controls.find((el) => matches(labelsFor(el), field)) ||
                findFollowingControl(field, controls)
              );
            };
            const selectOptionFor = (
              control: HTMLSelectElement,
              value: string,
            ) =>
              [...control.options].find(
                (candidate) =>
                  norm(candidate.value) === norm(value) ||
                  norm(candidate.textContent) === norm(value),
              ) ||
              [...control.options].find((candidate) =>
                norm(candidate.textContent).includes(norm(value)),
              );
            const findOptionControl = (field: string, value: string) => {
              const controls = [
                ...document.querySelectorAll("select"),
              ] as HTMLSelectElement[];
              const labelled = controls.find((el) =>
                matches(labelsFor(el), field),
              );
              if (labelled) return labelled;
              const visibleFollowing = findFollowingControl(
                field,
                controls.filter(visible),
              );
              if (visibleFollowing) return visibleFollowing;
              const following = findFollowingControl(field, controls);
              if (following) return following;
              const valueMatches = controls.filter((el) =>
                selectOptionFor(el, value),
              );
              return valueMatches.length === 1 ? valueMatches[0] : undefined;
            };
            const findCheckbox = (label: string) => {
              const controls = [
                ...document.querySelectorAll(
                  "input[type='checkbox'], [role='checkbox'], label[type='checkbox'], label[control]",
                ),
              ];
              const checkboxLabelsFor = (el: Element): string[] => {
                const labels = directLabelsFor(el);
                const id = el.getAttribute("id");
                if (id) {
                  document
                    .querySelectorAll(
                      `label[for="${escapeCss(id)}"], label[control="${escapeCss(id)}"]`,
                    )
                    .forEach((candidate) => labels.push(candidate.textContent));
                  labels.push(document.getElementById(`${id}_label`)?.textContent);
                }
                const controlId =
                  el.getAttribute("for") ||
                  el.getAttribute("control") ||
                  el.getAttribute("aria-controls");
                if (controlId) {
                  labels.push(document.getElementById(controlId)?.textContent);
                }
                return labels.map(display).filter(Boolean);
              };
              return controls.find((el) => matches(checkboxLabelsFor(el), label));
            };
            const setCheckboxControlState = (
              control: Element,
              checked: boolean,
              allowClick: boolean,
            ) => {
              const before = checkboxState(control);
              if (
                allowClick &&
                before !== checked &&
                control instanceof HTMLElement &&
                visible(control)
              ) {
                control.click();
              }
              const controlId =
                control.getAttribute("for") ||
                control.getAttribute("control") ||
                control.getAttribute("aria-controls");
              const inputEl = controlId
                ? document.getElementById(controlId)
                : control;
              if (
                inputEl instanceof HTMLInputElement &&
                inputEl.type === "checkbox"
              ) {
                setNativeChecked(inputEl, checked);
                setRelatedCheckboxControls(inputEl, checked);
              }
              if (control instanceof HTMLElement) {
                control.setAttribute("checked", String(checked));
                control.setAttribute("aria-checked", String(checked));
                commitServiceNowValue(control, checked ? "true" : "false");
                setRelatedCheckboxControls(control, checked);
              }
              return checkboxState(control);
            };
            const currentBodyText = () =>
              display(document.body?.innerText || "");
            const cartCheckoutVisible = () => {
              const text = currentBodyText();
              return (
                /\bcart\b/i.test(text) &&
                /\b(proceed to checkout|checkout)\b/i.test(text)
              );
            };
            const findSubmitControl = () => {
              const controls = [
                ...document.querySelectorAll(
                  "button, input[type='button'], input[type='submit'], a, [role='button']",
                ),
              ].filter(visible);
              const findByPattern = (pattern: RegExp) =>
                controls.find((el) =>
                  directLabelsFor(el).some((label) => pattern.test(label)),
                ) as HTMLElement | undefined;
              if (
                input.continueToCheckout &&
                input.submitButton &&
                /\badd to cart\b/i.test(input.submitButton)
              ) {
                const directOrder = findByPattern(
                  /\b(order now|place order|submit order|request)\b/i,
                );
                if (directOrder) return directOrder;
              }
              if (input.submitButton) {
                const exact = controls.find((el) =>
                  matches(directLabelsFor(el), input.submitButton as string),
                );
                if (exact) return exact as HTMLElement;
              }
              const patterns = cartCheckoutVisible()
                ? [
                    /\b(proceed to checkout|checkout)\b/i,
                    /\b(order now|place order|submit order|request)\b/i,
                    /\badd to cart\b/i,
                    /\border\b/i,
                  ]
                : [
                    /\b(order now|place order|submit order|request)\b/i,
                    /\badd to cart\b/i,
                    /\b(proceed to checkout|checkout)\b/i,
                    /\border\b/i,
                  ];
              for (const pattern of patterns) {
                const control = findByPattern(pattern);
                if (control) return control;
              }
              return undefined;
            };

            const configured: string[] = [];
            const mismatches: string[] = [];
            const cartReady = cartCheckoutVisible();
            const pageLooksCatalog =
              /catalog|cat_item|service catalog|order now|request/i.test(
                `${location.href} ${document.title} ${document.body?.innerText || ""}`,
              );

            for (const field of input.textFields) {
              const control = findTextControl(field.field);
              if (!control) {
                mismatches.push(`Text field not found: ${field.field}.`);
                continue;
              }
              setNativeValue(control, field.value);
              configured.push(`${field.field}="${field.value}"`);
            }

            for (const field of input.optionFields) {
              const control = findOptionControl(field.field, field.value);
              if (!control) {
                mismatches.push(`Dropdown field not found: ${field.field}.`);
                continue;
              }
              const option = selectOptionFor(control, field.value);
              if (!option) {
                mismatches.push(
                  `Dropdown option not found for ${field.field}: ${field.value}.`,
                );
                continue;
              }
              setNativeValue(control, option.value);
              const selectedText =
                control.selectedOptions[0]?.textContent?.trim() || control.value;
              if (
                norm(control.value) !== norm(option.value) &&
                norm(selectedText) !== norm(field.value)
              ) {
                mismatches.push(
                  `Dropdown ${field.field} is ${selectedText || control.value}.`,
                );
              } else {
                configured.push(`${field.field}=${selectedText || option.value}`);
              }
            }

            for (const checkbox of input.checkboxes) {
              const control = findCheckbox(checkbox.label);
              if (!control) {
                mismatches.push(`Checkbox not found: ${checkbox.label}.`);
                continue;
              }
              const after = setCheckboxControlState(
                control,
                checkbox.checked,
                true,
              );
              if (after !== null && after !== checkbox.checked) {
                mismatches.push(
                  `Checkbox ${checkbox.label} is ${after ? "checked" : "unchecked"}.`,
                );
              } else {
                configured.push(
                  `${checkbox.label}=${checkbox.checked ? "checked" : "unchecked"}`,
                );
              }
            }

            if (input.quantity !== null) {
              const quantity = findQuantity();
              if (!quantity) {
                mismatches.push(
                  `Quantity control not found for ${input.quantity}.`,
                );
              } else if (quantity instanceof HTMLSelectElement) {
                const option = [...quantity.options].find(
                  (candidate) =>
                    norm(candidate.value) === norm(input.quantity) ||
                    norm(candidate.textContent) === norm(input.quantity),
                );
                if (!option) {
                  mismatches.push(
                    `Quantity option not found for ${input.quantity}.`,
                  );
                } else {
                  setNativeValue(quantity, option.value);
                  setRelatedQuantityControls(option.value, quantity);
                  const selectedText =
                    quantity.selectedOptions[0]?.textContent?.trim() ||
                    quantity.value;
                  if (
                    norm(quantity.value) !== norm(option.value) &&
                    norm(selectedText) !== norm(input.quantity)
                  ) {
                    mismatches.push(
                      `Quantity is ${selectedText || quantity.value}.`,
                    );
                  } else {
                    configured.push(`Quantity=${selectedText || option.value}`);
                  }
                }
              } else {
                setNativeValue(quantity, input.quantity);
                setRelatedQuantityControls(input.quantity, quantity);
                if (norm(quantity.value) !== norm(input.quantity)) {
                  mismatches.push(`Quantity is ${quantity.value}.`);
                } else {
                  configured.push(`Quantity=${input.quantity}`);
                }
              }
            }

            if (input.submit && configured.length > 0 && mismatches.length === 0) {
              await sleep(2_000);
              for (const checkbox of input.checkboxes) {
                const control = findCheckbox(checkbox.label);
                if (control) {
                  setCheckboxControlState(control, checkbox.checked, false);
                }
              }
            }

            let submitControl =
              mismatches.length === 0 && input.submit
                ? findSubmitControl()
                : null;
            let submitClicked = false;
            let submitLabel: string | null = null;
            if (input.submit && mismatches.length === 0) {
              if (!submitControl) {
                mismatches.push("Submit/order control not found.");
              } else {
                const submitInput = submitControl as HTMLInputElement;
                const submitLabels = [
                  submitControl.textContent,
                  submitInput.value,
                  submitControl.getAttribute("aria-label"),
                  submitControl.getAttribute("title"),
                  ...directLabelsFor(submitControl),
                ]
                  .map(display)
                  .filter(Boolean);
                submitLabel =
                  submitLabels.find((label) =>
                    /\b(add to cart|checkout|order|request|submit)\b/i.test(
                      label,
                    ),
                  ) ||
                  submitLabels[0] ||
                  submitControl.textContent ||
                  "submit";
                if (cartReady && /\badd to cart\b/i.test(submitLabel)) {
                  mismatches.push(
                    "Cart already has checkout controls; refusing duplicate Add to Cart.",
                  );
                  submitControl = null;
                } else {
                  submitControl.click();
                  submitClicked = true;
                }
              }
            }

            return {
              matched:
                pageLooksCatalog ||
                configured.length > 0 ||
                mismatches.length > 0,
              ok: mismatches.length === 0 && (!input.submit || submitClicked),
              url: location.href,
              title: document.title,
              configured,
              mismatches,
              cartReady,
              submitClicked,
              submitLabel,
            };
          },
          args: [
            {
              quantity,
              textFields,
              optionFields,
              checkboxes,
              submit,
              submitButton,
              continueToCheckout,
            },
          ],
        });

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter((result): result is Record<string, unknown> =>
            Boolean(result),
          );
        const selected =
          plans.find((plan) => plan.ok === true) ||
          plans.find((plan) => plan.matched === true);

        if (!selected) {
          return "Error: Could not find a catalog item form on the current page.";
        }

        if (selected.submitClicked === true) {
          await waitForNavigation(tabId, 12_000);
          await waitForDomReady(tabId, {
            timeoutMs: 2_000,
            waitForElements: true,
          });
        }

        let checkoutClick: Record<string, unknown> | null = null;
        const clickedSubmitLabel = String(selected.submitLabel || "");
        const shouldContinueFromCart =
          continueToCheckout &&
          selected.submitClicked === true &&
          /\badd to cart\b/i.test(clickedSubmitLabel);

        if (shouldContinueFromCart) {
          const checkoutResults = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "MAIN" as any,
            func: async () => {
              const sleep = (ms: number) =>
                new Promise((resolve) => setTimeout(resolve, ms));
              const display = (value: unknown) =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim();
              const visible = (el: Element | null) => {
                if (!el || !(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  style.opacity !== "0" &&
                  rect.width > 0 &&
                  rect.height > 0
                );
              };
              const labelsFor = (el: Element): string[] => {
                const control = el as HTMLInputElement;
                return [
                  el.getAttribute("aria-label"),
                  el.getAttribute("title"),
                  el.getAttribute("name"),
                  el.getAttribute("id"),
                  control.value,
                  el.textContent,
                ]
                  .map(display)
                  .filter(Boolean);
              };
              const currentBodyText = () =>
                display(document.body?.innerText || document.body?.textContent || "");
              const cartReady = () => {
                const text = currentBodyText();
                return (
                  /\b(cart|basket|bag)\b/i.test(text) &&
                  /\b(proceed to checkout|continue to checkout|checkout)\b/i.test(
                    text,
                  )
                );
              };
              const findCheckoutControl = () => {
                const controls = [
                  ...document.querySelectorAll(
                    "button, input[type='button'], input[type='submit'], a, [role='button']",
                  ),
                ].filter(visible);
                return controls.find((el) =>
                  labelsFor(el).some((label) =>
                    /\b(proceed to checkout|continue to checkout|checkout)\b/i.test(
                      label,
                    ),
                  ),
                ) as HTMLElement | undefined;
              };

              const deadline = Date.now() + 3_000;
              do {
                const control = findCheckoutControl();
                if (control && cartReady()) {
                  const labels = labelsFor(control);
                  const label =
                    labels.find((value) =>
                      /\b(proceed to checkout|continue to checkout|checkout)\b/i.test(
                        value,
                      ),
                    ) ||
                    labels[0] ||
                    control.textContent ||
                    "checkout";
                  control.click();
                  return {
                    cartReady: true,
                    clicked: true,
                    label,
                    url: location.href,
                    title: document.title,
                  };
                }
                await sleep(150);
              } while (Date.now() < deadline);

              return {
                cartReady: cartReady(),
                clicked: false,
                label: null,
                url: location.href,
                title: document.title,
              };
            },
            args: [],
          });
          const checkoutPlans = (checkoutResults || [])
            .map(
              (result) =>
                result.result as Record<string, unknown> | undefined,
            )
            .filter((result): result is Record<string, unknown> =>
              Boolean(result),
            );
          checkoutClick =
            checkoutPlans.find((plan) => plan.clicked === true) || null;
          if (checkoutClick?.clicked === true) {
            await waitForNavigation(tabId, 12_000);
            await waitForDomReady(tabId, {
              timeoutMs: 2_000,
              waitForElements: true,
            });
          }
        }

        const tab = await chrome.tabs.get(tabId);
        const configured = Array.isArray(selected.configured)
          ? selected.configured.map(String)
          : [];
        const mismatches = Array.isArray(selected.mismatches)
          ? selected.mismatches.map(String)
          : [];
        const lines = [
          selected.ok
            ? "Configured catalog item."
            : "Catalog item configuration incomplete.",
          configured.length ? `Configured:\n- ${configured.join("\n- ")}` : "",
          mismatches.length ? `Mismatches:\n- ${mismatches.join("\n- ")}` : "",
          selected.cartReady === true
            ? "Cart/order controls are already visible. Do not add the same item again; inspect cart state and proceed only if line count and quantity match the request."
            : "",
          selected.submitClicked
            ? `Clicked submit control: ${String(selected.submitLabel || "submit")}`
            : "",
          checkoutClick?.clicked === true
            ? `Clicked cart checkout control: ${String(checkoutClick.label || "checkout")}`
            : "",
          `Current URL: ${tab.url || selected.url || ""}`,
          `Current title: ${tab.title || selected.title || ""}`,
        ];
        return lines.filter(Boolean).join("\n");
      } catch (e: any) {
        return `Error configuring catalog item: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.CONFIGURE_SERVICENOW_FORM,
    CONFIGURE_SERVICENOW_FORM_DEF,
    async (args, tabId) => {
      const fields = Array.isArray(args.fields)
        ? args.fields
            .filter(
              (field: any) =>
                typeof field?.field === "string" &&
                typeof field?.value === "string" &&
                field.field.trim(),
            )
            .map((field: any) => ({
              field: field.field.trim(),
              value: field.value,
            }))
        : [];
      const submit = args.submit === true;
      const submitButton =
        typeof args.submitButton === "string" && args.submitButton.trim()
          ? args.submitButton.trim()
          : null;

      if (fields.length === 0 && !submit) {
        return "Error: provide at least one field or set submit=true.";
      }

      try {
        let scriptTarget: { tabId: number; frameIds?: number[] } = { tabId };
        try {
          const tab = await chrome.tabs.get(tabId);
          const tableHints = new Set<string>();
          const collectTableHints = (url: string) => {
            for (const match of url.matchAll(
              /(?:target\/|\/)([a-z][a-z0-9_]*)\.do(?:[/?#]|$)/gi,
            )) {
              tableHints.add(match[1].toLowerCase());
            }
          };
          collectTableHints(tab.url || "");
          const frames =
            typeof chrome.webNavigation?.getAllFrames === "function"
              ? await chrome.webNavigation.getAllFrames({ tabId })
              : null;
          const frameScores = (frames || [])
            .map((frame) => {
              const frameUrl = String(frame.url || "");
              const url = frameUrl.toLowerCase();
              const isServiceNowHost =
                /^https:\/\/[^/]+\.service-now\.com\//i.test(frameUrl) ||
                /^https:\/\/[^/]+\.servicenow\.com\//i.test(frameUrl);
              if (!isServiceNowHost) return null;
              let score = frame.frameId === 0 ? 0 : 10;
              if (/\.do(?:[/?#]|$)/i.test(frameUrl)) score += 20;
              for (const tableHint of tableHints) {
                if (
                  url.includes(`/${tableHint}.do`) ||
                  url.includes(`target/${tableHint}.do`)
                ) {
                  score += 100;
                }
              }
              if (/about:blank|empty\.html|blank\.html/i.test(frameUrl)) {
                score -= 100;
              }
              return { frameId: frame.frameId, score };
            })
            .filter(
              (
                frame,
              ): frame is {
                frameId: number;
                score: number;
              } => Boolean(frame),
            )
            .sort((a, b) => b.score - a.score);
          const selectedFrame = frameScores[0];
          if (selectedFrame && selectedFrame.frameId !== 0) {
            scriptTarget = { tabId, frameIds: [selectedFrame.frameId] };
          }
        } catch {
          // Fall back to the current frame if frame metadata is unavailable.
        }

        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: scriptTarget,
            world: "MAIN" as any,
            func: async (input: {
              fields: Array<{ field: string; value: string }>;
              submit: boolean;
              submitButton: string | null;
            }) => {
              const normalize = (value: unknown) =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
            const keyFor = (value: unknown) =>
              normalize(value).replace(/[^a-z0-9]+/g, "");
            const display = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const escapeCss = (value: string) =>
              (window as any).CSS?.escape
                ? (window as any).CSS.escape(value)
                : value.replace(/["\\]/g, "\\$&");
            const isServiceNowHost =
              location.hostname.endsWith(".service-now.com") ||
              location.hostname.endsWith(".servicenow.com");
            const gForm = (window as any).g_form;
            if (!isServiceNowHost || !gForm) {
              return {
                matched: false,
                ok: false,
                reason: "not_servicenow_form_frame",
                url: location.href,
                title: document.title,
              };
            }

            type FieldMeta = {
              name: string;
              fieldPath: string;
              label: string;
              type: string;
              reference: string;
              control:
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement
                | null;
            };

            const normalizeFieldName = (raw: unknown): string => {
              const text = String(raw ?? "").trim();
              if (!text) return "";
              const withoutDisplay = text.replace(/^sys_display\./, "");
              return withoutDisplay.includes(".")
                ? withoutDisplay.slice(withoutDisplay.lastIndexOf(".") + 1)
                : withoutDisplay;
            };

            const controlFor = (
              fieldName: string,
            ):
              | HTMLInputElement
              | HTMLSelectElement
              | HTMLTextAreaElement
              | null => {
              const candidates: unknown[] = [];
              try {
                candidates.push(gForm.getControl?.(fieldName));
              } catch {
                // DOM fallback below.
              }
              const selectors = [
                `[name="${escapeCss(fieldName)}"]`,
                `[id="${escapeCss(fieldName)}"]`,
                `[name$=".${escapeCss(fieldName)}"]`,
                `[id$=".${escapeCss(fieldName)}"]`,
                `[name="sys_display.${escapeCss(fieldName)}"]`,
                `[id="sys_display.${escapeCss(fieldName)}"]`,
                `[name$=".${escapeCss(fieldName)}"][id^="sys_display."]`,
                `[id$=".${escapeCss(fieldName)}"][id^="sys_display."]`,
              ];
              for (const selector of selectors) {
                try {
                  candidates.push(document.querySelector(selector));
                } catch {
                  // Try the next selector.
                }
              }
              const controls = candidates.filter(
                (
                  candidate,
                ): candidate is
                  | HTMLInputElement
                  | HTMLSelectElement
                  | HTMLTextAreaElement =>
                  candidate instanceof HTMLInputElement ||
                  candidate instanceof HTMLSelectElement ||
                  candidate instanceof HTMLTextAreaElement,
              );
              return (
                controls.find(
                  (control) =>
                    !(
                      control instanceof HTMLInputElement &&
                      control.type === "hidden"
                    ),
                ) ??
                controls[0] ??
                null
              );
            };

            const fieldPathFor = (
              fieldName: string,
              control: Element | null,
            ) => {
              const raw =
                control?.getAttribute("name") ||
                control?.getAttribute("id") ||
                "";
              if (raw.startsWith("sys_display.")) {
                return raw.slice("sys_display.".length);
              }
              if (raw.endsWith(`.${fieldName}`)) return raw;
              return fieldName;
            };

            const labelFor = (fieldName: string, control: Element | null) => {
              const labels: string[] = [];
              try {
                const gLabel = gForm.getLabelOf?.(fieldName);
                if (gLabel) labels.push(String(gLabel));
              } catch {
                // Continue with DOM labels.
              }
              const id = control?.getAttribute("id") || "";
              if (id) {
                document
                  .querySelectorAll(`label[for="${escapeCss(id)}"]`)
                  .forEach((label) => labels.push(label.textContent || ""));
              }
              labels.push(
                control?.getAttribute("aria-label") || "",
                control?.getAttribute("title") || "",
                control?.getAttribute("placeholder") || "",
                control?.closest("label")?.textContent || "",
              );
              const clean = labels.map(display).find(Boolean);
              return clean || fieldName;
            };

            const commonReferenceTableForField = (fieldName: string) => {
              const refs: Record<string, string> = {
                assigned_to: "sys_user",
                caller_id: "sys_user",
                opened_by: "sys_user",
                resolved_by: "sys_user",
                assignment_group: "sys_user_group",
                rfc: "change_request",
                problem_id: "problem",
                parent_incident: "incident",
                business_service: "cmdb_ci_service",
                service_offering: "service_offering",
                cmdb_ci: "cmdb_ci",
                model_category: "cmdb_model_category",
                model: "cmdb_model",
                vendor: "core_company",
                depreciation: "cmdb_depreciation",
              };
              return refs[fieldName] || "";
            };

            const isReferenceLikeControl = (
              fieldName: string,
              control: Element | null,
            ) => {
              if (commonReferenceTableForField(fieldName)) return true;
              if (control instanceof HTMLTextAreaElement) return false;
              const raw = [
                control?.getAttribute("name"),
                control?.getAttribute("id"),
                control?.getAttribute("role"),
                control?.getAttribute("aria-autocomplete"),
                control?.getAttribute("autocomplete"),
                control?.getAttribute("class"),
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              if (raw.includes("sys_display.")) return true;
              if (/\b(reference|lookup|typeahead|autocomplete)\b/.test(raw)) {
                return true;
              }
              if (
                control instanceof HTMLInputElement &&
                control.type.toLowerCase() === "search" &&
                fieldName.endsWith("_id")
              ) {
                return true;
              }
              try {
                return Boolean(
                  document.getElementById(
                    `lookup.${fieldPathFor(fieldName, control)}`,
                  ),
                );
              } catch {
                return false;
              }
            };

            const referenceFor = (
              fieldName: string,
              control: Element | null,
            ) => {
              const commonReference = commonReferenceTableForField(fieldName);
              if (commonReference) return commonReference;
              if (!isReferenceLikeControl(fieldName, control)) return "";

              try {
                const uiElement =
                  gForm.getGlideUIElement?.(fieldName) ??
                  gForm.getControl?.(fieldName) ??
                  null;
                for (const prop of [
                  "reference",
                  "referenceTable",
                  "refTable",
                  "refName",
                  "tableName",
                ]) {
                  const propValue = uiElement?.[prop];
                  if (typeof propValue === "string" && propValue) {
                    return propValue;
                  }
                }
              } catch {
                // DOM fallback below.
              }
              const attr =
                control?.getAttribute("data-ref") ||
                control?.getAttribute("data-reference") ||
                control?.getAttribute("reference") ||
                "";
              return attr;
            };

            const fieldNames = new Set<string>();
            try {
              const names = gForm.getFieldNames?.();
              if (Array.isArray(names)) {
                names.forEach((name) => {
                  const normalized = normalizeFieldName(name);
                  if (normalized) fieldNames.add(normalized);
                });
              }
            } catch {
              // DOM field discovery below.
            }
            document
              .querySelectorAll(
                "input[name], select[name], textarea[name], input[id], select[id], textarea[id]",
              )
              .forEach((el) => {
                const raw =
                  el.getAttribute("name") || el.getAttribute("id") || "";
                const fieldName = normalizeFieldName(raw);
                if (
                  fieldName &&
                  !/^(sys_|ni_|label_|lookup_|sys_original)/i.test(fieldName)
                ) {
                  fieldNames.add(fieldName);
                }
              });

            const fieldsMeta: FieldMeta[] = [...fieldNames].map((name) => {
              const control = controlFor(name);
              const type =
                control instanceof HTMLSelectElement
                  ? "choice"
                  : control instanceof HTMLInputElement
                    ? control.type || "text"
                    : control instanceof HTMLTextAreaElement
                      ? "textarea"
                      : "";
              return {
                name,
                fieldPath: fieldPathFor(name, control),
                label: labelFor(name, control),
                type,
                reference: referenceFor(name, control),
                control,
              };
            });

            const matchField = (requested: string) => {
              const requestedKey = keyFor(requested);
              const exact = fieldsMeta.find(
                (field) =>
                  keyFor(field.label) === requestedKey ||
                  keyFor(field.name) === requestedKey,
              );
              if (exact) return exact;
              return (
                fieldsMeta.find((field) => {
                  const labelKey = keyFor(field.label);
                  const nameKey = keyFor(field.name);
                  return (
                    labelKey.includes(requestedKey) ||
                    requestedKey.includes(labelKey) ||
                    nameKey.includes(requestedKey) ||
                    requestedKey.includes(nameKey)
                  );
                }) ?? null
              );
            };

            const readNativeControlValue = (
              control:
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement
                | null,
              includeHidden = false,
            ): string | null => {
              if (control instanceof HTMLSelectElement) {
                return display(
                  control.selectedOptions[0]?.textContent || control.value,
                );
              }
              if (control instanceof HTMLInputElement) {
                if (control.type === "hidden" && !includeHidden) return null;
                if (control.type === "checkbox") {
                  return control.checked ? "true" : "false";
                }
                return display(control.value);
              }
              if (control instanceof HTMLTextAreaElement) {
                return display(control.value);
              }
              return null;
            };

            const readValue = (field: FieldMeta) => {
              const nativeValue = readNativeControlValue(field.control);
              if (nativeValue !== null) return nativeValue;

              try {
                const displayBox = gForm.getDisplayBox?.(field.name);
                const displayBoxValue =
                  displayBox && displayBox instanceof HTMLInputElement
                    ? display(displayBox.value)
                    : "";
                if (displayBoxValue) return displayBoxValue;
              } catch {
                // Fall through.
              }

              try {
                const value = gForm.getValue?.(field.name);
                if (value !== undefined && value !== null) {
                  const rendered = display(value);
                  if (rendered || !field.control) return rendered;
                }
              } catch {
                // Fall through.
              }

              return readNativeControlValue(field.control, true) ?? "";
            };

            const hiddenControlFor = (field: FieldMeta) => {
              const candidates: unknown[] = [
                document.getElementById(field.fieldPath),
                ...Array.from(document.getElementsByName(field.fieldPath)),
                document.getElementById(field.name),
                ...Array.from(document.getElementsByName(field.name)),
              ];
              for (const selector of [
                `[name$=".${escapeCss(field.name)}"]:not([name^="sys_display."])`,
                `[id$=".${escapeCss(field.name)}"]:not([id^="sys_display."])`,
              ]) {
                try {
                  candidates.push(
                    ...Array.from(document.querySelectorAll(selector)),
                  );
                } catch {
                  // Continue with direct candidates.
                }
              }
              return (
                candidates.find(
                  (candidate): candidate is HTMLInputElement =>
                    candidate instanceof HTMLInputElement &&
                    candidate !== field.control,
                ) ?? null
              );
            };

            const readCommittedReferenceValue = (field: FieldMeta) => {
              try {
                const value = gForm.getValue?.(field.name);
                if (typeof value === "string" && value.trim()) {
                  return value.trim();
                }
              } catch {
                // Fall through to hidden field lookup.
              }
              const hidden = hiddenControlFor(field);
              return hidden?.value?.trim() || "";
            };

            const isCommittedReferenceValue = (
              committed: string,
              displayValue: string,
              sysId?: string,
            ) => {
              if (!committed) return false;
              if (sysId) return normalize(committed) === normalize(sysId);
              return normalize(committed) !== normalize(displayValue);
            };

            const setNativeValue = (
              control:
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement
                | null,
              value: string,
            ) => {
              if (!control) return;
              if (
                control instanceof HTMLInputElement &&
                control.type === "checkbox"
              ) {
                control.checked = /^(true|yes|checked|1)$/i.test(value);
              } else {
                const descriptor =
                  Object.getOwnPropertyDescriptor(
                    Object.getPrototypeOf(control),
                    "value",
                  ) ||
                  Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    "value",
                  );
                if (descriptor?.set) descriptor.set.call(control, value);
                control.value = value;
              }
              control.dispatchEvent(new Event("input", { bubbles: true }));
              control.dispatchEvent(new Event("change", { bubbles: true }));
              control.dispatchEvent(new Event("blur", { bubbles: true }));
            };

            const delay = (ms: number) =>
              new Promise((resolve) => setTimeout(resolve, ms));
            const isVisibleControl = (control: Element | null): boolean => {
              if (!control?.isConnected) return false;
              const view = control.ownerDocument?.defaultView ?? window;
              let node: Element | null = control;
              while (node) {
                const style = view.getComputedStyle(node);
                if (
                  style.display === "none" ||
                  style.visibility === "hidden" ||
                  style.opacity === "0"
                ) {
                  return false;
                }
                node = node.parentElement;
              }
              const rect = control.getBoundingClientRect();
              return rect.width > 0 || rect.height > 0;
            };
            const revealFieldSection = async (field: FieldMeta) => {
              if (isVisibleControl(field.control)) return false;
              let sectionId = "";
              try {
                const element = gForm.getElement?.(field.name);
                const ancestors =
                  typeof element?.ancestors === "function"
                    ? element.ancestors()
                    : [];
                for (const ancestor of ancestors) {
                  const id = String(ancestor?.id || "");
                  if (id.startsWith("section-")) {
                    sectionId = id;
                    break;
                  }
                }
              } catch {
                // DOM fallback below.
              }
              if (!sectionId) {
                let node = field.control?.parentElement ?? null;
                while (node) {
                  if (node.id?.startsWith("section-")) {
                    sectionId = node.id;
                    break;
                  }
                  node = node.parentElement;
                }
              }
              const sectionName = sectionId.replace(/^section-/, "");
              if (!sectionName) return false;

              try {
                const tabs = (window as any).g_tabs2Sections;
                const tabIDs = Array.isArray(tabs?.tabIDs) ? tabs.tabIDs : [];
                const index = tabIDs.findIndex((value: unknown) => {
                  const raw = String(value || "");
                  const suffix = raw.split(".").pop() || raw;
                  return (
                    raw === sectionName ||
                    suffix === sectionName ||
                    keyFor(raw) === keyFor(sectionName) ||
                    keyFor(suffix) === keyFor(sectionName)
                  );
                });
                const tabElement = index >= 0 ? tabs?.tabsTabs?.[index]?.element : null;
                if (tabElement instanceof HTMLElement) {
                  tabElement.click();
                  await delay(100);
                  return true;
                }
              } catch {
                // DOM fallback below.
              }

              const sectionKey = keyFor(sectionName);
              const tab = Array.from(
                document.querySelectorAll(
                  '[role="tab"], [aria-controls], [id*="tab"], .tabs2_tab, .tab_caption',
                ),
              ).find((node): node is HTMLElement => {
                if (!(node instanceof HTMLElement)) return false;
                const identity = keyFor(
                  [
                    node.id,
                    node.textContent,
                    node.getAttribute("aria-controls"),
                    node.getAttribute("aria-label"),
                    node.getAttribute("title"),
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
                return Boolean(sectionKey && identity.includes(sectionKey));
              });
              if (tab) {
                tab.click();
                await delay(100);
                return true;
              }
              return false;
            };

            const commitReferenceValue = (
              field: FieldMeta,
              sysId: string,
              displayValue: string,
            ) => {
              if (!sysId) return false;
              let committed = false;
              try {
                gForm.setValue?.(field.name, sysId, displayValue);
                committed = true;
              } catch {
                // Hidden field fallback below covers frames without usable g_form.
              }

              const hidden = hiddenControlFor(field);
              if (hidden) {
                setNativeValue(hidden, sysId);
                hidden.setAttribute("value", sysId);
                committed = true;
              }

              setNativeValue(field.control, displayValue);
              if (field.control instanceof HTMLInputElement) {
                field.control.setAttribute("value", displayValue);
              }
              return committed;
            };

            const unwrap = (value: unknown): string => {
              if (typeof value === "string") return value;
              if (value && typeof value === "object") {
                const obj = value as Record<string, unknown>;
                if (typeof obj.value === "string") return obj.value;
                if (typeof obj.display_value === "string")
                  return obj.display_value;
              }
              return "";
            };

            const resolveReference = async (
              referenceTable: string,
              rawDisplayValue: string,
            ): Promise<{ sysId: string; displayValue: string } | null> => {
              const displayValue = rawDisplayValue.trim();
              if (!referenceTable || !displayValue) return null;
              const clean = displayValue.replace(/\^/g, "");
              const queryFields = [
                "name",
                "display_name",
                "number",
                "user_name",
                "email",
                "first_name",
                "last_name",
              ];
              const exactQuery = [
                "name",
                "display_name",
                "number",
                "user_name",
                "email",
              ]
                .map((field) => `${field}=${clean}`)
                .join("^OR");
              const fetchRecords = async (query: string) => {
                const params = new URLSearchParams({
                  sysparm_query: query,
                  sysparm_fields:
                    "sys_id,name,display_name,number,user_name,email,first_name,last_name",
                  sysparm_limit: "5",
                  sysparm_display_value: "all",
                });
                const headers: Record<string, string> = {
                  Accept: "application/json",
                };
                const token = String((window as any).g_ck || "");
                if (token) headers["X-UserToken"] = token;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 4_000);
                try {
                  const response = await fetch(
                    `/api/now/table/${encodeURIComponent(referenceTable)}?${params.toString()}`,
                    {
                      credentials: "same-origin",
                      headers,
                      signal: controller.signal,
                    },
                  );
                  if (!response.ok) return [];
                  const payload = await response.json();
                  return Array.isArray(payload?.result) ? payload.result : [];
                } catch {
                  return [];
                } finally {
                  clearTimeout(timer);
                }
              };
              let records = await fetchRecords(exactQuery);
              if (records.length === 0 && referenceTable === "sys_user") {
                const parts = clean.split(/\s+/).filter(Boolean);
                const firstName = parts[0] || "";
                const lastName = parts.slice(1).join(" ");
                if (firstName && lastName) {
                  records = await fetchRecords(
                    `first_name=${firstName}^last_name=${lastName}`,
                  );
                }
              }
              if (records.length === 0) {
                records = await fetchRecords(
                  ["name", "display_name", "user_name", "email"]
                    .map((field) => `${field}LIKE${clean}`)
                    .join("^OR"),
                );
              }
              const selected =
                records.find((record: Record<string, unknown>) => {
                  const exact = queryFields.some(
                    (field) =>
                      normalize(unwrap(record[field])) === normalize(clean),
                  );
                  const fullName =
                    `${unwrap(record.first_name)} ${unwrap(record.last_name)}`.trim();
                  return exact || normalize(fullName) === normalize(clean);
                }) ?? records[0];
              const sysId = unwrap(selected?.sys_id);
              const selectedDisplay =
                unwrap(selected?.name) ||
                unwrap(selected?.display_name) ||
                `${unwrap(selected?.first_name)} ${unwrap(selected?.last_name)}`.trim() ||
                displayValue;
              return sysId ? { sysId, displayValue: selectedDisplay } : null;
            };

            type FieldSetSuccess = {
              ok: true;
              acceptedDisplay?: string;
              acceptedSysId?: string;
            };
            type FieldSetResult =
              | FieldSetSuccess
              | { ok: false; reason: string };

            const selectReferenceAutocomplete = async (
              field: FieldMeta,
              rawDisplayValue: string,
            ): Promise<FieldSetResult> => {
              const input =
                field.control instanceof HTMLInputElement
                  ? field.control
                  : null;
              if (!input) return { ok: false, reason: "field_not_found" };
              const displayValue = rawDisplayValue.trim();
              if (!displayValue)
                return { ok: false, reason: "empty_display_value" };

              const delay = (ms: number) =>
                new Promise((resolve) => setTimeout(resolve, ms));
              const normalizedDisplay = normalize(displayValue);
              const view = input.ownerDocument?.defaultView ?? window;
              const setter = Object.getOwnPropertyDescriptor(
                view.HTMLInputElement.prototype,
                "value",
              )?.set;
              const setInputValue = (nextValue: string) => {
                if (setter) {
                  setter.call(input, nextValue);
                } else {
                  input.value = nextValue;
                }
              };
              const dispatchKeyboard = (
                type: string,
                key: string,
                init: KeyboardEventInit = {},
              ) => {
                const keyCode =
                  key === "Enter"
                    ? 13
                    : key === "Backspace"
                      ? 8
                      : key.length === 1
                        ? key.toUpperCase().charCodeAt(0)
                        : undefined;
                input.dispatchEvent(
                  new view.KeyboardEvent(type, {
                    key,
                    code: key === "Enter" ? "Enter" : undefined,
                    keyCode,
                    which: keyCode,
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    ...init,
                  }),
                );
              };
              const dispatchInput = (
                data: string | null,
                inputType: string,
              ) => {
                input.dispatchEvent(
                  new view.InputEvent("input", {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    data,
                    inputType,
                  }),
                );
              };
              const emitAutocompleteSearch = async (searchValue: string) => {
                input.focus();
                try {
                  input.setSelectionRange(0, input.value.length);
                } catch {
                  // Some specialized inputs do not support selection ranges.
                }
                dispatchKeyboard("keydown", "a", { ctrlKey: true });
                dispatchKeyboard("keyup", "a", { ctrlKey: true });
                dispatchKeyboard("keydown", "Backspace");
                setInputValue("");
                dispatchInput(null, "deleteContentBackward");
                dispatchKeyboard("keyup", "Backspace");
                for (const char of searchValue) {
                  dispatchKeyboard("keydown", char);
                  setInputValue(input.value + char);
                  dispatchInput(char, "insertText");
                  dispatchKeyboard("keyup", char);
                  await delay(15);
                }
                input.dispatchEvent(
                  new view.Event("change", { bubbles: true, composed: true }),
                );
                dispatchKeyboard("keydown", searchValue.slice(-1) || " ");
                dispatchKeyboard("keyup", searchValue.slice(-1) || " ");
              };
              const isVisible = (node: Element): boolean => {
                if (!node.isConnected) return false;
                const style = view.getComputedStyle(node);
                if (
                  style.display === "none" ||
                  style.visibility === "hidden" ||
                  style.opacity === "0"
                ) {
                  return false;
                }
                const rect = node.getBoundingClientRect();
                return (
                  rect.width > 0 ||
                  rect.height > 0 ||
                  !!node.textContent?.trim()
                );
              };
              const optionSelectors = [
                '[role="option"]',
                "tr[role='option']",
                ".ac_results tr",
                ".ac_results li",
                ".autocomplete tr",
                ".autocomplete li",
                ".typeahead tr",
                ".typeahead li",
                ".select2-results__option",
                ".ui-menu-item",
                "li.ui-menu-item",
                "[id^='AC.'] tr",
                "[id^='AC.'] li",
                "[aria-selected]",
              ];
              const optionMatches = (node: Element): boolean => {
                const text = normalize(node.textContent ?? "");
                if (!text) return false;
                if (text.includes(normalizedDisplay)) return true;
                const tokens = normalizedDisplay.split(" ").filter(Boolean);
                return (
                  tokens.length > 0 &&
                  tokens.every((token) => text.includes(token))
                );
              };
              const findMatchingOption = (): HTMLElement | null => {
                const seen = new Set<Element>();
                for (const optionSelector of optionSelectors) {
                  for (const node of Array.from(
                    document.querySelectorAll(optionSelector),
                  )) {
                    if (seen.has(node)) continue;
                    seen.add(node);
                    if (
                      node instanceof HTMLElement &&
                      isVisible(node) &&
                      optionMatches(node)
                    ) {
                      return node;
                    }
                  }
                }
                return null;
              };
              const extractSysId = (node: Element): string => {
                const attrs = [
                  "sys_id",
                  "sys-id",
                  "data-sys-id",
                  "data-sysid",
                  "data-value",
                  "data-id",
                  "value",
                ];
                for (const attr of attrs) {
                  const value = node.getAttribute(attr);
                  if (value && /^[0-9a-f]{32}$/i.test(value)) return value;
                }
                const htmlMatch = node.outerHTML.match(/[0-9a-f]{32}/i);
                return htmlMatch?.[0] ?? "";
              };
              const clickOption = (option: HTMLElement) => {
                option.scrollIntoView?.({ block: "center", inline: "center" });
                const rect = option.getBoundingClientRect();
                const clientX = rect.left + rect.width / 2;
                const clientY = rect.top + rect.height / 2;
                const mouseInit: MouseEventInit = {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  view,
                  clientX,
                  clientY,
                  button: 0,
                };
                const pointerInit: PointerEventInit = {
                  ...mouseInit,
                  pointerId: 1,
                  pointerType: "mouse",
                  isPrimary: true,
                };
                try {
                  option.dispatchEvent(
                    new view.PointerEvent("pointerdown", {
                      ...pointerInit,
                      buttons: 1,
                    }),
                  );
                } catch {
                  // PointerEvent may be unavailable in older page contexts.
                }
                option.dispatchEvent(
                  new view.MouseEvent("mousedown", {
                    ...mouseInit,
                    buttons: 1,
                  }),
                );
                try {
                  option.dispatchEvent(
                    new view.PointerEvent("pointerup", {
                      ...pointerInit,
                      buttons: 0,
                    }),
                  );
                } catch {
                  // PointerEvent may be unavailable in older page contexts.
                }
                option.dispatchEvent(new view.MouseEvent("mouseup", mouseInit));
                option.click();
              };

              if (
                isCommittedReferenceValue(
                  readCommittedReferenceValue(field),
                  displayValue,
                )
              ) {
                return { ok: true, acceptedDisplay: displayValue };
              }

              const rawTokens = displayValue.split(/\s+/).filter(Boolean);
              const searchValues = [
                displayValue,
                rawTokens[0],
                rawTokens[0]?.length > 3 ? rawTokens[0].slice(0, 3) : null,
              ].filter(
                (value, index, values): value is string =>
                  typeof value === "string" &&
                  value.trim().length > 0 &&
                  values.indexOf(value) === index,
              );

              for (const searchValue of searchValues) {
                for (let attempt = 0; attempt < 14; attempt++) {
                  if (attempt === 0 || attempt === 5) {
                    await emitAutocompleteSearch(searchValue);
                  }

                  const option = findMatchingOption();
                  if (option) {
                    const sysId = extractSysId(option);
                    if (
                      sysId &&
                      commitReferenceValue(field, sysId, displayValue)
                    ) {
                      await delay(100);
                      if (
                        isCommittedReferenceValue(
                          readCommittedReferenceValue(field),
                          displayValue,
                          sysId,
                        )
                      ) {
                        return {
                          ok: true,
                          acceptedDisplay: displayValue,
                          acceptedSysId: sysId,
                        };
                      }
                    }

                    clickOption(option);
                    for (let verify = 0; verify < 12; verify++) {
                      await delay(100);
                      if (
                        isCommittedReferenceValue(
                          readCommittedReferenceValue(field),
                          displayValue,
                        )
                      ) {
                        setNativeValue(field.control, displayValue);
                        return { ok: true, acceptedDisplay: displayValue };
                      }
                    }
                    return { ok: false, reason: "selection_unverified" };
                  }

                  await delay(100);
                }
              }

              dispatchKeyboard("keydown", "Enter");
              dispatchKeyboard("keyup", "Enter");
              for (let verify = 0; verify < 8; verify++) {
                await delay(100);
                if (
                  isCommittedReferenceValue(
                  readCommittedReferenceValue(field),
                  displayValue,
                )
              ) {
                setNativeValue(field.control, displayValue);
                return { ok: true, acceptedDisplay: displayValue };
              }
              }
              setInputValue(displayValue);
              input.dispatchEvent(
                new view.Event("change", { bubbles: true, composed: true }),
              );
              return { ok: false, reason: "no_matching_option" };
            };

            const setField = async (
              field: FieldMeta,
              value: string,
            ): Promise<FieldSetResult> => {
              await revealFieldSection(field);
              const desired = value;
              const choiceControl =
                field.control instanceof HTMLSelectElement
                  ? field.control
                  : null;
              if (choiceControl) {
                const option =
                  Array.from(choiceControl.options).find(
                    (candidate) =>
                      normalize(candidate.textContent) === normalize(desired) ||
                      normalize(candidate.value) === normalize(desired),
                  ) ??
                  Array.from(choiceControl.options).find((candidate) =>
                    normalize(candidate.textContent).includes(
                      normalize(desired),
                    ),
                  );
                const optionValue = option?.value ?? desired;
                try {
                  gForm.setValue?.(field.name, optionValue);
                } catch {
                  // DOM fallback below.
                }
                setNativeValue(choiceControl, optionValue);
                return { ok: true };
              }

              if (
                field.control instanceof HTMLInputElement &&
                field.control.type === "checkbox"
              ) {
                const boolValue = /^(true|yes|checked|1)$/i.test(desired);
                try {
                  gForm.setValue?.(field.name, boolValue ? "true" : "false");
                } catch {
                  // DOM fallback below.
                }
                setNativeValue(field.control, boolValue ? "true" : "false");
                return { ok: true };
              }

              const referenceTable = field.reference;
              if (referenceTable) {
                if (!desired.trim()) {
                  try {
                    gForm.setValue?.(field.name, "");
                  } catch {
                    // DOM fallback below.
                  }
                  const hidden = hiddenControlFor(field);
                  if (hidden) setNativeValue(hidden, "");
                  setNativeValue(field.control, "");
                  return { ok: true, acceptedDisplay: "" };
                }

                const resolved = await resolveReference(
                  referenceTable,
                  desired,
                );
                if (resolved) {
                  commitReferenceValue(
                    field,
                    resolved.sysId,
                    resolved.displayValue,
                  );
                  if (
                    isCommittedReferenceValue(
                      readCommittedReferenceValue(field),
                      resolved.displayValue,
                      resolved.sysId,
                    )
                  ) {
                    return {
                      ok: true,
                      acceptedDisplay: resolved.displayValue,
                      acceptedSysId: resolved.sysId,
                    };
                  }
                }

                const selected = await selectReferenceAutocomplete(
                  field,
                  desired,
                );
                if (selected.ok) {
                  const committed = readCommittedReferenceValue(field);
                  return selected.acceptedSysId ||
                    !/^[0-9a-f]{32}$/i.test(committed)
                    ? selected
                    : { ...selected, acceptedSysId: committed };
                }
                return {
                  ok: false,
                  reason: resolved
                    ? `reference sys_id not committed; autocomplete ${selected.reason}`
                    : `reference value not resolved; autocomplete ${selected.reason}`,
                };
              }

              if (field.control) {
                try {
                  gForm.setValue?.(field.name, desired);
                } catch {
                  // DOM fallback below.
                }
                setNativeValue(field.control, desired);
                return { ok: true };
              }

              try {
                gForm.setValue?.(field.name, desired);
              } catch {
                // DOM fallback below.
              }
              setNativeValue(field.control, desired);
              return { ok: true };
            };

            const configured: string[] = [];
            const configuredFields: ServiceNowSubmittedRecordField[] = [];
            let configuredRecordNumber = "";
            const mismatches: string[] = [];
            const recordNumberFromText = (value: string): string => {
              return value.match(/\b[A-Z]{2,}\d+\b/i)?.[0]?.toUpperCase() ?? "";
            };
            const isRecordNumberField = (
              field: Pick<FieldMeta, "label" | "name" | "fieldPath">,
              requestedField = "",
            ) => {
              const terminalFieldName = field.fieldPath.includes(".")
                ? field.fieldPath.slice(field.fieldPath.lastIndexOf(".") + 1)
                : field.fieldPath;
              return [
                field.label,
                field.name,
                terminalFieldName,
                requestedField,
              ].some((value) => keyFor(value) === "number");
            };
            for (const requested of input.fields) {
              const field = matchField(requested.field);
              if (!field) {
                mismatches.push(`${requested.field}: field not found`);
                continue;
              }
              const setResult = await setField(field, requested.value);
              const actual = readValue(field);
              const expected = display(requested.value);
              const acceptedDisplay =
                setResult.ok && setResult.acceptedDisplay
                  ? setResult.acceptedDisplay
                  : "";
              const acceptedSysId =
                setResult.ok && setResult.acceptedSysId
                  ? setResult.acceptedSysId
                  : "";
              const committedReferenceValue = acceptedSysId
                ? readCommittedReferenceValue(field)
                : "";
              const normalizedActual = normalize(actual);
              const normalizedExpected = normalize(expected);
              const actualTokenCount = normalizedActual
                .split(" ")
                .filter(Boolean).length;
              const isReferenceDisplayAlias = Boolean(
                field.reference &&
                  actualTokenCount >= 2 &&
                  normalizedExpected.endsWith(normalizedActual),
              );
              const ok =
                setResult.ok &&
                (expected === ""
                  ? actual === "" || /^--\s*none\s*--$/i.test(actual)
                  : normalizedActual === normalizedExpected ||
                    normalizedActual.includes(normalizedExpected) ||
                    isReferenceDisplayAlias ||
                    (acceptedDisplay
                      ? normalizedActual === normalize(acceptedDisplay) ||
                        normalizedActual.includes(normalize(acceptedDisplay))
                      : false) ||
                    (acceptedSysId
                      ? actual.trim().toLowerCase() ===
                          acceptedSysId.toLowerCase() ||
                        normalize(committedReferenceValue) ===
                          normalize(acceptedSysId)
                      : false));
              const row = `${field.label || field.name} (${field.name}) = ${actual || "(empty)"}`;
              if (ok) {
                configured.push(row);
                configuredFields.push({
                  name: field.name,
                  label: field.label || field.name,
                  value: actual || requested.value,
                });
                if (isRecordNumberField(field, requested.field)) {
                  configuredRecordNumber =
                    recordNumberFromText(actual) ||
                    recordNumberFromText(requested.value) ||
                    configuredRecordNumber;
                }
              } else {
                const reason = setResult.ok ? "" : `; ${setResult.reason}`;
                mismatches.push(
                  `${row}; expected ${expected || "(empty)"}${reason}`,
                );
              }
            }
            const currentRecordNumber =
              configuredRecordNumber ||
              (() => {
                const numberField = fieldsMeta.find((field) =>
                  isRecordNumberField(field),
                );
                return numberField
                  ? recordNumberFromText(readValue(numberField))
                  : "";
              })();

            const recordFromTitle =
              document.title.match(/\bCreate\s+([A-Z]{2,}\d+)\b/i)?.[1] ||
              document.body?.innerText?.match(
                /\b(?:Number|Record)\s+([A-Z]{2,}\d+)\b/i,
              )?.[1] ||
              null;
            const tableName = (() => {
              try {
                const table = gForm.getTableName?.();
                if (table) return String(table);
              } catch {
                // Fall back to field paths below.
              }
              const fieldPath = fieldsMeta.find((field) =>
                field.fieldPath.includes("."),
              )?.fieldPath;
              return fieldPath ? fieldPath.split(".")[0] : "";
            })();

            let submitClicked = false;
            let submitLabel = "";
            let submitMethod = "";
            let submitActionName = "";
            let submittedSysId = "";
            const currentSysId = () => {
              try {
                const sysId = String(gForm.getUniqueValue?.() || "");
                if (/^[0-9a-f]{32}$/i.test(sysId)) return sysId;
              } catch {
                // Fall back to form controls below.
              }
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
                if (/^[0-9a-f]{32}$/i.test(value)) return value;
              }
              return "";
            };
            if (input.submit && mismatches.length === 0) {
              submittedSysId = currentSysId();
              const expected = input.submitButton
                ? normalize(input.submitButton)
                : "";
              const isUsableSubmitControl = (control: HTMLElement) => {
                const style = getComputedStyle(control);
                const disabled =
                  "disabled" in control &&
                  Boolean(
                    (control as HTMLButtonElement | HTMLInputElement).disabled,
                  );
                return (
                  !disabled &&
                  style.display !== "none" &&
                  style.visibility !== "hidden"
                );
              };
              const submitTextFor = (control: HTMLElement) =>
                normalize(
                  [
                    control.textContent,
                    control.getAttribute("value"),
                    control.getAttribute("aria-label"),
                    control.getAttribute("title"),
                    control.getAttribute("id"),
                    control.getAttribute("name"),
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
              const actionNameFor = (control: HTMLElement) => {
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
              const triggerSubmit = (control: HTMLElement) => {
                const actionName = actionNameFor(control);
                const formElement =
                  gForm.getFormElement?.() ||
                  control.closest("form") ||
                  document.querySelector("form");
                try {
                  control.click();
                  return { ok: true, method: "click", actionName };
                } catch {
                  // Fall back to ServiceNow submit APIs below.
                }
                if (
                  actionName &&
                  typeof (window as any).gsftSubmit === "function" &&
                  formElement
                ) {
                  try {
                    (window as any).gsftSubmit(null, formElement, actionName);
                    return { ok: true, method: "gsftSubmit", actionName };
                  } catch {
                    // Fall back to DOM click below.
                  }
                }
                if (actionName && typeof gForm.submit === "function") {
                  try {
                    gForm.submit(actionName);
                    return { ok: true, method: "g_form.submit", actionName };
                  } catch {
                    // Fall back to DOM click below.
                  }
                }
                control.click();
                return { ok: true, method: "click", actionName };
              };
              const controls = Array.from(
                document.querySelectorAll(
                  "button, input[type='submit'], input[type='button'], [role='button']",
                ),
              ) as HTMLElement[];
              const submitControl =
                controls.find((control) => {
                  if (!isUsableSubmitControl(control)) return false;
                  const text = submitTextFor(control);
                  if (!text) return false;
                  if (expected) return text.includes(expected);
                  return /\b(submit|save|update|insert)\b/i.test(text);
                }) ??
                controls.find((control) => {
                  if (!isUsableSubmitControl(control)) return false;
                  return Boolean(actionNameFor(control));
                }) ??
                null;
              if (submitControl) {
                submitLabel = display(
                  submitControl.textContent ||
                    submitControl.getAttribute("value") ||
                    submitControl.getAttribute("aria-label") ||
                    submitControl.getAttribute("id") ||
                    "submit",
                );
                const submitResult = triggerSubmit(submitControl);
                submitClicked = true;
                submitMethod = submitResult.method;
                submitActionName = submitResult.actionName;
              } else {
                mismatches.push("submit control not found");
              }
            }

            return {
              matched: true,
              ok: mismatches.length === 0 && (!input.submit || submitClicked),
              url: location.href,
              title: document.title,
              configured,
              configuredFields,
              mismatches,
              submitClicked,
              submitLabel,
              submitMethod,
              submitActionName,
              submittedRecord: submitClicked
                ? currentRecordNumber || recordFromTitle
                : null,
              submittedSysId: submitClicked ? submittedSysId : null,
              tableName,
              fieldCount: fieldsMeta.length,
            };
            },
            args: [{ fields, submit, submitButton }],
          }),
          CONFIGURE_SERVICENOW_FORM_SCRIPT_TIMEOUT_MS,
          "configure_servicenow_form script",
        );

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter((result): result is Record<string, unknown> =>
            Boolean(result),
          );
        const selected =
          plans.find((plan) => plan.ok === true) ||
          plans.find((plan) => plan.matched === true);
        if (!selected) {
          return "Error: Could not find a ServiceNow record form on the current page.";
        }

        if (selected.submitClicked === true) {
          await waitForNavigation(tabId, 12_000);
          await waitForDomReady(tabId, {
            timeoutMs: 2_000,
            waitForElements: true,
          });
        }

        let tab = await chrome.tabs.get(tabId);
        const configured = Array.isArray(selected.configured)
          ? selected.configured.map(String)
          : [];
        const configuredFields = Array.isArray(selected.configuredFields)
          ? selected.configuredFields
              .filter(
                (field): field is Record<string, unknown> =>
                  field !== null && typeof field === "object",
              )
              .map((field) => ({
                name: String(field.name || ""),
                label: String(field.label || ""),
                value: String(field.value || ""),
              }))
          : [];
        const mismatches = Array.isArray(selected.mismatches)
          ? selected.mismatches.map(String)
          : [];
        const submittedRecord =
          typeof selected.submittedRecord === "string"
            ? selected.submittedRecord
            : "";
        const submittedSysId =
          typeof selected.submittedSysId === "string" &&
          /^[0-9a-f]{32}$/i.test(selected.submittedSysId)
            ? selected.submittedSysId.toLowerCase()
            : "";
        const tableName =
          typeof selected.tableName === "string" ? selected.tableName : "";
        let currentUrl = tab.url || String(selected.url || "");
        let currentTitle = tab.title || String(selected.title || "");
        const escapeRegExp = (value: string) =>
          value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const computeSubmitStayedOnSameCreateRecord = () =>
          Boolean(
            submit &&
              submittedRecord &&
              new RegExp(
                `\\b(?:Create|New)\\s+${escapeRegExp(submittedRecord)}\\b`,
                "i",
              ).test(currentTitle),
          );
        const isLikelySameUncommittedForm = () => {
          if (!submit || selected.submitClicked !== true) return false;
          const selectedUrl = String(selected.url || "");
          const selectedTitle = String(selected.title || "");
          const currentUrlLower = currentUrl.toLowerCase();
          const selectedUrlLower = selectedUrl.toLowerCase();
          const sameLocation =
            Boolean(selectedUrl && currentUrl === selectedUrl) ||
            Boolean(
              tableName &&
                currentUrlLower.includes(`${tableName.toLowerCase()}.do`) &&
                selectedUrlLower.includes(`${tableName.toLowerCase()}.do`),
            );
          const titleLooksUncommitted =
            /\bnew record\b/i.test(currentTitle) ||
            /\bcreate\b/i.test(currentTitle) ||
            /\bnew record\b/i.test(selectedTitle);
          return sameLocation && titleLooksUncommitted;
        };
        let submitStayedOnSameCreateRecord =
          computeSubmitStayedOnSameCreateRecord();
        let resolvedSubmittedSysId = submittedSysId;
        let fallbackSubmitMethod = "";
        let fallbackSubmitActionName = "";
        let fallbackSubmittedSysId = "";
        const configuredFieldsContainIdentity =
          hasServiceNowIdentityFields(configuredFields);
        const verifySubmittedSysId = async (
          options: {
            quickIdentityLookup?: boolean;
            allowSubmittedSysIdLookup?: boolean;
          } = {},
        ) => {
          if (
            !submit ||
            selected.submitClicked !== true ||
            submittedRecord ||
            !tableName
          ) {
            return false;
          }
          if (configuredFieldsContainIdentity) {
            const sysIdFromFields =
              await resolveServiceNowRecordSysIdByFields(
                tabId,
                tableName,
                configuredFields,
                options.quickIdentityLookup
                  ? { attempts: 2, delayMs: 250, timeoutMs: 2_000 }
                  : undefined,
              );
            if (sysIdFromFields) {
              resolvedSubmittedSysId = sysIdFromFields;
              return true;
            }
          }
          const candidateSysId = fallbackSubmittedSysId || submittedSysId;
          if (options.allowSubmittedSysIdLookup !== false && candidateSysId) {
            const exists = await serviceNowRecordExistsBySysId(
              tabId,
              tableName,
              candidateSysId,
            );
            if (exists) {
              resolvedSubmittedSysId = candidateSysId;
              return true;
            }
          }
          return false;
        };
        let submittedSysIdVerified = await verifySubmittedSysId({
          quickIdentityLookup: isLikelySameUncommittedForm(),
          allowSubmittedSysIdLookup:
            !configuredFieldsContainIdentity || !isLikelySameUncommittedForm(),
        });
        const submitHasTrustedIdentity =
          !submit || Boolean(submittedRecord) || submittedSysIdVerified;
        let submitVerified =
          !submit ||
          (selected.submitClicked === true &&
            !submitStayedOnSameCreateRecord &&
            submitHasTrustedIdentity);
        let submitDiagnostics =
          submit &&
          selected.submitClicked === true &&
          !submitVerified &&
          isLikelySameUncommittedForm()
            ? await collectServiceNowSubmitDiagnostics(tabId)
            : [];
        if (
          submit &&
          selected.submitClicked === true &&
          !submitVerified &&
          isLikelySameUncommittedForm() &&
          submitDiagnostics.length === 0
        ) {
          const fallback = await retryServiceNowNativeSubmit(
            tabId,
            scriptTarget,
            String(selected.submitActionName || ""),
          );
          if (fallback?.ok === true) {
            fallbackSubmitMethod = fallback.method || "";
            fallbackSubmitActionName = fallback.actionName || "";
            fallbackSubmittedSysId =
              typeof fallback.submittedSysId === "string" &&
              /^[0-9a-f]{32}$/i.test(fallback.submittedSysId)
                ? fallback.submittedSysId.toLowerCase()
                : "";
            if (fallbackSubmittedSysId && !resolvedSubmittedSysId) {
              resolvedSubmittedSysId = fallbackSubmittedSysId;
            }
            await waitForNavigation(tabId, 12_000);
            await waitForDomReady(tabId, {
              timeoutMs: 2_000,
              waitForElements: true,
            });
            tab = await chrome.tabs.get(tabId);
            currentUrl = tab.url || currentUrl;
            currentTitle = tab.title || currentTitle;
            submitStayedOnSameCreateRecord =
              computeSubmitStayedOnSameCreateRecord();
            submittedSysIdVerified = await verifySubmittedSysId();
            submitVerified =
              selected.submitClicked === true &&
              !submitStayedOnSameCreateRecord &&
              (!submit || Boolean(submittedRecord) || submittedSysIdVerified);
          } else if (fallback?.reason) {
            submitDiagnostics = [
              ...submitDiagnostics,
              `ServiceNow submit fallback unavailable: ${fallback.reason}`,
            ];
          }
        }
        const effectiveMismatches = [...mismatches];
        if (
          submit &&
          selected.submitClicked === true &&
          submitStayedOnSameCreateRecord
        ) {
          effectiveMismatches.push(
            `submit did not leave the create form for ${submittedRecord}`,
          );
        }
        if (
          submit &&
          selected.submitClicked === true &&
          !submittedRecord &&
          submittedSysId &&
          !submittedSysIdVerified
        ) {
          effectiveMismatches.push(
            `submitted record sys_id ${submittedSysId} was not found in ServiceNow`,
          );
        } else if (
          submit &&
          selected.submitClicked === true &&
          !submittedRecord &&
          !submittedSysId
        ) {
          effectiveMismatches.push(
            "submit did not expose a submitted record identity",
          );
        }
        const effectiveOk = selected.ok === true && submitVerified;
        if (
          submit &&
          selected.submitClicked === true &&
          !submitVerified &&
          submitDiagnostics.length === 0
        ) {
          submitDiagnostics = await collectServiceNowSubmitDiagnostics(tabId);
        }
        let openedSubmittedRecordUrl = "";
        if (effectiveOk && submit && submittedRecord) {
          const resetToNextCreateRecord =
            /\bCreate\s+[A-Z]{2,}\d+\b/i.test(currentTitle) &&
            !new RegExp(`\\bCreate\\s+${submittedRecord}\\b`, "i").test(
              currentTitle,
            );
          const onSubmittedRecordPage =
            new RegExp(`\\b${submittedRecord}\\b`, "i").test(currentTitle) &&
            !new RegExp(`\\bCreate\\s+${submittedRecord}\\b`, "i").test(
              currentTitle,
            );
          if (!resetToNextCreateRecord && !onSubmittedRecordPage) {
            const recordUrl = await resolveServiceNowRecordUrl(
              tabId,
              tableName,
              submittedRecord,
            );
            if (recordUrl) {
              await chrome.tabs.update(tabId, { url: recordUrl });
              await waitForNavigation(tabId, 12_000);
              await waitForDomReady(tabId, {
                timeoutMs: 2_000,
                waitForElements: true,
              });
              tab = await chrome.tabs.get(tabId);
              openedSubmittedRecordUrl = recordUrl;
            }
          }
        } else if (
          effectiveOk &&
          submit &&
          !submittedRecord &&
          submittedSysIdVerified &&
          resolvedSubmittedSysId &&
          tableName
        ) {
          const recordUrl = serviceNowRecordUrlForSysId(
            currentUrl || String(selected.url || ""),
            tableName,
            resolvedSubmittedSysId,
          );
          if (
            recordUrl &&
            !new RegExp(`\\bsys_id=${escapeRegExp(resolvedSubmittedSysId)}\\b`, "i").test(
              currentUrl,
            )
          ) {
            await chrome.tabs.update(tabId, { url: recordUrl });
            await waitForNavigation(tabId, 12_000);
            await waitForDomReady(tabId, {
              timeoutMs: 2_000,
              waitForElements: true,
            });
            tab = await chrome.tabs.get(tabId);
            currentUrl = tab.url || recordUrl;
            currentTitle = tab.title || currentTitle;
            openedSubmittedRecordUrl = recordUrl;
          }
        }
        const lines = [
          effectiveOk
            ? "Configured ServiceNow form."
            : "ServiceNow form configuration incomplete.",
          configured.length ? `Configured:\n- ${configured.join("\n- ")}` : "",
          effectiveMismatches.length
            ? `Mismatches:\n- ${effectiveMismatches.join("\n- ")}`
            : "",
          submitDiagnostics.length
            ? `Submit diagnostics:\n- ${submitDiagnostics.join("\n- ")}`
            : "",
          selected.submitClicked
            ? `Clicked submit control: ${String(selected.submitLabel || "submit")}`
            : "",
          selected.submitMethod
            ? `Submit method: ${String(selected.submitMethod)}${selected.submitActionName ? ` (${String(selected.submitActionName)})` : ""}`
            : "",
          fallbackSubmitMethod
            ? `Fallback submit method: ${fallbackSubmitMethod}${fallbackSubmitActionName ? ` (${fallbackSubmitActionName})` : ""}`
            : "",
          submittedRecord && submitVerified
            ? `Submitted ServiceNow form record: ${submittedRecord}`
            : "",
          resolvedSubmittedSysId && submittedSysIdVerified
            ? `Submitted ServiceNow form sys_id: ${resolvedSubmittedSysId}`
            : "",
          openedSubmittedRecordUrl
            ? `Opened submitted ServiceNow record: ${openedSubmittedRecordUrl}`
            : "",
          `ServiceNow form fields discovered: ${String(selected.fieldCount ?? 0)}`,
          `Current URL: ${tab.url || currentUrl}`,
          `Current title: ${tab.title || currentTitle}`,
        ];
        const observedAt = new Date().toISOString();
        const evidence: EvidenceEvent[] = [];
        if (fields.length > 0) {
          evidence.push({
            type: "fill_attempted",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: effectiveMismatches.length === 0 ? "high" : "medium",
            observedAt,
            supportsTaskGoal: effectiveMismatches.length === 0,
            detail: { fields: fields.map((field) => field.field) },
          });
        }
        for (const configuredLine of configured) {
          evidence.push({
            type: "field_value_observed",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt,
            supportsTaskGoal: true,
            detail: { value: configuredLine },
          });
        }
        if (submit) {
          evidence.push({
            type: "submit_attempted",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: selected.submitClicked ? "high" : "medium",
            observedAt,
            supportsTaskGoal: selected.submitClicked === true,
            detail: {
              submitLabel: String(
                selected.submitLabel || submitButton || "submit",
              ),
              submitMethod: fallbackSubmitMethod
                ? `${String(selected.submitMethod || "")}+${fallbackSubmitMethod}`
                : String(selected.submitMethod || ""),
            },
          });
        }
        if (submit && submitStayedOnSameCreateRecord) {
          evidence.push({
            type: "uncertainty_detected",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt,
            supportsTaskGoal: false,
            detail: {
              reason: "same_create_form_after_submit",
              submittedRecord,
            },
          });
        }
        if (submit && submitDiagnostics.length > 0) {
          evidence.push({
            type: "uncertainty_detected",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt,
            supportsTaskGoal: false,
            detail: {
              reason: "servicenow_submit_diagnostics",
              diagnostics: submitDiagnostics,
            },
          });
        }
        if (
          effectiveOk &&
          submit &&
          (submittedRecord || submittedSysIdVerified)
        ) {
          const identity = {
            table: tableName,
            recordNumber: submittedRecord || undefined,
            sysId: submittedSysIdVerified
              ? resolvedSubmittedSysId
              : undefined,
            url: openedSubmittedRecordUrl || tab.url || currentUrl,
          };
          evidence.push(
            {
              type: "submit_succeeded",
              source: ToolName.CONFIGURE_SERVICENOW_FORM,
              confidence: "high",
              observedAt,
              supportsTaskGoal: true,
              detail: identity,
            },
            {
              type: "record_identity_observed",
              source: ToolName.CONFIGURE_SERVICENOW_FORM,
              confidence: "high",
              observedAt,
              supportsTaskGoal: true,
              detail: identity,
            },
          );
        }
        return { result: lines.filter(Boolean).join("\n"), evidence };
      } catch (e: any) {
        return `Error configuring ServiceNow form: ${e.message}`;
      }
    },
  );

  // Page Assist Tools (xray_page)
  toolRegistry.register(
    ToolName.XRAY_PAGE,
    XRAY_PAGE_DEF,
    async (_args, tabId) => {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN" as any,
        func: () => {
          const existing = document.querySelector("style[data-osb-xray]");
          if (existing) {
            existing.remove();
            return "X-ray disabled. Hidden elements are hidden again.";
          }
          const s = document.createElement("style");
          s.setAttribute("data-osb-xray", "true");
          s.textContent = `
            * { visibility: visible !important; opacity: 1 !important; }
            [hidden], .hidden, [aria-hidden="true"] { display: block !important; }
          `;
          document.head.appendChild(s);
          return "X-ray enabled. All hidden elements are now visible. Call read_page to see them.";
        },
      });
      return results?.[0]?.result ?? "X-ray toggled.";
    },
  );

  // Working notes tool (intercepted by agent loop before executor runs)
  toolRegistry.register(
    ToolName.UPDATE_NOTES,
    UPDATE_NOTES_DEF,
    async (_args) => {
      // This executor is a fallback — the loop intercepts update_notes before reaching here
      return "Note saved.";
    },
  );

  toolRegistry.register(
    ToolName.GET_PROFILE_FIELDS,
    GET_PROFILE_FIELDS_DEF,
    async (args) => {
      const fields = Array.isArray(args.fields)
        ? args.fields
            .filter((field): field is string => typeof field === "string")
            .map((field) => field.trim())
            .filter(Boolean)
        : [];

      if (fields.length === 0) {
        return "Error: provide at least one profile field path.";
      }

      const result = await resolveProfileFields(fields);
      if (!result) {
        return "Error: Could not read local profile fields. Ensure the backend is running and the profile file exists.";
      }

      const lines = ["PROFILE FIELDS:"];
      for (const [field, value] of Object.entries(result.values)) {
        const rendered =
          value === null
            ? "null"
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value);
        lines.push(`- ${field}: ${rendered}`);
      }

      if (result.missing.length > 0) {
        lines.push("", `Missing: ${result.missing.join(", ")}`);
      }

      return lines.join("\n");
    },
  );

  // Create window tool (intercepted by orchestrator before executor runs)
  toolRegistry.register(
    ToolName.CREATE_WINDOW,
    CREATE_WINDOW_DEF,
    async (args) => {
      // Fallback — normally intercepted by orchestrator
      const url = args.url as string | undefined;
      logger.info("tools", "create_window", { url });
      try {
        const win = await chrome.windows.create(url ? { url } : {});
        return `Created new window (ID: ${win.id})`;
      } catch (e: any) {
        return `Error creating window: ${e.message}`;
      }
    },
  );

  // Update plan tool (intercepted by agent loop before executor runs)
  toolRegistry.register(ToolName.UPDATE_PLAN, UPDATE_PLAN_DEF, async (args) => {
    // Fallback — the loop intercepts update_plan before reaching here
    return `Plan updated: ${(args.summary as string) || "no summary"}`;
  });

  logger.info(
    "tools",
    `${toolRegistry.getDefinitions().length} tools registered`,
  );
}
