import {
  chromeContentBridgePort,
  chromeCookiesPort,
  chromeDownloadsPort,
  chromeHistoryPort,
  chromePersistencePort,
  chromeSearchPort,
  chromeWindowsPort,
} from "../environment/chrome";
import { toolRegistry } from "./registry";
import { ToolName, MessageSource, UserSettings } from "../../types";
import { logger } from "../../utils";
import { sanitizeUrl } from "../security";
import {
  formatProfileFieldsForToolResult,
  resolveProfileFields,
} from "../../utils/personal-profile";
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
  COMPOSE_TEXT_DEF,
  SCROLL_PAGE_DEF,
  READ_PAGE_DEF,
  NAVIGATE_DEF,
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
  INSPECT_REGION_DEF,
  INSPECT_TABLE_DEF,
  INSPECT_FILTER_STATE_DEF,
  APPLY_LIST_FILTER_DEF,
  APPLY_LIST_SORT_DEF,
  APPLY_LIST_ACTION_DEF,
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
import {
  getTabUrl,
  withTimeout,
  getFrameIdsForMainWorldBridge,
} from "./helpers";
// ServiceNow is a quarantined adapter — the generic tools layer talks to it
// only through these façade hooks + register entry points, never its internal
// reference/table helpers. See ./servicenow/tool-hooks.ts.
import {
  finalizeServiceNowReferenceOnType,
  resolveServiceNowListReferenceOverrides,
  resolveServiceNowListTable,
  registerOpenServiceNowModuleTool,
  registerConfigureServiceNowFormTool,
} from "./servicenow";

// Re-export submodules for barrel compatibility
export * from "./registry";
export * from "./definitions";
export * from "./bridge";

const DOWNLOAD_COMPLETION_WAIT_MS = 2500;

type ObservedDownloadCompletion =
  | { status: "completed"; filename?: string }
  | { status: "interrupted"; error?: string }
  | { status: "unobserved" };

async function waitForDownloadCompletion(
  downloadId: number,
  signal?: AbortSignal,
): Promise<ObservedDownloadCompletion> {
  const downloads = chrome.downloads as any;
  if (!downloads) return { status: "unobserved" };

  const initial = await queryDownloadItem(downloads, downloadId);
  const initialTerminal = terminalDownloadState(initial);
  if (initialTerminal) return initialTerminal;

  const onChanged = downloads.onChanged;
  if (
    !onChanged ||
    typeof onChanged.addListener !== "function" ||
    typeof onChanged.removeListener !== "function"
  ) {
    return { status: "unobserved" };
  }

  return await new Promise<ObservedDownloadCompletion>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: ObservedDownloadCompletion) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try {
        onChanged.removeListener(listener);
      } catch {
        // Best effort cleanup for browser/test doubles.
      }
      resolve(result);
    };

    const listener = async (delta: any) => {
      if (delta?.id !== downloadId) return;
      const state = delta.state?.current;
      if (state !== "complete" && state !== "interrupted") return;

      const item = await queryDownloadItem(downloads, downloadId);
      const terminal = terminalDownloadState(item);
      if (terminal) {
        finish(terminal);
        return;
      }
      if (state === "complete") {
        finish({ status: "completed" });
        return;
      }
      finish({
        status: "interrupted",
        error: cleanDownloadError(delta.error?.current),
      });
    };

    try {
      onChanged.addListener(listener);
    } catch {
      finish({ status: "unobserved" });
      return;
    }

    void queryDownloadItem(downloads, downloadId).then((item) => {
      const terminal = terminalDownloadState(item);
      if (terminal) finish(terminal);
    });

    if (signal?.aborted) {
      finish({ status: "unobserved" });
      return;
    }

    timeout = setTimeout(
      () => finish({ status: "unobserved" }),
      DOWNLOAD_COMPLETION_WAIT_MS,
    );
  });
}

async function queryDownloadItem(
  downloads: any,
  downloadId: number,
): Promise<any | null> {
  if (typeof downloads.search !== "function") return null;
  try {
    const items = await downloads.search({ id: downloadId });
    return Array.isArray(items) ? (items[0] ?? null) : null;
  } catch {
    return null;
  }
}

function terminalDownloadState(item: any): ObservedDownloadCompletion | null {
  if (!item) return null;
  if (item.state === "complete") {
    if (item.exists === false) {
      return { status: "interrupted", error: "file missing after completion" };
    }
    const filename = basenameFromDownloadPath(item.filename);
    return {
      status: "completed",
      ...(filename ? { filename } : {}),
    };
  }
  if (item.state === "interrupted") {
    return {
      status: "interrupted",
      error: cleanDownloadError(item.error || item.errorMessage),
    };
  }
  return null;
}

function basenameFromDownloadPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const segment = value.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return (segment ?? "").replace(/\0/g, "").slice(0, 240);
}

