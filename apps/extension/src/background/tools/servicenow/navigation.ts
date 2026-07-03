/**
 * ServiceNow adapter — module navigation and record-list access.
 *
 * Grounded in stable platform semantics: the application navigator
 * (All menu), module targets (classic UI and workspace shell), table
 * record fetches, and DOM-snapshot-based candidate scoring. Consumed
 * by the open_servicenow_module tool executor and by generic list
 * tools when they operate on a ServiceNow origin.
 *
 * Import-direction rule: servicenow/* must never import "../index" or
 * the "../tools" barrel — only ../helpers and concrete siblings.
 */

import {
  DomSnapshot,
  TaggedElement,
  ToolName,
  MessageSource,
  EvidenceEvent,
} from "../../../types";
import { executeContentTool, waitForNavigation } from "../bridge";
import { getTabUrl, getFrameIdsForMainWorldBridge } from "../helpers";
import {
  ensureContentScript,
  waitForContentScriptReady,
  waitForDomReady,
  clearTabReady,
} from "../../tab-ready";
import {
  unwrapServiceNowFieldValue,
  unwrapServiceNowDisplayValue,
  normalizeServiceNowReferenceKey,
  cleanServiceNowQueryValue,
  shouldRetryServiceNowLookupInPage,
} from "./common";

export type ServiceNowModuleRecord = {
  sysId: string;
  title: string;
  application: string;
  name: string;
  table: string;
  linkType: string;
  targetHints: string[];
  raw: Record<string, unknown>;
};

export type ResolvedServiceNowModule = {
  ok: true;
  module: ServiceNowModuleRecord;
  target: string;
  targetUrl: string;
  candidateCount: number;
  score: number;
  candidates: ServiceNowModuleRecord[];
};

export type ServiceNowModuleResolutionFailure = {
  ok: false;
  reason: string;
  candidateCount?: number;
  candidates?: ServiceNowModuleRecord[];
};

export type ServiceNowNavigatorCandidateResult =
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

export type ServiceNowCurrentModuleMatch =
  | {
      ok: true;
      title: string;
      url: string;
      target: string;
      matchedBy: string[];
    }
  | { ok: false; reason: string };

export type ServiceNowSnapshotElementCandidate = {
  element: TaggedElement;
  label: string;
  href: string;
  score: number;
};

export type TimedServiceNowResult<T> = {
  value?: T;
  error?: string;
  durationMs: number;
};

export function isServiceNowOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "service-now.com" || host.endsWith(".service-now.com");
  } catch {
    return false;
  }
}

export function parseServiceNowModuleRecord(
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

export function serviceNowMatchKey(value: string): string {
  return normalizeServiceNowReferenceKey(value).replace(/_/g, "");
}

export function stripServiceNowShellTarget(value: string): string {
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

export function candidateLooksLikeServiceNowTarget(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^javascript:/i.test(trimmed)) return false;
  return (
    /\.do(?:\?|$)/i.test(trimmed) ||
    /^\$?[a-z0-9_]+(?:_list)?\.do(?:\?|$)/i.test(trimmed) ||
    /^(?:kb|sp|catalog|com\.glideapp)\?/i.test(trimmed)
  );
}

export function buildServiceNowTargetUrlFromHref(
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

export function serviceNowHrefHasTruncatedModuleParam(href: string): boolean {
  const match = /(?:[?&])sysparm_userpref_module=([0-9a-f]{1,31})(?:$|[&#])/i.exec(
    href,
  );
  return Boolean(match);
}

export function appendServiceNowModuleParam(target: string, sysId: string): string {
  if (!sysId || /(?:^|[?&])sysparm_userpref_module=/i.test(target)) {
    return target;
  }
  return `${target}${target.includes("?") ? "&" : "?"}sysparm_userpref_module=${encodeURIComponent(sysId)}`;
}

export function buildServiceNowModuleTarget(
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

export function scoreServiceNowModuleCandidate(
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

export function serviceNowModuleMatchesLeaf(
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

export async function getServiceNowTabOrigin(
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

export function decodeServiceNowClassicTarget(url: string): string {
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

export async function detectAlreadyOpenServiceNowModule(
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

export async function fetchServiceNowTableRecords(
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

export async function fetchServiceNowTableRecordsFromPage(
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

export async function requestServiceNowDomSnapshot(
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

export async function waitForServiceNowDomSnapshot(
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

export function serviceNowSnapshotElementLabel(element: TaggedElement): string {
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

export function findServiceNowAllMenuButton(
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

export function findServiceNowAllMenuFilter(
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

export function scoreServiceNowSnapshotModuleCandidate(
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

export function selectServiceNowSnapshotModuleCandidate(
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

export async function prepareServiceNowSnapshotNavigatorCandidate(
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

export async function prepareServiceNowNavigatorCandidate(
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

export async function withServiceNowTiming<T>(
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

export function formatServiceNowDuration(durationMs: number): string {
  return `${Math.max(0, Math.round(durationMs))}ms`;
}

export function summarizeServiceNowMetadataOutcome(
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

export function summarizeServiceNowNavigatorOutcome(
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

export function serviceNowModuleEvidence(
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

export async function commitResolvedServiceNowModule(
  tabId: number,
  resolved: ResolvedServiceNowModule,
): Promise<void> {
  clearTabReady(tabId);
  await chrome.tabs.update(tabId, { url: resolved.targetUrl });
  await waitForNavigation(tabId, 10_000);
  await waitForContentScriptReady(tabId, 2_000);
}

export async function commitServiceNowNavigatorCandidate(
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

export async function resolveServiceNowModule(
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

export function summarizeServiceNowModuleCandidates(
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
