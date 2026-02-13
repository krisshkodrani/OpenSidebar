import { describe, test, expect, mock, beforeEach } from "bun:test";
import "../setup";
import { AgentStatus, OverlayDescriptor } from "../../src/types";

// Track fetch calls for LLM fallback
const fetchMock = mock(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
        choices: [{ message: { content: '{"action":"hide"}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0001 },
    }),
}));
(globalThis as any).fetch = fetchMock;

// Mock modules before importing AgentLoop
mock.module("../../src/background/llm", () => ({
    LLMClient: class {
        private model = "google/gemini-2.5-flash-lite";
        complete = mock(() => Promise.resolve({
            role: "assistant",
            content: "done",
            tool_calls: undefined,
            finish_reason: "stop",
        }));
        completeStream = mock((_req: any, onDelta: (d: string) => void) => {
            onDelta("ok");
            return Promise.resolve({
                role: "assistant",
                content: "ok",
                tool_calls: [{
                    id: "call_1",
                    type: "function",
                    function: { name: "done", arguments: '{"summary":"done"}' },
                }],
                finish_reason: "stop",
            });
        });
        switchModel = mock((m: string) => { this.model = m; });
        getCurrentModel = () => this.model;
    },
    MODEL_FAST: "google/gemini-2.5-flash-lite",
    MODEL_SMART: "minimax/minimax-m2.5",
    stripThinkTags: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

mock.module("../../src/background/keepalive", () => ({
    startKeepalive: mock(async () => {}),
    stopKeepalive: mock(async () => {}),
}));

import { AgentLoop } from "../../src/background/agent/loop";

// Track chrome.tabs.sendMessage calls
let tabMessages: any[] = [];
const originalTabsSendMessage = chrome.tabs.sendMessage;

function createLoop() {
    const onStatus = mock();
    const onMessage = mock();
    const onStep = mock();
    const agent = new AgentLoop("test-key", {
        onStatusUpdate: onStatus,
        onMessage: onMessage,
        onStep: onStep,
    }, { maxTurns: 3 });
    return { agent, onStatus, onMessage, onStep };
}

describe("Overlay LLM Fallback in Agent Loop", () => {
    beforeEach(() => {
        tabMessages = [];
        fetchMock.mockClear();
        // Override chrome.tabs.sendMessage to track calls and return appropriate responses
        (chrome.tabs as any).sendMessage = mock(async (_tabId: number, msg: any) => {
            tabMessages.push(msg);
            if (msg.type === "DISMISS_MODALS" && !msg.payload?.clickSelector) {
                // Return response with no remaining overlay
                return {
                    type: "DISMISS_MODALS_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { dismissed: 0, remainingOverlay: null },
                };
            }
            if (msg.type === "DISMISS_MODALS" && msg.payload?.clickSelector) {
                return {
                    type: "DISMISS_MODALS_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { dismissed: 1, remainingOverlay: null },
                };
            }
            if (msg.type === "DOM_SNAPSHOT_REQUEST") {
                return {
                    type: "DOM_SNAPSHOT_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: {
                        snapshot: {
                            title: "Test",
                            url: "https://test.com",
                            elements: [],
                            viewportText: "",
                            viewport: { width: 1024, height: 768 },
                            scroll: { x: 0, y: 0, maxY: 0 },
                        },
                        durationMs: 1,
                    },
                };
            }
            if (msg.type === "TOOL_EXECUTE") {
                return {
                    type: "TOOL_RESULT",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { toolCallId: msg.payload.toolCallId, success: true, result: "Hidden", navigated: false },
                };
            }
            return { payload: { result: "ok" } };
        });
    });

    test("no LLM call when remainingOverlay is null", async () => {
        const { agent } = createLoop();
        // Default mock returns remainingOverlay: null
        await agent.start("test", 123, undefined, { clearHistory: true });

        // fetch should not be called for overlay dismissal
        // (it may be called by LLMClient.completeStream, so check the URL)
        const overlayFetchCalls = fetchMock.mock.calls.filter((call: any[]) =>
            typeof call[0] === "string" && call[0].includes("openrouter")
        );
        // No overlay-specific fetch (the mock LLMClient doesn't use fetch)
        expect(overlayFetchCalls.length).toBe(0);
    });

    test("LLM call triggered when remainingOverlay is present", async () => {
        const overlay: OverlayDescriptor = {
            html: '<div class="weird-modal"><button>Accept</button></div>',
            tagId: 42,
            rect: { x: 0, y: 0, width: 1024, height: 768 },
            coveragePercent: 95,
        };

        // Return overlay on first dismiss call
        let firstCall = true;
        (chrome.tabs as any).sendMessage = mock(async (_tabId: number, msg: any) => {
            tabMessages.push(msg);
            if (msg.type === "DISMISS_MODALS" && !msg.payload?.clickSelector) {
                if (firstCall) {
                    firstCall = false;
                    return {
                        type: "DISMISS_MODALS_RESPONSE",
                        requestId: msg.requestId,
                        source: "content",
                        payload: { dismissed: 0, remainingOverlay: overlay },
                    };
                }
                return {
                    type: "DISMISS_MODALS_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { dismissed: 1, remainingOverlay: null },
                };
            }
            if (msg.type === "DISMISS_MODALS" && msg.payload?.clickSelector) {
                return {
                    type: "DISMISS_MODALS_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { dismissed: 1, remainingOverlay: null },
                };
            }
            if (msg.type === "DOM_SNAPSHOT_REQUEST") {
                return {
                    type: "DOM_SNAPSHOT_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: {
                        snapshot: {
                            title: "Test",
                            url: "https://test.com",
                            elements: [],
                            viewportText: "",
                            viewport: { width: 1024, height: 768 },
                            scroll: { x: 0, y: 0, maxY: 0 },
                        },
                        durationMs: 1,
                    },
                };
            }
            if (msg.type === "TOOL_EXECUTE") {
                return {
                    type: "TOOL_RESULT",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { toolCallId: msg.payload.toolCallId, success: true, result: "Hidden", navigated: false },
                };
            }
            return { payload: { result: "ok" } };
        });

        // Mock fetch to return "hide" action
        fetchMock.mockImplementation(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                choices: [{ message: { content: '{"action":"hide"}' } }],
                usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0001 },
            }),
        } as any));

        // Override storage to return a key
        (chrome.storage.sync as any).get = mock(async () => ({
            userSettings: { openRouterApiKey: "test-key" },
        }));

        const { agent } = createLoop();
        await agent.start("test", 123, undefined, { clearHistory: true });

        // fetch should have been called for the overlay LLM
        expect(fetchMock).toHaveBeenCalled();

        // Should have sent a TOOL_EXECUTE for hide_element
        const hideMsg = tabMessages.find(
            m => m.type === "TOOL_EXECUTE" && m.payload?.toolName === "hide_element"
        );
        expect(hideMsg).toBeDefined();
        expect(hideMsg.payload.args.id).toBe(42);
    });

    test("LLM click response sends DISMISS_MODALS with clickSelector", async () => {
        const overlay: OverlayDescriptor = {
            html: '<div><button class="accept-btn">Accept All</button></div>',
            tagId: 7,
            rect: { x: 0, y: 0, width: 800, height: 600 },
            coveragePercent: 80,
        };

        let firstCall = true;
        (chrome.tabs as any).sendMessage = mock(async (_tabId: number, msg: any) => {
            tabMessages.push(msg);
            if (msg.type === "DISMISS_MODALS" && !msg.payload?.clickSelector) {
                if (firstCall) {
                    firstCall = false;
                    return {
                        type: "DISMISS_MODALS_RESPONSE",
                        requestId: msg.requestId,
                        source: "content",
                        payload: { dismissed: 0, remainingOverlay: overlay },
                    };
                }
            }
            if (msg.type === "DISMISS_MODALS" && msg.payload?.clickSelector) {
                return {
                    type: "DISMISS_MODALS_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { dismissed: 1, remainingOverlay: null },
                };
            }
            if (msg.type === "DOM_SNAPSHOT_REQUEST") {
                return {
                    type: "DOM_SNAPSHOT_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: {
                        snapshot: {
                            title: "Test",
                            url: "https://test.com",
                            elements: [],
                            viewportText: "",
                            viewport: { width: 1024, height: 768 },
                            scroll: { x: 0, y: 0, maxY: 0 },
                        },
                        durationMs: 1,
                    },
                };
            }
            if (msg.type === "TOOL_EXECUTE") {
                return {
                    type: "TOOL_RESULT",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { toolCallId: msg.payload.toolCallId, success: true, result: "OK", navigated: false },
                };
            }
            return { payload: { result: "ok" } };
        });

        // Mock fetch to return "click" action
        fetchMock.mockImplementation(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                choices: [{ message: { content: '{"action":"click","selector":".accept-btn"}' } }],
                usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, cost: 0.0001 },
            }),
        } as any));

        (chrome.storage.sync as any).get = mock(async () => ({
            userSettings: { openRouterApiKey: "test-key" },
        }));

        const { agent } = createLoop();
        await agent.start("test", 123, undefined, { clearHistory: true });

        // Should have sent DISMISS_MODALS with clickSelector
        const clickMsg = tabMessages.find(
            m => m.type === "DISMISS_MODALS" && m.payload?.clickSelector === ".accept-btn"
        );
        expect(clickMsg).toBeDefined();
        expect(clickMsg.payload.overlayTagId).toBe(7);
    });

    test("LLM timeout causes agent to proceed normally", async () => {
        const overlay: OverlayDescriptor = {
            html: '<div>Modal</div>',
            tagId: 99,
            rect: { x: 0, y: 0, width: 1024, height: 768 },
            coveragePercent: 90,
        };

        let firstCall = true;
        (chrome.tabs as any).sendMessage = mock(async (_tabId: number, msg: any) => {
            tabMessages.push(msg);
            if (msg.type === "DISMISS_MODALS" && !msg.payload?.clickSelector) {
                if (firstCall) {
                    firstCall = false;
                    return {
                        type: "DISMISS_MODALS_RESPONSE",
                        requestId: msg.requestId,
                        source: "content",
                        payload: { dismissed: 0, remainingOverlay: overlay },
                    };
                }
            }
            if (msg.type === "DOM_SNAPSHOT_REQUEST") {
                return {
                    type: "DOM_SNAPSHOT_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: {
                        snapshot: {
                            title: "Test",
                            url: "https://test.com",
                            elements: [],
                            viewportText: "",
                            viewport: { width: 1024, height: 768 },
                            scroll: { x: 0, y: 0, maxY: 0 },
                        },
                        durationMs: 1,
                    },
                };
            }
            if (msg.type === "TOOL_EXECUTE") {
                return {
                    type: "TOOL_RESULT",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { toolCallId: msg.payload.toolCallId, success: true, result: "OK", navigated: false },
                };
            }
            return { payload: { result: "ok" } };
        });

        // Mock fetch to reject (simulate timeout)
        fetchMock.mockImplementation(() => Promise.reject(new Error("Timeout")));

        (chrome.storage.sync as any).get = mock(async () => ({
            userSettings: { openRouterApiKey: "test-key" },
        }));

        const { agent } = createLoop();
        // Should not throw — error is caught silently
        const result = await agent.start("test", 123, undefined, { clearHistory: true });
        expect(result).toBeDefined();
        expect(result.outcome).toBeDefined();
    });

    test("LLM parse failure causes agent to proceed normally", async () => {
        const overlay: OverlayDescriptor = {
            html: '<div>Modal</div>',
            tagId: 50,
            rect: { x: 0, y: 0, width: 1024, height: 768 },
            coveragePercent: 85,
        };

        let firstCall = true;
        (chrome.tabs as any).sendMessage = mock(async (_tabId: number, msg: any) => {
            tabMessages.push(msg);
            if (msg.type === "DISMISS_MODALS" && !msg.payload?.clickSelector) {
                if (firstCall) {
                    firstCall = false;
                    return {
                        type: "DISMISS_MODALS_RESPONSE",
                        requestId: msg.requestId,
                        source: "content",
                        payload: { dismissed: 0, remainingOverlay: overlay },
                    };
                }
            }
            if (msg.type === "DOM_SNAPSHOT_REQUEST") {
                return {
                    type: "DOM_SNAPSHOT_RESPONSE",
                    requestId: msg.requestId,
                    source: "content",
                    payload: {
                        snapshot: {
                            title: "Test",
                            url: "https://test.com",
                            elements: [],
                            viewportText: "",
                            viewport: { width: 1024, height: 768 },
                            scroll: { x: 0, y: 0, maxY: 0 },
                        },
                        durationMs: 1,
                    },
                };
            }
            if (msg.type === "TOOL_EXECUTE") {
                return {
                    type: "TOOL_RESULT",
                    requestId: msg.requestId,
                    source: "content",
                    payload: { toolCallId: msg.payload.toolCallId, success: true, result: "OK", navigated: false },
                };
            }
            return { payload: { result: "ok" } };
        });

        // Mock fetch to return unparseable response
        fetchMock.mockImplementation(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                choices: [{ message: { content: "I don't know what to do" } }],
                usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
            }),
        } as any));

        (chrome.storage.sync as any).get = mock(async () => ({
            userSettings: { openRouterApiKey: "test-key" },
        }));

        const { agent } = createLoop();
        // Should not throw — JSON.parse failure is caught
        const result = await agent.start("test", 123, undefined, { clearHistory: true });
        expect(result).toBeDefined();
        expect(result.outcome).toBeDefined();
    });
});
