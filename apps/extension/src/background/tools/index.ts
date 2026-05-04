import { toolRegistry } from "./registry";
import {
  EvidenceEvent,
  ToolName,
  MessageSource,
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
  if (!/^[a-z0-9_]+$/i.test(tableName) || !/^[A-Z]{2,}\d+$/i.test(recordNumber)) {
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
        const record = Array.isArray(payload?.result) ? payload.result[0] : null;
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
        .find((value): value is string => typeof value === "string" && value.length > 0) ??
      null
    );
  } catch {
    return null;
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
    }
  | { ok: false; reason: string };

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
      const targetMatch = /\/now\/nav\/ui\/classic\/params\/target\/(.+)$/i.exec(
        parsed.pathname,
      );
      if (targetMatch?.[1]) {
        return decodeURIComponent(targetMatch[1]) + parsed.search;
      }
      return `${parsed.pathname.replace(/^\/+/, "")}${parsed.search}`;
    } catch {
      const targetMatch = /\/now\/nav\/ui\/classic\/params\/target\/(.+)$/i.exec(
        candidate,
      );
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
  else if (titleKey.includes(leafKey) || leafKey.includes(titleKey)) score += 55;
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
          const response = await fetch(
            url,
            {
              credentials: "same-origin",
              headers: { Accept: "application/json" },
              signal: controller.signal,
            },
          );
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
      | ({ ok: true; query: string; candidateText: string; href: string } | {
          ok: false;
          reason: string;
        })
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
): Promise<"navigator_href" | "navigator_click" | "navigator_click_unavailable"> {
  clearTabReady(tabId);
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
            pageError instanceof Error ? pageError.message : "module_lookup_failed",
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

      if (!shouldRun) {
        const resolved = await resolveServiceNowModule(tabId, application, path);
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

      const originResult = await getServiceNowTabOrigin(tabId);
      if (!originResult.ok) {
        return [
          `Error: Could not resolve ServiceNow module (${originResult.reason}).`,
          `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
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
        prepareServiceNowNavigatorCandidate(
          tabId,
          originResult.origin,
          application,
          path,
        ),
      ).then((outcome) => ({ source: "navigator" as const, outcome }));

      while (metadataPending || navigatorPending) {
        const next = await Promise.race(
          [
            metadataPending ? metadataPromise : null,
            navigatorPending ? navigatorPromise : null,
          ].filter(
            (
              promise,
            ): promise is
              | typeof metadataPromise
              | typeof navigatorPromise => Boolean(promise),
          ),
        );

        if (next.source === "metadata") {
          metadataPending = false;
          metadataOutcome = next.outcome;
          const resolved = metadataOutcome.value;
          if (resolved?.ok) {
            await commitResolvedServiceNowModule(tabId, resolved);
            return [
              "Opened ServiceNow module.",
              "Winning path: metadata",
              `Application: ${resolved.module.application || application || "unknown"}`,
              `Module: ${resolved.module.title}`,
              `Module sys_id: ${resolved.module.sysId}`,
              `Target: ${resolved.target}`,
              `Target URL: ${resolved.targetUrl}`,
              `Candidate count: ${resolved.candidateCount}`,
              summarizeServiceNowMetadataOutcome(metadataOutcome, raceStartedAt),
              summarizeServiceNowNavigatorOutcome(navigatorOutcome, raceStartedAt),
            ].join("\n");
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
              return [
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
            }
            navigatorCommitFailure = commitPath;
          } catch (error) {
            navigatorCommitFailure =
              error instanceof Error ? error.message : "navigator_commit_failed";
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
            const currentBodyText = () => display(document.body?.innerText || "");
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
                  labelsFor(el).some((label) => pattern.test(label)),
                ) as HTMLElement | undefined;
              if (input.submitButton) {
                const exact = controls.find((el) =>
                  matches(labelsFor(el), input.submitButton as string),
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
                submitLabel =
                  labelsFor(submitControl)[0] ||
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
          selected.cartReady === true
            ? "Cart/order controls are already visible. Do not add the same item again; inspect cart state and proceed only if line count and quantity match the request."
            : "",
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
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
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
              control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
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
            ): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null => {
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
                (candidate): candidate is
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
                    !(control instanceof HTMLInputElement && control.type === "hidden"),
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
                  document.getElementById(`lookup.${fieldPathFor(fieldName, control)}`),
                );
              } catch {
                return false;
              }
            };

            const referenceFor = (fieldName: string, control: Element | null) => {
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
              .querySelectorAll("input[name], select[name], textarea[name], input[id], select[id], textarea[id]")
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
                  displayBox &&
                  displayBox instanceof HTMLInputElement
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
                  candidates.push(...Array.from(document.querySelectorAll(selector)));
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
              if (control instanceof HTMLInputElement && control.type === "checkbox") {
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
                if (typeof obj.display_value === "string") return obj.display_value;
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
              const exactQuery = ["name", "display_name", "number", "user_name", "email"]
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
                const response = await fetch(
                  `/api/now/table/${encodeURIComponent(referenceTable)}?${params.toString()}`,
                  { credentials: "same-origin", headers },
                );
                if (!response.ok) return [];
                const payload = await response.json();
                return Array.isArray(payload?.result) ? payload.result : [];
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
                    (field) => normalize(unwrap(record[field])) === normalize(clean),
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

            const selectReferenceAutocomplete = async (
              field: FieldMeta,
              rawDisplayValue: string,
            ): Promise<{ ok: true } | { ok: false; reason: string }> => {
              const input =
                field.control instanceof HTMLInputElement ? field.control : null;
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
                return { ok: true };
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
                    if (sysId && commitReferenceValue(field, sysId, displayValue)) {
                      await delay(100);
                      if (
                        isCommittedReferenceValue(
                          readCommittedReferenceValue(field),
                          displayValue,
                          sysId,
                        )
                      ) {
                        return { ok: true };
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
                        return { ok: true };
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
                  return { ok: true };
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
            ): Promise<{ ok: true } | { ok: false; reason: string }> => {
              const desired = value;
              const choiceControl =
                field.control instanceof HTMLSelectElement ? field.control : null;
              if (choiceControl) {
                const option =
                  Array.from(choiceControl.options).find(
                    (candidate) =>
                      normalize(candidate.textContent) === normalize(desired) ||
                      normalize(candidate.value) === normalize(desired),
                  ) ??
                  Array.from(choiceControl.options).find((candidate) =>
                    normalize(candidate.textContent).includes(normalize(desired)),
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
                  return { ok: true };
                }

                const resolved = await resolveReference(referenceTable, desired);
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
                    return { ok: true };
                  }
                }

                const selected = await selectReferenceAutocomplete(field, desired);
                if (selected.ok) return { ok: true };
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
            let configuredRecordNumber = "";
            const mismatches: string[] = [];
            const recordNumberFromText = (value: string): string => {
              return value.match(/\b[A-Z]{2,}\d+\b/i)?.[0]?.toUpperCase() ?? "";
            };
            const isRecordNumberField = (
              field: Pick<FieldMeta, "label" | "name" | "fieldPath">,
              requestedField = "",
            ) => {
              const identity = `${field.label || ""} ${field.name} ${field.fieldPath} ${requestedField}`;
              return /(^|[\s_.-])number($|[\s_.-])/i.test(identity);
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
              const ok =
                setResult.ok &&
                (expected === ""
                  ? actual === "" || /^--\s*none\s*--$/i.test(actual)
                  : normalize(actual) === normalize(expected) ||
                    normalize(actual).includes(normalize(expected)));
              const row = `${field.label || field.name} (${field.name}) = ${actual || "(empty)"}`;
              if (ok) {
                configured.push(row);
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
                return numberField ? recordNumberFromText(readValue(numberField)) : "";
              })();

            const recordFromTitle =
              document.title.match(/\bCreate\s+([A-Z]{2,}\d+)\b/i)?.[1] ||
              document.body?.innerText?.match(/\b(?:Number|Record)\s+([A-Z]{2,}\d+)\b/i)?.[1] ||
              null;
            const tableName =
              (() => {
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
            if (input.submit && mismatches.length === 0) {
              const expected = input.submitButton ? normalize(input.submitButton) : "";
              const isUsableSubmitControl = (control: HTMLElement) => {
                const style = getComputedStyle(control);
                const disabled =
                  "disabled" in control &&
                  Boolean((control as HTMLButtonElement | HTMLInputElement).disabled);
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
                document.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']"),
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
              mismatches,
              submitClicked,
              submitLabel,
              submitMethod,
              submitActionName,
              submittedRecord: submitClicked
                ? currentRecordNumber || recordFromTitle
                : null,
              tableName,
              fieldCount: fieldsMeta.length,
            };
          },
          args: [{ fields, submit, submitButton }],
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
        const mismatches = Array.isArray(selected.mismatches)
          ? selected.mismatches.map(String)
          : [];
        const submittedRecord =
          typeof selected.submittedRecord === "string"
            ? selected.submittedRecord
            : "";
        const tableName =
          typeof selected.tableName === "string" ? selected.tableName : "";
        const currentUrl = tab.url || String(selected.url || "");
        const currentTitle = tab.title || String(selected.title || "");
        const escapeRegExp = (value: string) =>
          value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const submitStayedOnSameCreateRecord =
          submit &&
          submittedRecord &&
          new RegExp(
            `\\b(?:Create|New)\\s+${escapeRegExp(submittedRecord)}\\b`,
            "i",
          ).test(currentTitle);
        const submitVerified =
          !submit || (selected.submitClicked === true && !submitStayedOnSameCreateRecord);
        const effectiveMismatches = [...mismatches];
        if (submit && selected.submitClicked === true && submitStayedOnSameCreateRecord) {
          effectiveMismatches.push(
            `submit did not leave the create form for ${submittedRecord}`,
          );
        }
        const effectiveOk = selected.ok === true && submitVerified;
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
        }
        const lines = [
          effectiveOk
            ? "Configured ServiceNow form."
            : "ServiceNow form configuration incomplete.",
          configured.length ? `Configured:\n- ${configured.join("\n- ")}` : "",
          effectiveMismatches.length
            ? `Mismatches:\n- ${effectiveMismatches.join("\n- ")}`
            : "",
          selected.submitClicked
            ? `Clicked submit control: ${String(selected.submitLabel || "submit")}`
            : "",
          selected.submitMethod
            ? `Submit method: ${String(selected.submitMethod)}${selected.submitActionName ? ` (${String(selected.submitActionName)})` : ""}`
            : "",
          submittedRecord && submitVerified
            ? `Submitted ServiceNow form record: ${submittedRecord}`
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
              submitLabel: String(selected.submitLabel || submitButton || "submit"),
              submitMethod: String(selected.submitMethod || ""),
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
            detail: { reason: "same_create_form_after_submit", submittedRecord },
          });
        }
        if (effectiveOk && submit && submittedRecord) {
          const identity = {
            table: tableName,
            recordNumber: submittedRecord,
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
