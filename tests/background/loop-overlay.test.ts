import { describe, test, expect, mock, beforeEach } from "bun:test";
import "../setup";

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
        switchToSmart = mock(() => { this.model = "minimax/minimax-m2.5"; });
        switchToFast = mock(() => { this.model = "google/gemini-2.5-flash-lite"; });
        getCurrentModel = () => this.model;
        getCurrentProvider = () => "openrouter";
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

function createLoop() {
    const onStatus = mock();
    const onMessage = mock();
    const onStep = mock();
    const agent = new AgentLoop("test-key", undefined, undefined, false, {
        onStatusUpdate: onStatus,
        onMessage: onMessage,
        onStep: onStep,
    }, { maxTurns: 3 });
    return { agent, onStatus, onMessage, onStep };
}

describe("Reactive overlay dismissal — no pre-loop DISMISS_MODALS", () => {
    beforeEach(() => {
        tabMessages = [];
        // Override chrome.tabs.sendMessage to track calls
        (chrome.tabs as any).sendMessage = mock(async (_tabId: number, msg: any) => {
            tabMessages.push(msg);
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
    });

    test("loop does not send DISMISS_MODALS before the first LLM turn", async () => {
        const { agent } = createLoop();
        await agent.start("test", 123, undefined, { clearHistory: true });

        const dismissMessages = tabMessages.filter(m => m.type === "DISMISS_MODALS");
        expect(dismissMessages.length).toBe(0);
    });

    test("loop completes normally without proactive overlay dismissal", async () => {
        const { agent } = createLoop();
        const result = await agent.start("click the button", 123, undefined, { clearHistory: true });

        expect(result).toBeDefined();
        expect(result.outcome).toBeDefined();
        expect(result.turnCount).toBeGreaterThanOrEqual(1);
    });

    test("first message to content script is not DISMISS_MODALS", async () => {
        const { agent } = createLoop();
        await agent.start("test", 123, undefined, { clearHistory: true });

        // The first tab message should NOT be DISMISS_MODALS
        if (tabMessages.length > 0) {
            expect(tabMessages[0].type).not.toBe("DISMISS_MODALS");
        }
    });
});
