import { describe, test, expect, beforeEach, mock } from "bun:test";
import "../setup";
import { useStore } from "../../src/sidepanel/store";
import { initializeBridge } from "../../src/sidepanel/bridge";
import { AgentStatus, MessageSource } from "../../src/types";

/**
 * Helper: capture the listener registered via chrome.runtime.onMessage.addListener
 * so we can dispatch messages to it manually.
 */
let capturedListener: ((message: any) => void) | null = null;

describe("Bridge Message Routing", () => {
    beforeEach(() => {
        capturedListener = null;

        globalThis.chrome = globalThis.chrome || {} as any;
        globalThis.chrome.runtime = {
            onMessage: {
                addListener: mock((fn: any) => { capturedListener = fn; }),
                removeListener: mock(() => {}),
            },
            sendMessage: mock(async () => {}),
        } as any;
        globalThis.chrome.storage = {
            session: { get: mock(async () => ({})), set: mock(async () => {}) },
            local: { get: mock(async () => ({})), set: mock(async () => {}) },
            sync: { get: mock(async () => ({})), set: mock(async () => {}) },
        } as any;

        useStore.setState({
            messages: [],
            agentStatus: AgentStatus.IDLE,
            statusDetail: "Ready",
            inputText: "",
            isAgentRunning: false,
            error: null,
            taskProgress: null,
            taskCompletion: null,
            stuckState: null,
            turnProgress: null,
            settings: {
                cerebrasApiKey: "",
                openRouterApiKey: "",
                maxTurns: 30,
                contextWindowSize: 128000,
                memoryEnabled: true,
                workspaceEnabled: true,
                theme: "system",
                showElementTags: false,
                speedMode: false,
            },
        });
    });

    function setupBridge() {
        const onScreenshot = mock(() => {});
        const onClose = mock(() => {});
        const cleanup = initializeBridge(useStore, { onScreenshot, onClose });
        return { onScreenshot, onClose, cleanup };
    }

    function send(type: string, payload: any) {
        capturedListener!({
            type,
            requestId: "test-req",
            source: MessageSource.BACKGROUND,
            payload,
        });
    }

    test("registers and unregisters listener", () => {
        const { cleanup } = setupBridge();
        expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
        cleanup();
        expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    });

    test("ignores messages not from BACKGROUND", () => {
        setupBridge();
        capturedListener!({
            type: "AGENT_STATUS",
            requestId: "x",
            source: MessageSource.SIDEPANEL,
            payload: { status: AgentStatus.THINKING, detail: "test" },
        });
        // Status should NOT have changed
        expect(useStore.getState().agentStatus).toBe(AgentStatus.IDLE);
    });

    test("AGENT_STATUS updates status and running state", () => {
        setupBridge();
        send("AGENT_STATUS", { status: AgentStatus.THINKING, detail: "Analyzing..." });

        expect(useStore.getState().agentStatus).toBe(AgentStatus.THINKING);
        expect(useStore.getState().statusDetail).toBe("Analyzing...");
        expect(useStore.getState().isAgentRunning).toBe(true);
    });

    test("AGENT_STATUS IDLE clears running, stuckState, and turnProgress", () => {
        // Pre-set some state
        useStore.getState().setAgentRunning(true);
        useStore.getState().setStuckState({
            signal: "nudge",
            staleTurns: 6,
            url: "https://example.com",
            receivedAt: Date.now(),
        });
        useStore.getState().setTurnProgress({ turn: 10, maxTurns: 30 });

        setupBridge();
        send("AGENT_STATUS", { status: AgentStatus.IDLE, detail: "Done" });

        expect(useStore.getState().isAgentRunning).toBe(false);
        expect(useStore.getState().stuckState).toBeNull();
        expect(useStore.getState().turnProgress).toBeNull();
    });

    test("AGENT_STATUS ERROR clears running state", () => {
        useStore.getState().setAgentRunning(true);
        setupBridge();
        send("AGENT_STATUS", { status: AgentStatus.ERROR, detail: "Failed" });

        expect(useStore.getState().isAgentRunning).toBe(false);
    });

    test("AGENT_STUCK nudge sets stuck state", () => {
        setupBridge();
        send("AGENT_STUCK", {
            signal: "nudge",
            staleTurns: 6,
            url: "https://example.com/page",
            message: "Agent appears stuck",
        });

        const stuck = useStore.getState().stuckState;
        expect(stuck).not.toBeNull();
        expect(stuck!.signal).toBe("nudge");
        expect(stuck!.staleTurns).toBe(6);
        expect(stuck!.url).toBe("https://example.com/page");
    });

    test("AGENT_STUCK escalate sets stuck state with escalate signal", () => {
        setupBridge();
        send("AGENT_STUCK", {
            signal: "escalate",
            staleTurns: 12,
            url: "https://example.com",
            message: "Agent is stuck",
        });

        expect(useStore.getState().stuckState!.signal).toBe("escalate");
        expect(useStore.getState().stuckState!.staleTurns).toBe(12);
    });

    test("AGENT_STUCK resolved clears stuck state", () => {
        useStore.getState().setStuckState({
            signal: "nudge",
            staleTurns: 6,
            url: "https://example.com",
            receivedAt: Date.now(),
        });

        setupBridge();
        send("AGENT_STUCK", {
            signal: "resolved",
            staleTurns: 0,
            url: "https://example.com",
            message: "",
        });

        expect(useStore.getState().stuckState).toBeNull();
    });

    test("AGENT_TURN sets turn progress", () => {
        setupBridge();
        send("AGENT_TURN", { turn: 5, maxTurns: 30 });

        expect(useStore.getState().turnProgress).toEqual({ turn: 5, maxTurns: 30 });
    });

    test("TASK_PROGRESS sets task progress", () => {
        setupBridge();
        const payload = {
            taskId: "t1",
            subtasks: [{ description: "Step 1", status: "running", turnsUsed: 2, turnBudget: 20 }],
            currentIndex: 0,
            totalTurnsUsed: 2,
        };
        send("TASK_PROGRESS", payload);

        expect(useStore.getState().taskProgress).toEqual(payload);
    });

    test("TASK_COMPLETION sets completion and clears progress", () => {
        useStore.getState().setTaskProgress({
            taskId: "t1",
            subtasks: [],
            currentIndex: 0,
            totalTurnsUsed: 0,
        });

        setupBridge();
        const payload = {
            taskId: "t1",
            status: "completed",
            summary: "Done",
            totalTurnsUsed: 10,
            subtaskResults: [],
        };
        send("TASK_COMPLETION", payload);

        expect(useStore.getState().taskCompletion).toEqual(payload);
        // setTaskCompletion also clears taskProgress
        expect(useStore.getState().taskProgress).toBeNull();
    });

    test("STREAM_CHUNK delta appends to streaming message", () => {
        // Add a streaming assistant message
        useStore.getState().addMessage({
            id: "a1",
            role: "assistant",
            content: "Hello",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: true,
        });

        setupBridge();
        send("STREAM_CHUNK", { delta: " world", done: false });

        expect(useStore.getState().messages[0].content).toBe("Hello world");
    });

    test("STREAM_CHUNK done finalizes streaming", () => {
        useStore.getState().addMessage({
            id: "a1",
            role: "assistant",
            content: "Complete",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: true,
        });

        setupBridge();
        send("STREAM_CHUNK", { delta: null, done: true });

        expect(useStore.getState().messages[0].isStreaming).toBe(false);
    });

    test("SCREENSHOT_CAPTURED calls onScreenshot callback", () => {
        const { onScreenshot } = setupBridge();
        const payload = { dataUrl: "data:image/png;base64,abc", context: "test", timestamp: 123 };
        send("SCREENSHOT_CAPTURED", payload);

        expect(onScreenshot).toHaveBeenCalledWith(payload);
    });
});
