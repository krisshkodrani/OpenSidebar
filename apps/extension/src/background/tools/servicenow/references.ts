/**
 * ServiceNow adapter — reference-field resolution and autocomplete.
 *
 * Grounded in stable platform semantics: reference fields resolve a
 * display value to a sys_id (via table lookup from the background or
 * the page) and commit it into the form's main-world model, falling
 * back to driving the native autocomplete. The
 * `servicenow_reference_candidate:` marker is a wire format shared
 * with the injected input-mirroring function in tools/index.ts — the
 * two must stay in sync.
 *
 * Import-direction rule: servicenow/* must never import "../index" or
 * the "../tools" barrel — only ../helpers and concrete siblings.
 */

import { getFrameIdsForMainWorldBridge } from "../helpers";
import {
  unwrapServiceNowFieldValue,
  normalizeServiceNowReferenceKey,
} from "./common";

export const SERVICENOW_REFERENCE_CANDIDATE_PREFIX = "servicenow_reference_candidate:";

export type ServiceNowReferenceCandidate = {
  fieldPath: string;
  fieldName: string;
  referenceTable: string;
};

export function parseServiceNowReferenceCandidate(
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

export function inferServiceNowListTableFromUrl(rawUrl: string | undefined): string {
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

export function commonServiceNowReferenceTableForField(
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

export async function resolveServiceNowReferenceFromBackground(
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

export async function resolveServiceNowReferenceFromPage(
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

export async function commitServiceNowReferenceInMainWorld(
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

export async function selectServiceNowReferenceAutocompleteInMainWorld(
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
