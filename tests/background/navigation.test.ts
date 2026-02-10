/**
 * Navigation Bridge Tests
 * Tests for state persistence, event handling, and resumption logic.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";

// Mock chrome APIs
const mockStorage = new Map<string, any>();

globalThis.chrome = {
    storage: {
        local: {
            get: mock(async (key: string) => {
                const value = mockStorage.get(key);
                return value ? { [key]: value } : {};
            }),
            set: mock(async (items: Record<string, any>) => {
                for (const [key, value] of Object.entries(items)) {
                    mockStorage.set(key, value);
                }
            }),
            remove: mock(async (key: string) => {
                mockStorage.delete(key);
            }),
        },
    },
    runtime: {
        sendMessage: mock(async () => { }),
        onStartup: { addListener: mock(() => { }) },
    },
    webNavigation: {
        onCompleted: { addListener: mock(() => { }) },
        onErrorOccurred: { addListener: mock(() => { }) },
    },
    tabs: {
        onRemoved: { addListener: mock(() => { }) },
        TAB_ID_NONE: -1,
    },
} as any;

// Import after mocking
import {
    saveNavigationState,
    loadNavigationState,
    clearNavigationState,
    checkStaleNavigationState,
    registerNavigationListeners,
    setNavigationCallbacks,
} from "../../src/background/navigation";
import { AgentStatus, AgentLoopState } from "../../src/types";

describe("Navigation Bridge", () => {
    beforeEach(() => {
        mockStorage.clear();
    });

    const createMockState = (): AgentLoopState => ({
        status: AgentStatus.THINKING,
        messages: [
            { role: "user", content: "Navigate to google.com" },
            { role: "assistant", content: null, tool_calls: [] },
        ],
        originalQuery: "Navigate to google.com",
        turnCount: 1,
        maxTurns: 10,
        activeTabId: 123,
        workspaceId: null,
        lastActivityTs: Date.now(),
        pendingToolCall: {
            toolCallId: "call_123",
            toolName: "navigate" as any,
            args: { url: "https://google.com" },
            expectedUrl: "https://google.com",
        },
    });

    describe("saveNavigationState", () => {
        test("saves state to chrome.storage.local", async () => {
            const state = createMockState();
            await saveNavigationState(state, "https://example.com", "https://google.com");

            const stored = await loadNavigationState();
            expect(stored).not.toBeNull();
            expect(stored?.fromUrl).toBe("https://example.com");
            expect(stored?.toUrl).toBe("https://google.com");
            expect(stored?.agentState.status).toBe(AgentStatus.WAITING_FOR_PAGE_LOAD);
        });

        test("sets correct timeout value", async () => {
            const state = createMockState();
            await saveNavigationState(state, "https://example.com", null);

            const stored = await loadNavigationState();
            expect(stored?.timeoutMs).toBe(30_000);
        });
    });

    describe("loadNavigationState", () => {
        test("returns null when no state exists", async () => {
            const state = await loadNavigationState();
            expect(state).toBeNull();
        });

        test("retrieves saved state", async () => {
            const state = createMockState();
            await saveNavigationState(state, "https://a.com", "https://b.com");

            const loaded = await loadNavigationState();
            expect(loaded).not.toBeNull();
            expect(loaded?.agentState.activeTabId).toBe(123);
        });
    });

    describe("clearNavigationState", () => {
        test("removes state from storage", async () => {
            const state = createMockState();
            await saveNavigationState(state, "https://a.com", null);

            await clearNavigationState();

            const loaded = await loadNavigationState();
            expect(loaded).toBeNull();
        });
    });

    describe("checkStaleNavigationState", () => {
        test("cleans up expired state", async () => {
            // Create state with old timestamp
            const state = createMockState();
            await saveNavigationState(state, "https://a.com", null);

            // Manually age the state
            const stored = mockStorage.get("qsidebar:agentState");
            stored.navigationStartTs = Date.now() - 60_000; // 60 seconds ago
            mockStorage.set("qsidebar:agentState", stored);

            await checkStaleNavigationState();

            const loaded = await loadNavigationState();
            expect(loaded).toBeNull();
        });

        test("keeps fresh state", async () => {
            const state = createMockState();
            await saveNavigationState(state, "https://a.com", null);

            await checkStaleNavigationState();

            const loaded = await loadNavigationState();
            expect(loaded).not.toBeNull();
        });
    });

    describe("registerNavigationListeners", () => {
        test("registers all listeners", () => {
            registerNavigationListeners();

            expect(chrome.webNavigation.onCompleted.addListener).toHaveBeenCalled();
            expect(chrome.webNavigation.onErrorOccurred.addListener).toHaveBeenCalled();
            expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalled();
        });
    });

    describe("setNavigationCallbacks", () => {
        test("sets callbacks without error", () => {
            const resumeCallback = mock(() => { });
            const statusCallback = mock(() => { });

            expect(() => {
                setNavigationCallbacks(resumeCallback, statusCallback);
            }).not.toThrow();
        });
    });
});