function cleanDownloadError(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, 240) : undefined;
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
    const stored = await chromePersistencePort.sync.get("userSettings");
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
    const results = await chromeContentBridgePort.executeFunction(
      tabId,
      func,
      args,
      { allFrames: true, world: "MAIN" },
    );
    const frames = results
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
    const results = await chromeContentBridgePort.executeFunction(
      tabId,
      func,
      args,
      { allFrames: true, world: "MAIN" },
    );
    const frames = results
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
        return await finalizeServiceNowReferenceOnType({
          tabId,
          args,
          result,
          bridgeStatus,
        });
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

  toolRegistry.register(ToolName.COMPOSE_TEXT, COMPOSE_TEXT_DEF, async (args) => {
    // This executor is a fallback — the loop intercepts compose_text (writer handoff) before reaching here
    return `Compose requested for field ${(args.id as number) ?? "?"}.`;
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
        await chromeSearchPort.query({ text: query!, disposition: "CURRENT_TAB" });
      }

      await waitForNavigation(tabId);
      await waitForContentScriptReady(tabId, 2000);
      return `Navigated to ${target}. Page has loaded. Fresh page snapshot is available.`;
    },
  );

  // Registration order is catalog order (registry pushes defs in call order);
  // keep this call here — do not group it with the other ServiceNow tool below.
  registerOpenServiceNowModuleTool(toolRegistry);

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
            "which",
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
          const queryTerms = keywords(input.query).filter(
            (term) => !answerIntentTerms.has(term),
          );
          const lowValueQuestionTerms = new Set([
            "answer",
            "charged",
            "ensuring",
            "following",
            "full",
            "name",
            "numeric",
            "please",
            "state",
            "value",
          ]);
          const focusedQuestionTopicTerms = questionTopicTerms.filter(
            (term) => !lowValueQuestionTerms.has(term),
          );
          const hasHiringQuestion =
            /\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(
              input.question,
            );
          const hasAuditQuestion =
            /\b(?:audits?|auditors?|financial reporting|accounting)\b/i.test(
              input.question,
            );
          const expandedTopicVariants = [
            ...(hasHiringQuestion
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
              : []),
            ...(hasAuditQuestion
              ? [
                  "financial reporting",
                  "audit integrity",
                  "auditor",
                  "accounting controls",
                ]
              : []),
          ];
          const escapeRegExp = (value: string) =>
            value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const hasTermCue = (text: string, term: string) => {
            if (!term) return false;
            const escaped = escapeRegExp(term);
            if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return true;
            if (
              term.endsWith("s") &&
              new RegExp(`\\b${escapeRegExp(term.slice(0, -1))}\\b`, "i").test(
                text,
              )
            ) {
              return true;
            }
            return false;
          };
          const hasQuestionTopicCue = (text: string) => {
            if (hasHiringQuestion) {
              return /\b(?:new hires?|hires?|hiring|recruit|recruitment|headcount)\b/i.test(
                text,
              );
            }
            const topicTerms =
              focusedQuestionTopicTerms.length > 0
                ? focusedQuestionTopicTerms
                : questionTopicTerms;
            return (
              topicTerms.length === 0 ||
              topicTerms.some((term) => hasTermCue(text, term))
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
            input.query,
            queryText,
            focusedQuestionTopicTerms.slice(0, 4).join(" "),
            queryTerms.slice(0, 4).join(" "),
            questionTopicTerms.slice(0, 4).join(" "),
            expandedTopicVariants[0] ?? "",
          ]).slice(0, 5);
          const renderedSearchQueryText =
            focusedQuestionTopicTerms.slice(0, 3).join(" ") ||
            questionTopicTerms.slice(0, 3).join(" ") ||
            queryText;
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
          const fetchServicePortalPagePayload = async (
            pageId: string,
            params: Record<string, string>,
          ) => {
            if (!hasBudget()) return null;
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
              return await response.json().catch(() => null);
            } catch {
              return null;
            }
          };
          const fetchServicePortalPageText = async (
            pageId: string,
            params: Record<string, string>,
          ) => {
            const payload = await fetchServicePortalPagePayload(pageId, params);
            const text = textFromJson(payload);
            return text === "null" ? "" : text;
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
            const addPortalPayloadRecords = (
              payload: unknown,
              fallbackUrl: string,
            ) => {
              const visit = (entry: unknown, depth: number) => {
                if (depth > 8 || records.length >= 25) return;
                if (Array.isArray(entry)) {
                  for (const item of entry) visit(item, depth + 1);
                  return;
                }
                if (!entry || typeof entry !== "object") return;
                const item = entry as Record<string, unknown>;
                const title = normalize(
                  item.title ??
                    item.short_description ??
                    item.label ??
                    item.name ??
                    item.number,
                );
                const snippet = textFromJson(
                  item.snippet ??
                    item.summary ??
                    item.text ??
                    item.description ??
                    item.content ??
                    item,
                );
                const rawUrl = normalize(
                  item.url ?? item.link ?? item.href ?? item.target_url,
                );
                const sysId = normalize(
                  item.sys_id ??
                    item.sys_kb_id ??
                    item.kb_knowledge ??
                    item.id,
                );
                let url = rawUrl ? absoluteUrl(rawUrl) : "";
                if (!url && sysId && /^[0-9a-f]{32}$/i.test(sysId)) {
                  url = new URL(
                    `/kb?id=kb_article_view&sys_kb_id=${encodeURIComponent(sysId)}`,
                    location.origin,
                  ).href;
                }
                if (
                  title &&
                  snippet &&
                  url &&
                  (isKnowledgeArticleUrl(url) || hasQuestionTopicCue(snippet))
                ) {
                  records.push({
                    title,
                    url,
                    snippet: snippet.slice(0, 800),
                    text: snippet,
                  });
                }
                for (const value of Object.values(item)) visit(value, depth + 1);
              };
              visit(payload, 0);
              if (records.length === 0) {
                const text = textFromJson(payload);
                if (text && text !== "null") {
                  records.push({
                    title: "Service Portal knowledge search",
                    url: fallbackUrl,
                    snippet: text.slice(0, 800),
                    text,
                  });
                }
              }
            };
            for (const variant of queryVariants) {
              if (!hasBudget()) break;
              const payload = await fetchServicePortalPagePayload("kb_search", {
                query: variant,
              });
              if (payload == null) continue;
              const text = textFromJson(payload);
              if (!text || text === "null") continue;
              const url = new URL(
                `/kb?id=kb_search&query=${encodeURIComponent(variant)}`,
                location.origin,
              ).href;
              addPortalPayloadRecords(payload, url);
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
                  /\b(?:is|are|was|were|has|have|contains?|includes?|makes?|made|typically|usually|annual(?:ly)?|yearly|each year|per year|hires?|employees?|headcount|count|total)\b/i.test(
                    before,
                  )
                ) {
                  score += 10;
                }
                if (/\b(?:hires?|employees?|headcount|count|total|floors?|levels?|stories|storeys)\b/i.test(after)) {
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
          const articleCandidates: Array<{
            title: string;
            url: string;
            answer: string;
            sentence: string;
            score: number;
          }> = [];
          const seenUrls = new Set<string>();
          const rankSearchResults = (
            results: Array<{
              title: string;
              url: string;
              snippet: string;
              text?: string;
            }>,
          ) =>
            results
              .map((entry) => ({
                ...entry,
                score: scoreText(`${entry.title} ${entry.snippet}`),
              }))
              .sort((a, b) => b.score - a.score)
              .slice(0, Math.max(input.maxResults, 20));
          const addAnswerCandidatesFromResults = async (
            results: ReturnType<typeof rankSearchResults>,
          ) => {
            for (const result of results) {
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
              const serviceNowRecord =
                await fetchServiceNowKnowledgeRecordBySysId(sysKbId);
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
                const record =
                  await fetchServiceNowKnowledgeRecordByNumber(articleNumber);
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
                | {
                    text: string;
                    url: string;
                    extracted: ReturnType<typeof extractAnswer>;
                  }
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
                fetched?.extracted ??
                extractAnswer(`${result.title}. ${result.snippet}`);
              if (!extracted) continue;
              articleCandidates.push({
                title: result.title,
                url: fetched?.url ?? result.url,
                answer: extracted.answer,
                sentence: extracted.sentence,
                score: result.score + extracted.score,
              });
            }
          };
          const hasStrongAnswerCandidate = () =>
            articleCandidates.some((candidate) => candidate.score >= 20);
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
          await addAnswerCandidatesFromResults(rankSearchResults(searchResults));
          if (!hasStrongAnswerCandidate() && hasBudget()) {
            for (const entry of await fetchServicePortalKnowledgeSearchRecords()) {
              if (seenUrls.has(entry.url)) continue;
              seenUrls.add(entry.url);
              searchResults.push(entry);
            }
          }
          if (!hasStrongAnswerCandidate() && hasBudget()) {
            for (const entry of await fetchServiceNowKnowledgeRecords()) {
              if (seenUrls.has(entry.url)) continue;
              seenUrls.add(entry.url);
              searchResults.push(entry);
            }
            await addAnswerCandidatesFromResults(rankSearchResults(searchResults));
          }

          const rankedResults = rankSearchResults(searchResults);
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
      const url = typeof args.url === "string" ? args.url : "";
      if (!url) return "Error: provide a url for the file to upload.";
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
    async (args, _tabId, signal) => {
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
        const downloadId = await chromeDownloadsPort.download(opts);
        const completed = await waitForDownloadCompletion(downloadId, signal);
        if (completed.status === "completed") {
          const completedFilename =
            basenameFromDownloadPath(completed.filename) ||
            (typeof opts.filename === "string" ? opts.filename : "") ||
            filename ||
            "";
          return `Download completed (ID: ${downloadId}${
            completedFilename ? `, filename: ${completedFilename}` : ""
          })`;
        }
        if (completed.status === "interrupted") {
          return `Error: Download interrupted (ID: ${downloadId}${
            completed.error ? `, reason: ${completed.error}` : ""
          })`;
        }
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
        const cookies = await chromeCookiesPort.getAll({ url });
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
      await chromeCookiesPort.set(opts);
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
        await chromeCookiesPort.remove({ url, name });
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
        const items = await chromeHistoryPort.search({
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

  // LP-13: the real executor lives in the agent loop (region-zoom.ts) —
  // it needs the loop's screenshot cache, zoom cap, budget, and delivery
  // paths. This fallback only answers callers outside an agent turn.
  toolRegistry.register(
    ToolName.INSPECT_REGION,
    INSPECT_REGION_DEF,
    async () =>
      "inspect_region requires an active agent turn (screenshot context unavailable).",
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
                const numericPoints: Array<{ label: string; value: number }> =
                  [];
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
                    if (count !== null && label) {
                      numericPoints.push({ label, value: count });
                    }
                    if (points.length >= max) break;
                  }
                  if (points.length >= max) break;
                }
                if (points.length > 0) {
                  push(`Highcharts ${chartIndex + 1} title`, chartTitle, true);
                }
                for (const point of points) push("Point", point, true);
                if (numericPoints.length >= 2) {
                  const sorted = [...numericPoints].sort((a, b) => {
                    if (a.value !== b.value) return a.value - b.value;
                    return a.label.localeCompare(b.label);
                  });
                  const min = sorted[0];
                  const maxPoint = sorted[sorted.length - 1];
                  const minPoints = sorted.filter(
                    (point) => point.value === min.value,
                  );
                  const maxPoints = sorted.filter(
                    (point) => point.value === maxPoint.value,
                  );
                  const formatPoints = (
                    points: Array<{ label: string; value: number }>,
                  ) =>
                    points
                      .map(
                        (point) =>
                          `${point.label}: ${formatNumber(point.value)}`,
                      )
                      .join(", ");
                  push(
                    "Numeric summary",
                    `min=${formatPoints(minPoints)}; max=${formatPoints(maxPoints)}; difference_to_max=${formatNumber(maxPoint.value - min.value)}; order_extra_quantity_to_raise_min_to_max=${formatNumber(maxPoint.value - min.value)}; final_target_quantity=${formatNumber(maxPoint.value)}`,
                    true,
                  );
                }
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
            const duplicateCandidates = new Map<
              string,
              { value: string; records: Set<string>; rows: number[] }
            >();
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
              const rowText = cells.length > 0 ? cells.join(" | ") : norm(row.textContent);
              const records = [
                ...new Set(rowText.match(/\b[A-Z]{2,5}\d{4,}\b/g) || []),
              ];
              const rowRecord = records[0] || `row ${rowIndex + 1}`;
              for (const cell of cells) {
                const value = cell.replace(/\s+/g, " ").trim();
                if (
                  value.length < 12 ||
                  /^\(?empty\)?$/i.test(value) ||
                  /\b[A-Z]{2,5}\d{4,}\b/.test(value) ||
                  /^(assess|closed|open|new|active|inactive|fix applied)$/i.test(value) ||
                  /^[0-9]+(\s*-\s*[a-z]+)?$/i.test(value)
                ) {
                  continue;
                }
                if (value.length < 20 && !/[#"]/.test(value)) continue;
                const key = value.toLowerCase();
                const existing =
                  duplicateCandidates.get(key) ||
                  { value, records: new Set<string>(), rows: [] };
                existing.records.add(rowRecord);
                existing.rows.push(rowIndex + 1);
                duplicateCandidates.set(key, existing);
              }
            });
            const repeated = [...duplicateCandidates.values()]
              .filter((candidate) => candidate.records.size >= 2)
              .slice(0, 5);
            if (repeated.length > 0) {
              lines.push("Duplicate candidates:");
              for (const candidate of repeated) {
                lines.push(
                  `- ${candidate.value.slice(0, 180)} :: records ${[
                    ...candidate.records,
                  ].join(", ")}. For duplicate row actions, use apply_list_action with one duplicate record in records and the other as relatedRecord.`,
                );
              }
            }
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
        const { effectiveTable, overrides: referenceValueOverrides } =
          await resolveServiceNowListReferenceOverrides({
            tabId,
            conditions,
            table,
          });

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
                const requested = keyFor(payload.table).replace(/list$/, "");
                const title = keyFor(document.title);
                const actual = keyFor(tableName);
                if (
                  requested &&
                  requested !== actual &&
                  !actual.endsWith(requested) &&
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
                  addField(
                    "short_description",
                    table === "problem"
                      ? "Problem statement"
                      : "Short description",
                    "string",
                    "",
                  );
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
                  const labelKey = keyFor(field.label);
                  if (
                    labelKey.includes(normalized) ||
                    (labelKey.length >= 8 && normalized.includes(labelKey))
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
                    : operator.includes("contain") ||
                        operator.includes("like") ||
                        operator.includes("include")
                      ? "LIKE"
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
        const effectiveTable = resolveServiceNowListTable(table, currentTabUrl);

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
                  addField(
                    "short_description",
                    table === "problem"
                      ? "Problem statement"
                      : "Short description",
                    "string",
                    "",
                  );
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
                      (labelKey.length >= 8 && normalized.includes(labelKey))
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
    ToolName.APPLY_LIST_ACTION,
    APPLY_LIST_ACTION_DEF,
    async (args, tabId) => {
      const records = Array.isArray(args.records)
        ? args.records
            .map((record) =>
              typeof record === "string"
                ? record.trim()
                : String(record ?? "").trim(),
            )
            .filter(Boolean)
        : [];
      const action = typeof args.action === "string" ? args.action.trim() : "";
      const relatedRecord =
        typeof args.relatedRecord === "string"
          ? args.relatedRecord.trim()
          : "";
      const relatedField =
        typeof args.relatedField === "string" ? args.relatedField.trim() : "";
      const table = typeof args.table === "string" ? args.table.trim() : "";
      const confirm = args.confirm !== false;

      if (records.length === 0) {
        return "Error: apply_list_action requires at least one record identifier or row text snippet.";
      }
      if (!action) {
        return "Error: apply_list_action requires a visible selected-row action label.";
      }

      try {
        let currentTabUrl = "";
        try {
          currentTabUrl = (await chrome.tabs.get(tabId)).url || "";
        } catch {
          currentTabUrl = "";
        }
        const effectiveTable = resolveServiceNowListTable(table, currentTabUrl);

        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "MAIN" as any,
            func: async (payload: {
              records: string[];
              action: string;
              relatedRecord: string;
              relatedField: string;
              table: string;
              confirm: boolean;
            }) => {
              const sleep = (ms: number) =>
                new Promise((resolve) => window.setTimeout(resolve, ms));
              const normalize = (value: unknown): string =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
              const keyFor = (value: unknown): string =>
                normalize(value).replace(/[^a-z0-9]+/g, "");
              const cssEscape = (value: string): string => {
                const css = (window as any).CSS;
                if (css && typeof css.escape === "function") {
                  return css.escape(value);
                }
                return value.replace(/["\\]/g, "\\$&");
              };
              const visibleText = (element: Element | null): string =>
                normalize(
                  [
                    element?.getAttribute("aria-label"),
                    element?.getAttribute("title"),
                    element?.getAttribute("name"),
                    element?.getAttribute("id"),
                    element?.textContent,
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
              const fieldNameFromDisplayInput = (
                input: HTMLInputElement,
              ): string => {
                const name = input.name || input.id || "";
                return name
                  .replace(/^sys_display\./, "")
                  .replace(/^sys_original\./, "")
                  .split(".")
                  .pop() || name;
              };
              const fieldMatches = (
                input: HTMLInputElement,
                requestedField: string,
              ): boolean => {
                if (!requestedField) return true;
                const requested = keyFor(requestedField);
                const fieldName = fieldNameFromDisplayInput(input);
                const label = input
                  .closest("tr, .form-group, .form-field, .container-fluid")
                  ?.querySelector("label");
                return [
                  fieldName,
                  input.name,
                  input.id,
                  input.getAttribute("aria-label"),
                  label?.textContent,
                ].some((value) => keyFor(value).includes(requested));
              };
              const resolveRecordReference = async (
                tableName: string,
                displayValue: string,
              ): Promise<{ sysId: string; display: string } | null> => {
                const cleanValue = displayValue.trim();
                if (!tableName || !cleanValue) return null;
                const encodedQuery = encodeURIComponent(
                  `number=${cleanValue}^ORname=${cleanValue}^ORuser_name=${cleanValue}`,
                );
                const fields = encodeURIComponent("sys_id,number,name,user_name");
                const url = `/api/now/table/${encodeURIComponent(
                  tableName,
                )}?sysparm_query=${encodedQuery}&sysparm_fields=${fields}&sysparm_limit=1`;
                try {
                  const response = await fetch(url, {
                    credentials: "include",
                    headers: { accept: "application/json" },
                  });
                  if (!response.ok) return null;
                  const body = (await response.json()) as {
                    result?: Array<Record<string, unknown>>;
                  };
                  const record = body.result?.[0];
                  if (!record) return null;
                  const sysId =
                    typeof record?.sys_id === "string" ? record.sys_id : "";
                  if (!sysId) return null;
                  const display =
                    String(record.number || record.name || record.user_name || "")
                      .trim() || cleanValue;
                  return { sysId, display };
                } catch {
                  return null;
                }
              };
              const fillRelatedReference = async (): Promise<
                | {
                    ok: true;
                    field: string;
                    display: string;
                    sysId?: string;
                  }
                | { ok: false; reason: string; availableFields?: string[] }
              > => {
                if (!payload.relatedRecord) {
                  return { ok: false, reason: "no_related_record" };
                }
                const requestedField =
                  payload.relatedField ||
                  (/duplicate/i.test(payload.action) ? "duplicate_of" : "");
                const candidates = [
                  ...document.querySelectorAll<HTMLInputElement>(
                    "input[id^='sys_display.'], input[name^='sys_display.'], input[type='search']",
                  ),
                ].filter((input) => {
                  if (input.disabled || input.readOnly) return false;
                  const rect = input.getBoundingClientRect();
                  if (rect.width <= 0 || rect.height <= 0) return false;
                  if (!fieldMatches(input, requestedField)) return false;
                  if (requestedField) return true;
                  return /sys_display|reference|lookup/i.test(
                    `${input.id} ${input.name} ${input.type}`,
                  );
                });
                const input =
                  candidates.find((candidate) =>
                    /duplicate_of/i.test(`${candidate.id} ${candidate.name}`),
                  ) || candidates[0];
                if (!input) {
                  return {
                    ok: false,
                    reason: "related_field_not_found",
                    availableFields: [
                      ...document.querySelectorAll<HTMLInputElement>(
                        "input[id^='sys_display.'], input[name^='sys_display.'], input[type='search']",
                      ),
                    ]
                      .map(visibleText)
                      .filter(Boolean)
                      .slice(0, 20),
                  };
                }

                const fieldName = fieldNameFromDisplayInput(input);
                const resolved = await resolveRecordReference(
                  tableName || payload.table,
                  payload.relatedRecord,
                );
                const win = window as any;
                if (
                  resolved?.sysId &&
                  win.g_form &&
                  typeof win.g_form.setValue === "function"
                ) {
                  try {
                    win.g_form.setValue(
                      fieldName,
                      resolved.sysId,
                      resolved.display,
                    );
                  } catch {
                    // Fall back to DOM value setting below.
                  }
                }
                input.value = resolved?.display || payload.relatedRecord;
                input.setAttribute("value", input.value);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));

                const hidden =
                  document.querySelector<HTMLInputElement>(
                  `input[name="${cssEscape(fieldName)}"], input[id="${cssEscape(
                    fieldName,
                  )}"], input[name$=".${cssEscape(
                    fieldName,
                  )}"]:not([id^="sys_display."])`,
                  ) ||
                  [
                    ...document.querySelectorAll<HTMLInputElement>("input"),
                  ].find((candidate) => {
                    if (/^sys_display\./i.test(candidate.id)) return false;
                    if (/^sys_display\./i.test(candidate.name)) return false;
                    return [candidate.id, candidate.name].some(
                      (value) =>
                        value === fieldName || value.endsWith(`.${fieldName}`),
                    );
                  });
                if (hidden && resolved?.sysId) {
                  hidden.value = resolved.sysId;
                  hidden.setAttribute("value", resolved.sysId);
                  hidden.dispatchEvent(new Event("input", { bubbles: true }));
                  hidden.dispatchEvent(new Event("change", { bubbles: true }));
                }
                await sleep(200);
                return {
                  ok: true,
                  field: fieldName,
                  display: input.value,
                  sysId: resolved?.sysId,
                };
              };
              const serviceNowListMatch = /\/([^/?#]+)_list\.do\b/i.exec(
                location.pathname,
              );
              const listApi = (() => {
                const win = window as any;
                const glide = win.GlideList2;
                if (glide && typeof glide.get === "function") {
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

              const tables = [
                ...document.querySelectorAll(
                  "table.data_list_table, table, [role='grid'], [role='table']",
                ),
              ];
              const rows = tables.flatMap((table) => [
                ...table.querySelectorAll("tr, [role='row']"),
              ]);
              const matchedRows: Array<{ record: string; row: Element }> = [];
              const missing: string[] = [];
              for (const record of payload.records) {
                const needle = normalize(record);
                const row = rows.find((candidate) =>
                  normalize(candidate.textContent).includes(needle),
                );
                if (row) matchedRows.push({ record, row });
                else missing.push(record);
              }
              if (missing.length > 0) {
                return {
                  ok: false,
                  reason: "rows_not_found",
                  table: tableName,
                  missing,
                  sampledRows: rows
                    .map((row) => normalize(row.textContent).slice(0, 220))
                    .filter(Boolean)
                    .slice(0, 12),
                  url: location.href,
                };
              }

              const selected: string[] = [];
              for (const match of matchedRows) {
                const checkbox = match.row.querySelector<HTMLElement>(
                  "input[type='checkbox']:not([disabled]), [role='checkbox']:not([aria-disabled='true'])",
                );
                if (!checkbox) {
                  return {
                    ok: false,
                    reason: "row_checkbox_not_found",
                    table: tableName,
                    record: match.record,
                    rowText: normalize(match.row.textContent).slice(0, 240),
                    url: location.href,
                  };
                }
                const checked =
                  checkbox instanceof HTMLInputElement
                    ? checkbox.checked
                    : checkbox.getAttribute("aria-checked") === "true";
                if (!checked) {
                  checkbox.click();
                  checkbox.dispatchEvent(new Event("input", { bubbles: true }));
                  checkbox.dispatchEvent(
                    new Event("change", { bubbles: true }),
                  );
                }
                selected.push(match.record);
              }
              await sleep(150);

              const actionNeedle = keyFor(payload.action);
              const optionSelect = [
                ...document.querySelectorAll<HTMLSelectElement>("select"),
              ].find((select) =>
                [...select.options].some(
                  (option) =>
                    keyFor(option.textContent || option.label) === actionNeedle,
                ),
              );
              let appliedAction = "";
              if (optionSelect) {
                const option = [...optionSelect.options].find(
                  (candidate) =>
                    keyFor(candidate.textContent || candidate.label) ===
                    actionNeedle,
                );
                if (!option) {
                  return {
                    ok: false,
                    reason: "action_option_not_found",
                    table: tableName,
                    action: payload.action,
                    url: location.href,
                  };
                }
                optionSelect.value = option.value;
                option.selected = true;
                optionSelect.dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                optionSelect.dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
                appliedAction =
                  option.textContent?.trim() || option.label || payload.action;
              } else {
                const controls = [
                  ...document.querySelectorAll<HTMLElement>(
                    "button, a, [role='button'], [role='menuitem']",
                  ),
                ];
                const control = controls.find(
                  (candidate) =>
                    keyFor(
                      candidate.textContent ||
                        candidate.getAttribute("aria-label"),
                    ) === actionNeedle,
                );
                if (!control) {
                  return {
                    ok: false,
                    reason: "action_control_not_found",
                    table: tableName,
                    action: payload.action,
                    availableActions: controls
                      .map((control) =>
                        normalize(
                          control.textContent ||
                            control.getAttribute("aria-label"),
                        ),
                      )
                      .filter(Boolean)
                      .slice(0, 40),
                    url: location.href,
                  };
                }
                control.click();
                appliedAction =
                  control.textContent?.trim() ||
                  control.getAttribute("aria-label") ||
                  payload.action;
              }

              await sleep(350);
              const related = payload.relatedRecord
                ? await fillRelatedReference()
                : null;
              if (related && related.ok === false) {
                return {
                  ok: false,
                  reason: related.reason,
                  table: tableName,
                  action: payload.action,
                  relatedRecord: payload.relatedRecord,
                  availableFields: related.availableFields,
                  url: location.href,
                };
              }
              let confirmed = false;
              if (payload.confirm) {
                const confirmControls = [
                  ...document.querySelectorAll<HTMLElement>(
                    "[role='dialog'] button, .modal button, .modal-footer button, button, [role='button']",
                  ),
                ];
                const confirmControl = confirmControls.find((control) =>
                  /^(ok|yes|delete|confirm|continue|submit)$/i.test(
                    normalize(
                      control.textContent || control.getAttribute("aria-label"),
                    ),
                  ),
                );
                if (confirmControl) {
                  confirmControl.click();
                  confirmed = true;
                  await sleep(350);
                }
              }

              return {
                ok: true,
                platform: "servicenow",
                table: tableName,
                selected,
                action: appliedAction,
                related,
                confirmed,
                frameUrl: location.href,
              };
            },
            args: [
              {
                records,
                action,
                relatedRecord,
                relatedField,
                table: effectiveTable,
                confirm,
              },
            ],
          }),
          12_000,
          "apply_list_action",
        );

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter(Boolean);
        const applied = plans.find((plan) => plan?.ok === true);
        if (!applied) {
          const failed = plans.find((plan) => typeof plan?.reason === "string");
          const reason = failed?.reason || "no_supported_list_surface";
          const missing = Array.isArray(failed?.missing)
            ? ` Missing: ${(failed.missing as string[]).join(", ")}.`
            : "";
          const sampledRows = Array.isArray(failed?.sampledRows)
            ? ` Sampled rows: ${(failed.sampledRows as string[])
                .slice(0, 6)
                .join(" | ")}`
            : "";
          return `Error: Could not apply ServiceNow list action (${String(reason)}).${missing}${sampledRows}`;
        }

        const selected = Array.isArray(applied.selected)
          ? (applied.selected as string[]).join(", ")
          : records.join(", ");
        return [
          `Applied ServiceNow list action "${String(applied.action || action)}" on ${String(applied.table || "list")}.`,
          `Selected rows: ${selected}`,
          applied.related &&
          typeof applied.related === "object" &&
          (applied.related as Record<string, unknown>).ok === true
            ? `Related record: ${String((applied.related as Record<string, unknown>).field || relatedField || "reference")} = ${String((applied.related as Record<string, unknown>).display || relatedRecord)}`
            : "",
          `Confirmed dialog: ${String(Boolean(applied.confirmed))}`,
        ]
          .filter(Boolean)
          .join("\n");
      } catch (e: any) {
        return `Error applying ServiceNow list action: ${e.message}`;
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
          const itemNameCandidates = [
            ...document.querySelectorAll(
              "h1, h2, h3, [data-test-id*='title' i], [class*='item' i][class*='title' i], [class*='catalog' i][class*='title' i], .cat_item_name, .sc-cat-item-title",
            ),
          ]
            .map((el) => norm(el.textContent))
            .filter(Boolean)
            .slice(0, 10);
          const titleCandidate = norm(document.title.replace(/\s*\|\s*ServiceNow.*$/i, ""));
          if (titleCandidate) itemNameCandidates.push(titleCandidate);
          const uniqueItemNames = [...new Set(itemNameCandidates)].slice(0, 8);
          if (uniqueItemNames.length > 0) {
            lines.push("Catalog item candidates:");
            lines.push(...uniqueItemNames.map((name) => `- ${name.slice(0, 220)}`));
          }
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
      const expectedItem =
        typeof args.expectedItem === "string" && args.expectedItem.trim()
          ? args.expectedItem.trim()
          : null;
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
            expectedItem: string | null;
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
                  const labelText = document.getElementById(labelId)?.textContent;
                  if (labelText) labels.push(labelText);
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
            const compact = (value: unknown) =>
              norm(value).replace(/[^a-z0-9]+/g, "");
            const itemNameCandidates = () => {
              const candidates = [
                ...document.querySelectorAll(
                  "h1, h2, h3, [data-test-id*='title' i], [class*='item' i][class*='title' i], [class*='catalog' i][class*='title' i], .cat_item_name, .sc-cat-item-title",
                ),
              ]
                .map((el) => display(el.textContent))
                .filter(Boolean);
              const titleCandidate = display(
                document.title.replace(/\s*\|\s*ServiceNow.*$/i, ""),
              );
              if (titleCandidate) candidates.push(titleCandidate);
              return [...new Set(candidates)].slice(0, 12);
            };
            const expectedItemMatches = (expected: string, candidates: string[]) => {
              const wanted = norm(expected);
              const compactWanted = compact(expected);
              return candidates.some((candidate) => {
                const candidateNorm = norm(candidate);
                const compactCandidate = compact(candidate);
                return (
                  candidateNorm === wanted ||
                  candidateNorm.includes(wanted) ||
                  (compactWanted.length >= 8 &&
                    compactCandidate === compactWanted)
                );
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
              const labelled = controls.find(
                (el) => matches(labelsFor(el), field) && selectOptionFor(el, value),
              );
              if (labelled) return labelled;
              const visibleFollowing = findFollowingControl(
                field,
                controls.filter(visible),
              );
              if (visibleFollowing && selectOptionFor(visibleFollowing, value)) {
                return visibleFollowing;
              }
              const following = findFollowingControl(field, controls);
              if (following && selectOptionFor(following, value)) return following;
              const valueMatches = controls.filter((el) =>
                selectOptionFor(el, value),
              );
              return valueMatches.length === 1 ? valueMatches[0] : undefined;
            };
            const radioLikeControls = () =>
              [
                ...document.querySelectorAll(
                  "input[type='radio'], [role='radio'], label[type='radio'], label[role='radio']",
                ),
              ] as Element[];
            const radioGroupNameFor = (el: Element) =>
              display(
                el.getAttribute("name") ||
                  el.getAttribute("data-name") ||
                  el.getAttribute("aria-controls") ||
                  "",
              );
            const radioInputFor = (el: Element): HTMLInputElement | null => {
              if (el instanceof HTMLInputElement && el.type === "radio") {
                return el;
              }
              const nested = el.querySelector?.("input[type='radio']");
              if (nested instanceof HTMLInputElement) return nested;
              const controlId =
                el.getAttribute("for") ||
                el.getAttribute("control") ||
                el.getAttribute("aria-controls");
              const controlled = controlId ? document.getElementById(controlId) : null;
              if (
                controlled instanceof HTMLInputElement &&
                controlled.type === "radio"
              ) {
                return controlled;
              }
              const groupName = radioGroupNameFor(el);
              if (!groupName) return null;
              const groupInputs = [
                ...document.querySelectorAll(
                  `input[type='radio'][name="${escapeCss(groupName)}"]`,
                ),
              ] as HTMLInputElement[];
              if (groupInputs.length === 0) return null;
              const visibleGroupControls = radioLikeControls().filter(
                (candidate) =>
                  !(candidate instanceof HTMLInputElement) &&
                  radioGroupNameFor(candidate) === groupName,
              );
              const labelIndex = visibleGroupControls.indexOf(el);
              if (labelIndex >= 0 && groupInputs[labelIndex]) {
                return groupInputs[labelIndex];
              }
              const labelText = norm(el.textContent);
              return (
                groupInputs.find((input) =>
                  [
                    ...directLabelsFor(input),
                    input.closest("label")?.textContent,
                    input.nextElementSibling?.matches("label")
                      ? input.nextElementSibling.textContent
                      : null,
                  ].some((label) => {
                    const candidate = norm(label);
                    return (
                      candidate &&
                      labelText &&
                      (candidate === labelText ||
                        candidate.includes(labelText) ||
                        labelText.includes(candidate))
                    );
                  }),
                ) ?? null
              );
            };
            const radioStoredValueFor = (el: Element) => {
              const input = radioInputFor(el);
              return display(
                input?.value ||
                  input?.id ||
                  el.getAttribute("id") ||
                  (el as HTMLInputElement).value ||
                  el.getAttribute("value") ||
                  el.textContent ||
                  "",
              );
            };
            const radioCheckedMarkerValueFor = (el: Element) => {
              const input = radioInputFor(el);
              return display(
                input?.id ||
                  el.getAttribute("id") ||
                  (el as HTMLInputElement).value ||
                  el.getAttribute("value") ||
                  el.textContent ||
                  "",
              );
            };
            const radioDisplayValueFor = (el: Element) =>
              display(
                [
                  el.getAttribute("aria-label"),
                  el.getAttribute("title"),
                  el.getAttribute("id")
                    ? document.querySelector(
                        `label[for="${escapeCss(el.getAttribute("id") || "")}"]`,
                      )?.textContent
                    : null,
                  el.closest("label")?.textContent,
                  el.nextElementSibling?.matches("label")
                    ? el.nextElementSibling.textContent
                    : null,
                  el.textContent,
                  (el as HTMLInputElement).value,
                ]
                  .filter(Boolean)
                  .join(" "),
              );
            const radioOptionMatches = (el: Element, value: string) => {
              const wanted = norm(value);
              const compactWanted = wanted.replace(/[^a-z0-9]+/g, "");
              const labels = [
                radioDisplayValueFor(el),
                ...directLabelsFor(el),
                ...labelsFor(el).filter((label) => label.length <= 160),
              ];
              return labels.some((label) => {
                const candidate = norm(label);
                const compactCandidate = candidate.replace(/[^a-z0-9]+/g, "");
                return (
                  candidate === wanted ||
                  candidate.includes(wanted) ||
                  (compactWanted.length > 0 &&
                  compactCandidate.includes(compactWanted))
                );
              });
            };
            const radioStoredValueMatches = (el: Element, value: string) => {
              const wanted = norm(value);
              const compactWanted = wanted.replace(/[^a-z0-9]+/g, "");
              const candidate = norm(radioStoredValueFor(el));
              const compactCandidate = candidate.replace(/[^a-z0-9]+/g, "");
              return (
                candidate === wanted ||
                (compactWanted.length > 0 && compactCandidate === compactWanted)
              );
            };
            const findRadioOptionControl = (field: string, value: string) => {
              const controls = radioLikeControls();
              const findAfterField = (candidates: Element[]) => {
                for (const anchor of labelAnchorsFor(field)) {
                  const after = candidates.filter((el) =>
                    Boolean(anchor.compareDocumentPosition(el) & 4),
                  );
                  const match =
                    after.find((el) => radioStoredValueMatches(el, value)) ||
                    after.find((el) => radioOptionMatches(el, value));
                  if (match) return match;
                }
                return undefined;
              };
              const visibleMatch = findAfterField(controls.filter(visible));
              if (visibleMatch) return visibleMatch;
              const followingMatch = findAfterField(controls);
              if (followingMatch) return followingMatch;
              const exactValueMatches = controls.filter((el) =>
                radioStoredValueMatches(el, value),
              );
              if (exactValueMatches.length === 1) return exactValueMatches[0];
              const valueMatches = controls.filter((el) =>
                radioOptionMatches(el, value),
              );
              return valueMatches.length === 1 ? valueMatches[0] : undefined;
            };
            const setRadioOptionControlState = (
              control: Element,
              desiredValue: string,
            ) => {
              const inputControl = radioInputFor(control);
              const commitControl = inputControl || control;
              const groupName =
                radioGroupNameFor(commitControl) || radioGroupNameFor(control);
              const selectedValue = radioStoredValueFor(commitControl);
              const selectedCheckedMarker =
                radioCheckedMarkerValueFor(commitControl);
              if (control instanceof HTMLElement && visible(control)) {
                control.click();
              }
              const groupControls = groupName
                ? radioLikeControls().filter(
                    (candidate) => radioGroupNameFor(candidate) === groupName,
                  )
                : [control];
              for (const candidate of groupControls) {
                const candidateInput = radioInputFor(candidate);
                const selected =
                  candidate === control ||
                  (Boolean(inputControl) && candidateInput === inputControl);
                if (candidateInput) {
                  setNativeChecked(candidateInput, selected);
                }
                if (candidate instanceof HTMLElement) {
                  candidate.setAttribute("checked", String(selected));
                  candidate.setAttribute("aria-checked", String(selected));
                }
              }
              const checkedRadioName = groupName
                ? `${groupName}_checked_radio`
                : null;
              if (checkedRadioName && selectedCheckedMarker) {
                document
                  .querySelectorAll(
                    `input[name="${escapeCss(checkedRadioName)}"], input[id="${escapeCss(checkedRadioName)}"]`,
                  )
                  .forEach((el) => {
                    if (el instanceof HTMLInputElement) {
                      setNativeValue(el, selectedCheckedMarker);
                    }
                  });
              }
              const compactDesired = compact(desiredValue);
              const compactSelected = compact(selectedValue);
              const compactDisplay = compact(radioDisplayValueFor(control));
              const valueToCommit =
                selectedValue &&
                (compactSelected.includes(compactDesired) ||
                  compactDesired.includes(compactSelected) ||
                  compactDisplay.includes(compactSelected))
                  ? selectedValue
                  : desiredValue;
              if (valueToCommit) {
                commitServiceNowValue(commitControl, valueToCommit);
                if (commitControl !== control) {
                  commitServiceNowValue(control, valueToCommit);
                }
              }
              if (inputControl?.checked) {
                return true;
              }
              const checked =
                control.getAttribute("checked") ||
                control.getAttribute("aria-checked");
              return checked === "true";
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
                  const idLabel = document.getElementById(`${id}_label`)?.textContent;
                  if (idLabel) labels.push(idLabel);
                }
                const controlId =
                  el.getAttribute("for") ||
                  el.getAttribute("control") ||
                  el.getAttribute("aria-controls");
                if (controlId) {
                  const controlText = document.getElementById(controlId)?.textContent;
                  if (controlText) labels.push(controlText);
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
            const hasOrderOrCartSubmitControl = () => {
              const controls = [
                ...document.querySelectorAll(
                  "button, input[type='button'], input[type='submit'], a, [role='button']",
                ),
              ].filter(visible);
              return controls.some((el) =>
                directLabelsFor(el).some((label) =>
                  /\b(add to cart|order now|place order|submit order|request|checkout|order)\b/i.test(
                    label,
                  ),
                ),
              );
            };
            let quantityDeferredToCart = false;
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
                : input.continueToCheckout && quantityDeferredToCart
                  ? [
                      /\badd to cart\b/i,
                      /\b(order now|place order|submit order|request)\b/i,
                      /\b(proceed to checkout|checkout)\b/i,
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
            const currentItemNames = itemNameCandidates();
            if (input.expectedItem) {
              if (expectedItemMatches(input.expectedItem, currentItemNames)) {
                configured.push(`Catalog item=${input.expectedItem}`);
              } else {
                mismatches.push(
                  `Catalog item mismatch: expected ${input.expectedItem}; visible ${currentItemNames.length ? currentItemNames.join(" | ") : "(unknown)"}.`,
                );
              }
            }
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
              if (control) {
                const option = selectOptionFor(control, field.value);
                if (!option) {
                  mismatches.push(
                    `Option not found for ${field.field}: ${field.value}.`,
                  );
                  continue;
                }
                setNativeValue(control, option.value);
                const selectedText =
                  control.selectedOptions[0]?.textContent?.trim() ||
                  control.value;
                if (
                  norm(control.value) !== norm(option.value) &&
                  norm(selectedText) !== norm(field.value)
                ) {
                  mismatches.push(
                    `Option ${field.field} is ${selectedText || control.value}.`,
                  );
                } else {
                  configured.push(`${field.field}=${selectedText || option.value}`);
                }
                continue;
              }
              const radioControl = findRadioOptionControl(field.field, field.value);
              if (!radioControl) {
                mismatches.push(`Option field not found: ${field.field}.`);
                continue;
              }
              const selected = setRadioOptionControlState(
                radioControl,
                field.value,
              );
              if (!selected) {
                mismatches.push(`Option ${field.field} was not selected.`);
              } else {
                configured.push(
                  `${field.field}=${radioDisplayValueFor(radioControl) || field.value}`,
                );
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
                if (pageLooksCatalog && hasOrderOrCartSubmitControl()) {
                  quantityDeferredToCart = true;
                  configured.push(
                    `Quantity=${input.quantity} (defer to cart/checkout; no item-page quantity control)`,
                  );
                } else {
                  mismatches.push(
                    `Quantity control not found for ${input.quantity}.`,
                  );
                }
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
              quantityDeferredToCart,
              currentItemNames,
            };
          },
          args: [
            {
              expectedItem,
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
        const configuredCount = (plan: Record<string, unknown>) =>
          Array.isArray(plan.configured) ? plan.configured.length : 0;
        const mismatchCount = (plan: Record<string, unknown>) =>
          Array.isArray(plan.mismatches) ? plan.mismatches.length : 0;
        const bestMatched = plans
          .filter((plan) => plan.matched === true)
          .sort(
            (a, b) =>
              configuredCount(b) - configuredCount(a) ||
              mismatchCount(a) - mismatchCount(b),
          )[0];
        const selected =
          plans.find((plan) => plan.ok === true) ||
          bestMatched;

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
            func: async (requestedQuantity: string | null) => {
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
                const id = el.getAttribute("id");
                return [
                  el.getAttribute("aria-label"),
                  el.getAttribute("title"),
                  el.getAttribute("name"),
                  el.getAttribute("id"),
                  id
                    ? document.querySelector(
                        `label[for="${window.CSS?.escape ? window.CSS.escape(id) : id.replace(/["\\]/g, "\\$&")}"]`,
                      )?.textContent
                    : null,
                  control.value,
                  el.textContent,
                ]
                  .map(display)
                  .filter(Boolean);
              };
              const norm = (value: unknown) => display(value).toLowerCase();
              const triggerEvents = (
                el: HTMLInputElement | HTMLSelectElement,
              ) => {
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("blur", { bubbles: true }));
              };
              const setNativeValue = (
                el: HTMLInputElement | HTMLSelectElement,
                value: string,
              ) => {
                try {
                  el.scrollIntoView({ behavior: "instant", block: "center" });
                  el.focus();
                } catch {
                  // Best-effort for browser and test DOMs.
                }
                if (el instanceof HTMLSelectElement) {
                  const option = [...el.options].find(
                    (candidate) =>
                      norm(candidate.value) === norm(value) ||
                      norm(candidate.textContent) === norm(value),
                  );
                  if (!option) return false;
                  el.value = option.value;
                  triggerEvents(el);
                  return true;
                }
                el.value = value;
                triggerEvents(el);
                return norm(el.value) === norm(value);
              };
              const setCartQuantity = () => {
                if (!requestedQuantity) return null;
                const controls = [
                  ...document.querySelectorAll(
                    "select, input:not([type='button']):not([type='submit']):not([type='hidden'])",
                  ),
                ] as Array<HTMLInputElement | HTMLSelectElement>;
                const quantityControl = controls.find((el) =>
                  labelsFor(el).some((label) => /\b(quantity|qty)\b/i.test(label)),
                );
                if (!quantityControl) return false;
                return setNativeValue(quantityControl, requestedQuantity);
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
                  const quantityConfigured = setCartQuantity();
                  if (quantityConfigured === true) {
                    await sleep(500);
                  }
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
                    quantityConfigured,
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
                quantityConfigured: setCartQuantity(),
              };
            },
            args: [quantity],
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
          Array.isArray(selected.currentItemNames) &&
          selected.currentItemNames.length > 0
            ? `Current catalog item: ${selected.currentItemNames.map(String).slice(0, 3).join(" | ")}`
            : "",
          selected.cartReady === true
            ? "Cart/order controls are already visible. Do not add the same item again; inspect cart state and proceed only if line count and quantity match the request."
            : "",
          selected.submitClicked
            ? `Clicked submit control: ${String(selected.submitLabel || "submit")}`
            : "",
          checkoutClick?.quantityConfigured === true
            ? `Configured cart quantity: ${quantity}`
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

  // Registration order is catalog order; keep this at its ordinal position —
  // grouping it with open_servicenow_module above would shift the catalog.
  registerConfigureServiceNowFormTool(toolRegistry);

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

      return formatProfileFieldsForToolResult(
        await resolveProfileFields(fields),
      );
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
        const win = await chromeWindowsPort.create(url ? { url } : {});
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
