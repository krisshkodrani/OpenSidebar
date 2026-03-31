import { toolRegistry } from "./registry";
import { ToolName, MessageSource } from "../../types";
import { logger } from "../../utils";
import { sanitizeUrl } from "../security";
import { workspaceManager } from "../workspaces/manager";
import {
  clearTabReady,
  ensureContentScript,
  waitForContentScriptReady,
  waitForDomReady,
} from "../tab-ready";
import { DemoStore, formatDemoForContext } from "../demos/store";
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
  XRAY_PAGE_DEF,
  RECALL_DEMO_DEF,
  UPDATE_NOTES_DEF,
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

async function tryInPageHistoryBack(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN" as any,
    func: () => {
      window.history.back();
    },
  });
}

// --- Registration ---

export function registerTools() {
  toolRegistry.register(ToolName.CLICK_ELEMENT, CLICK_DEF, (args, tabId) =>
    executeContentTool(ToolName.CLICK_ELEMENT, args, tabId),
  );
  toolRegistry.register(ToolName.TYPE_TEXT, TYPE_TEXT_DEF, (args, tabId) =>
    executeContentTool(ToolName.TYPE_TEXT, args, tabId),
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
      const url = args.url as string;
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
        logger.warn("tools", "tabs.goBack did not change URL, trying in-page history.back()", {
          tabId,
          previousUrl,
        });
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
        logger.warn("tools", "go_back completed before content script recovered", {
          tabId,
          currentUrl,
        });
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

  // Demo recall tool
  toolRegistry.register(ToolName.RECALL_DEMO, RECALL_DEMO_DEF, async (args) => {
    const query = args.query as string;
    if (!query || !query.trim()) return "Error: query is required.";
    logger.info("tools", "recall_demo", { query });
    try {
      const demoStore = new DemoStore();
      const demo = await demoStore.findByQuery(query);
      if (!demo) return `No demonstration found matching "${query}".`;
      await demoStore.recordDemoUsage(demo.id);
      return formatDemoForContext(demo);
    } catch (e: any) {
      return `Error recalling demo: ${e.message}`;
    }
  });

  logger.info(
    "tools",
    `${toolRegistry.getDefinitions().length} tools registered`,
  );
}
