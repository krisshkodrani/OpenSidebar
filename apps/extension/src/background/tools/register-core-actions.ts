/**
 * Core action tool registrations (RFC LP-16 Phase 4): wait, done, read_element,
 * extract_form_state, right_click, set_checkbox, click_coordinates, upload_file,
 * go_back, list_tabs. Verbatim movement from tools/index.ts.
 */
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { sanitizeUrl } from "../security";
import { ToolRegistry } from "./registry";
import { executeContentTool, waitForNavigation } from "./bridge";
import { clearTabReady, ensureContentScript, waitForDomReady } from "../tab-ready";
import { formatControllableTabLines, tryInPageHistoryBack, waitForTabUrlChange } from "./tab-navigation-helpers";
import {
    WAIT_DEF,
    DONE_DEF,
    READ_ELEMENT_DEF,
    EXTRACT_FORM_STATE_DEF,
    RIGHT_CLICK_DEF,
    SET_CHECKBOX_DEF,
    CLICK_COORDINATES_DEF,
    UPLOAD_FILE_DEF,
    GO_BACK_DEF,
    LIST_TABS_DEF,
} from "./definitions";

export function registerCoreActionTools(toolRegistry: ToolRegistry): void {
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

    toolRegistry.register(ToolName.READ_ELEMENT, READ_ELEMENT_DEF, (args, tabId) =>
        executeContentTool(ToolName.READ_ELEMENT, args, tabId),
    );

    toolRegistry.register(ToolName.EXTRACT_FORM_STATE, EXTRACT_FORM_STATE_DEF, (args, tabId) =>
        executeContentTool(ToolName.EXTRACT_FORM_STATE, args, tabId),
    );

    toolRegistry.register(ToolName.RIGHT_CLICK, RIGHT_CLICK_DEF, (args, tabId, _signal, toolCallId) =>
        executeContentTool(ToolName.RIGHT_CLICK, args, tabId, undefined, toolCallId),
    );

    toolRegistry.register(ToolName.SET_CHECKBOX, SET_CHECKBOX_DEF, (args, tabId, _signal, toolCallId) =>
        executeContentTool(ToolName.SET_CHECKBOX, args, tabId, undefined, toolCallId),
    );

    toolRegistry.register(ToolName.CLICK_COORDINATES, CLICK_COORDINATES_DEF, (args, tabId, _signal, toolCallId) =>
        executeContentTool(ToolName.CLICK_COORDINATES, args, tabId, undefined, toolCallId),
    );

    toolRegistry.register(ToolName.UPLOAD_FILE, UPLOAD_FILE_DEF, async (args, tabId, _signal, toolCallId) => {
        const url = typeof args.url === "string" ? args.url : "";
        if (!url) return "Error: provide a url for the file to upload.";
        const urlResult = sanitizeUrl(url);
        if (!urlResult.ok) return `Error: ${urlResult.error}`;

        try {
            const response = await fetch(urlResult.value);
            if (!response.ok) return `Error: fetch failed with status ${response.status}`;

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
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            const base64 = btoa(binary);

            const contentType = response.headers.get("content-type") || "application/octet-stream";
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
                undefined,
                toolCallId,
            );
        } catch (e: any) {
            return `Error fetching file: ${e.message}`;
        }
    });

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
                await waitForDomReady(tabId, {
                    timeoutMs: 300,
                    waitForElements: true,
                });
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
        return formatControllableTabLines(tabs).join("\n");
    });
}
