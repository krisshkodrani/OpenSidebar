import { toolRegistry } from "./registry";
import { ToolName, MessageSource, UserSettings } from "../../types";
import { logger } from "../../utils";
import { sanitizeUrl } from "../security";
import {
  resolveProfileFields,
  resolveProfileFile,
} from "../infrastructure/backend-client";
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

async function tryInPageHistoryBack(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as any,
    func: () => {
      window.history.back();
    },
  });
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
  };
  return commonReferences[key] ?? commonReferences[compactKey] ?? null;
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
          if (
            !resolved.ok &&
            (resolved.reason === "lookup_http_401" ||
              resolved.reason === "lookup_failed" ||
              resolved.reason === "lookup_timeout")
          ) {
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
          if (!resolved.ok && resolved.reason === "lookup_http_401") {
            const pageResolved = await resolveServiceNowReferenceFromPage(
              tabId,
              args,
              serviceNowCandidate,
              args.text,
            );
            resolved = pageResolved;
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
    if (tabs.length === 0) return "No open tabs.";
    const lines = tabs.map(
      (t: chrome.tabs.Tab) =>
        `Tab ${t.id}: "${t.title || "(untitled)"}" — ${t.url || "about:blank"}${t.active ? " [active]" : ""}`,
    );
    return lines.join("\n");
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
              const hasListSurface =
                Boolean(listApi) ||
                Boolean(
                  document.querySelector(
                    "table.data_list_table, [data-list_id], th[name], [id$='_table']",
                  ),
                );
              if (!hasListSurface) {
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
                addField("state", "State", "choice", "");
                addField("assigned_to", "Assigned to", "reference", "sys_user");
              }

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
                    keyFor(field.label) === normalized ||
                    keyFor(field.label).includes(normalized) ||
                    normalized.includes(keyFor(field.label))
                  ) {
                    return true;
                  }
                }
                return false;
              };

              if (
                !payload.conditions.every((condition) =>
                  hasKnownField(condition.field),
                )
              ) {
                const dictRecords = await fetchJson(
                  "/api/now/table/sys_dictionary",
                  {
                    sysparm_query: `name=${tableName}^internal_type!=collection`,
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
                const direct = byKey.get(normalized);
                if (direct) return direct;
                const snake = normalize(requestedField).replace(
                  /[^a-z0-9]+/g,
                  "_",
                );
                if (fields.has(snake)) return fields.get(snake) || null;
                if (fields.has(`${snake}_id`))
                  return fields.get(`${snake}_id`) || null;
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

              const resolveChoiceValue = async (
                field: FieldMeta,
                displayValue: string,
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
                };
                const fallback =
                  tableName === "incident"
                    ? incidentChoiceFallbacks[field.name]?.[
                        keyFor(displayValue)
                      ]
                    : undefined;
                if (fallback) return fallback;

                const choices = await fetchJson("/api/now/table/sys_choice", {
                  sysparm_query: `name=${tableName}^element=${field.name}`,
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
                return choice ? unwrap(choice.value) : displayValue;
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
                const safe = cleanQueryValue(displayValue);
                const queryFields = [
                  "name",
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
                      "sys_id,name,display_name,number,user_name,email,first_name,last_name",
                    sysparm_limit: "5",
                    sysparm_display_value: "all",
                  });
                const exactQuery = [
                  "name",
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
                    ["name", "display_name", "user_name", "email"]
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
                    await resolveChoiceValue(field, displayValue),
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
          12_000,
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
              if (!hasListSurface) {
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
                    sysparm_query: `name=${tableName}^internal_type!=collection`,
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
                const direct = byKey.get(normalized);
                if (direct) return direct;
                const snake = normalize(requestedField).replace(
                  /[^a-z0-9]+/g,
                  "_",
                );
                if (fields.has(snake)) return fields.get(snake) || null;
                if (fields.has(`${snake}_id`))
                  return fields.get(`${snake}_id`) || null;
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
          const priceText = norm(document.body?.innerText || "")
            .match(
              /(?:[$€£]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP)|annually|monthly|total|price)/gi,
            )
            ?.slice(0, 20)
            .join(" | ");
          if (priceText) lines.push(`Price/summary cues: ${priceText}`);

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

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: "MAIN" as any,
          func: (input: {
            quantity: string | null;
            textFields: Array<{ field: string; value: string }>;
            checkboxes: Array<{ label: string; checked: boolean }>;
            submit: boolean;
            submitButton: string | null;
          }) => {
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
            const labelsFor = (el: Element): string[] => {
              const control = el as
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement;
              const labels = [
                el.getAttribute("aria-label"),
                el.getAttribute("title"),
                el.getAttribute("placeholder"),
                el.getAttribute("name"),
                el.getAttribute("id"),
                el.getAttribute("control"),
                control.value,
                el.textContent,
              ];
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
              return labels.map(display).filter(Boolean);
            };
            const matches = (labels: string[], expected: string) => {
              const needle = norm(expected);
              return labels.some((label) => {
                const haystack = norm(label);
                return haystack === needle || haystack.includes(needle);
              });
            };
            const setNativeValue = (
              el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
              value: string,
            ) => {
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
            const findQuantity = () => {
              const controls = [
                ...document.querySelectorAll("select, input"),
              ] as Array<HTMLInputElement | HTMLSelectElement>;
              return (
                controls.find((el) => matches(labelsFor(el), "quantity")) ||
                controls.find((el) =>
                  /quantity|qty/i.test(`${el.id} ${el.name}`),
                )
              );
            };
            const findTextControl = (field: string) => {
              const controls = [
                ...document.querySelectorAll(
                  "textarea, input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit'])",
                ),
              ] as Array<HTMLInputElement | HTMLTextAreaElement>;
              return controls.find((el) => matches(labelsFor(el), field));
            };
            const findCheckbox = (label: string) => {
              const controls = [
                ...document.querySelectorAll(
                  "input[type='checkbox'], [role='checkbox'], label[type='checkbox'], label[control]",
                ),
              ];
              return controls.find((el) => matches(labelsFor(el), label));
            };
            const findSubmitControl = () => {
              const controls = [
                ...document.querySelectorAll(
                  "button, input[type='button'], input[type='submit'], a, [role='button']",
                ),
              ].filter(visible);
              if (input.submitButton) {
                const exact = controls.find((el) =>
                  matches(labelsFor(el), input.submitButton as string),
                );
                if (exact) return exact as HTMLElement;
              }
              return controls.find((el) =>
                labelsFor(el).some((label) =>
                  /\b(order now|place order|submit order|request|checkout|add to cart|order)\b/i.test(
                    label,
                  ),
                ),
              ) as HTMLElement | undefined;
            };

            const configured: string[] = [];
            const mismatches: string[] = [];
            const pageLooksCatalog =
              /catalog|cat_item|service catalog|order now|request/i.test(
                `${location.href} ${document.title} ${document.body?.innerText || ""}`,
              );

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
                  configured.push(
                    `Quantity=${option.textContent?.trim() || option.value}`,
                  );
                }
              } else {
                setNativeValue(quantity, input.quantity);
                configured.push(`Quantity=${input.quantity}`);
              }
            }

            for (const field of input.textFields) {
              const control = findTextControl(field.field);
              if (!control) {
                mismatches.push(`Text field not found: ${field.field}.`);
                continue;
              }
              setNativeValue(control, field.value);
              configured.push(`${field.field}="${field.value}"`);
            }

            for (const checkbox of input.checkboxes) {
              const control = findCheckbox(checkbox.label);
              if (!control) {
                mismatches.push(`Checkbox not found: ${checkbox.label}.`);
                continue;
              }
              const before = checkboxState(control);
              if (
                before !== checkbox.checked &&
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
                setNativeChecked(inputEl, checkbox.checked);
              }
              const after = checkboxState(control);
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

            const submitControl =
              mismatches.length === 0 && input.submit
                ? findSubmitControl()
                : null;
            let submitClicked = false;
            let submitLabel: string | null = null;
            if (input.submit && mismatches.length === 0) {
              if (!submitControl) {
                mismatches.push("Submit/order control not found.");
              } else {
                submitLabel =
                  labelsFor(submitControl)[0] ||
                  submitControl.textContent ||
                  "submit";
                submitControl.click();
                submitClicked = true;
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
              submitClicked,
              submitLabel,
            };
          },
          args: [
            {
              quantity,
              textFields,
              checkboxes,
              submit,
              submitButton,
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
          selected.submitClicked
            ? `Clicked submit control: ${String(selected.submitLabel || "submit")}`
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
