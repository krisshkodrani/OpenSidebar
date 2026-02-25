import { describe, test, expect, beforeEach, vi } from "vitest";
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
                addListener: vi.fn((fn: any) => { capturedListener = fn; }),
                removeListener: vi.fn(() => {}),
            },
            sendMessage: vi.fn(async () => {}),
        } as any;
        globalThis.chrome.storage = {
            session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
            local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
            sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
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
            stagnationState: null,
            turnProgress: null,
            pendingApproval: null,
            pendingEscalation: null,
            taskRecovery: null,
            laneTelemetry: null,
            settings: {
                openRouterApiKey: "",
                groqApiKey: "",
                cerebrasApiKey: "",
                maxTurns: 30,
                contextWindowSize: 128000,
                memoryEnabled: true,
                workspaceEnabled: true,
                theme: "system",
                showElementTags: false,
                visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
                showSessionMetrics: false,
                disableScreenshot: false,
                disableNavigation: false,
                bypassApprovals: false,
                speechProvider: "browser",
            },
        });
    });

    function setupBridge() {
        const onScreenshot = vi.fn(() => {});
        const onClose = vi.fn(() => {});
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

    test("AGENT_STATUS IDLE clears running, stagnationState, and turnProgress", () => {
        // Pre-set some state
        useStore.getState().setAgentRunning(true);
        useStore.getState().setStagnationState({
            signal: "nudge",
            stagnantTurns: 6,
            url: "https://example.com",
            receivedAt: Date.now(),
        });
        useStore.getState().setTurnProgress({ turn: 10, maxTurns: 30 });
        useStore.getState().setPendingApproval({
            approvalId: "a1",
            toolName: "navigate" as any,
            args: { url: "https://example.com" },
            risk: "high" as any,
            context: "Navigate to example.com",
            timeoutMs: 30000,
            requestedAt: Date.now(),
        });
        useStore.getState().setTaskRecovery({
            workspaceId: "ws-1",
            taskId: "task-1",
            totalSubtasks: 5,
            completedSubtasks: 2,
            pendingSubtasks: 3,
            recoveredAt: Date.now(),
        });

        setupBridge();
        send("AGENT_STATUS", { status: AgentStatus.IDLE, detail: "Done" });

        expect(useStore.getState().isAgentRunning).toBe(false);
        expect(useStore.getState().stagnationState).toBeNull();
        expect(useStore.getState().turnProgress).toBeNull();
        expect(useStore.getState().pendingApproval).toBeNull();
        expect(useStore.getState().taskRecovery).toBeNull();
    });

    test("AGENT_STATUS ERROR clears running state", () => {
        useStore.getState().setAgentRunning(true);
        setupBridge();
        send("AGENT_STATUS", { status: AgentStatus.ERROR, detail: "Failed" });

        expect(useStore.getState().isAgentRunning).toBe(false);
    });

    test("AGENT_STAGNATION nudge sets stagnation state", () => {
        setupBridge();
        send("AGENT_STAGNATION", {
            signal: "nudge",
            stagnantTurns: 6,
            url: "https://example.com/page",
            message: "Agent appears stuck",
        });

        const stagnation = useStore.getState().stagnationState;
        expect(stagnation).not.toBeNull();
        expect(stagnation!.signal).toBe("nudge");
        expect(stagnation!.stagnantTurns).toBe(6);
        expect(stagnation!.url).toBe("https://example.com/page");
    });

    test("AGENT_STAGNATION escalate sets stagnation state with escalate signal", () => {
        setupBridge();
        send("AGENT_STAGNATION", {
            signal: "escalate",
            stagnantTurns: 12,
            url: "https://example.com",
            message: "Agent is stuck",
        });

        expect(useStore.getState().stagnationState!.signal).toBe("escalate");
        expect(useStore.getState().stagnationState!.stagnantTurns).toBe(12);
    });

    test("AGENT_STAGNATION resolved clears stagnation state", () => {
        useStore.getState().setStagnationState({
            signal: "nudge",
            stagnantTurns: 6,
            url: "https://example.com",
            receivedAt: Date.now(),
        });

        setupBridge();
        send("AGENT_STAGNATION", {
            signal: "resolved",
            stagnantTurns: 0,
            url: "https://example.com",
            message: "",
        });

        expect(useStore.getState().stagnationState).toBeNull();
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

    test("AGENT_ACTIVITY stores lane telemetry snapshot", () => {
        setupBridge();
        send("AGENT_ACTIVITY", {
            active: true,
            laneTelemetry: {
                timestamp: Date.now(),
                lanes: {
                    planner: {
                        activeCalls: 0,
                        queueDepth: 1,
                        restartCount: 2,
                        consecutiveCrashes: 0,
                        circuitOpenUntilMs: 0,
                    },
                    executor: {
                        activeCalls: 1,
                        queueDepth: 2,
                        restartCount: 3,
                        consecutiveCrashes: 1,
                        circuitOpenUntilMs: 0,
                    },
                    verifier: {
                        activeCalls: 0,
                        queueDepth: 0,
                        restartCount: 0,
                        consecutiveCrashes: 0,
                        circuitOpenUntilMs: 0,
                    },
                },
            },
        });

        const laneTelemetry = useStore.getState().laneTelemetry;
        expect(laneTelemetry).not.toBeNull();
        expect(laneTelemetry!.lanes.executor.queueDepth).toBe(2);
        expect(laneTelemetry!.lanes.planner.restartCount).toBe(2);
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

    test("APPROVAL_REQUEST stores pending approval", () => {
        setupBridge();
        send("APPROVAL_REQUEST", {
            approvalId: "approval-1",
            toolName: "navigate",
            args: { url: "https://example.com" },
            risk: "high",
            context: "Navigate to example.com",
            timeoutMs: 30000,
        });

        const pending = useStore.getState().pendingApproval;
        expect(pending).not.toBeNull();
        expect(pending!.approvalId).toBe("approval-1");
        expect(pending!.risk).toBe("high");
    });

    test("ESCALATION_REQUEST stores pending escalation", () => {
        setupBridge();
        send("ESCALATION_REQUEST", {
            escalationId: "esc-1",
            taskId: "task-1",
            workspaceId: "ws-1",
            nodeId: "node-1",
            risk: "high",
            confidence: 0.32,
            reason: "Need operator decision",
            options: [
                {
                    id: "approve_continue",
                    label: "Continue",
                    impact: "Retry policy applies",
                },
            ],
            recommendedOption: "approve_continue",
            snapshotSummary: "Example | https://example.com",
            lastActions: [],
            budgetState: {
                elapsedMs: 1000,
                maxSessionTimeMs: 10000,
                totalTokens: 100,
                maxTotalTokens: 1000,
                totalCostUsd: 0.01,
                maxTotalCostUsd: 1,
            },
            timeoutMs: 60000,
            timestamp: Date.now(),
        });

        const escalation = useStore.getState().pendingEscalation;
        expect(escalation).not.toBeNull();
        expect(escalation!.escalationId).toBe("esc-1");
        expect(escalation!.risk).toBe("high");
    });

    test("TASK_RECOVERY stores recovery state", () => {
        setupBridge();
        send("TASK_RECOVERY", {
            taskId: "task-123",
            totalSubtasks: 10,
            completedSubtasks: 4,
            pendingSubtasks: 6,
        });

        const recovery = useStore.getState().taskRecovery;
        expect(recovery).not.toBeNull();
        expect(recovery!.workspaceId).toBeNull();
        expect(recovery!.taskId).toBe("task-123");
        expect(recovery!.totalSubtasks).toBe(10);
        expect(recovery!.completedSubtasks).toBe(4);
        expect(recovery!.pendingSubtasks).toBe(6);
    });

    test("TASK_RECOVERY keeps message workspace for stop targeting", () => {
        setupBridge();
        capturedListener!({
            type: "TASK_RECOVERY",
            requestId: "test-req",
            source: MessageSource.BACKGROUND,
            workspaceId: "ws-recovered",
            payload: {
                taskId: "task-456",
                totalSubtasks: 3,
                completedSubtasks: 1,
                pendingSubtasks: 2,
            },
        });

        const recovery = useStore.getState().taskRecovery;
        expect(recovery).not.toBeNull();
        expect(recovery!.workspaceId).toBe("ws-recovered");
    });

    test("STREAM_CHUNK replaceContent clears streamed garbage", () => {
        useStore.getState().addMessage({
            id: "a1",
            role: "assistant",
            content: '{"tool":"dismiss_overlays","toolInput":{}}',
            timestamp: 1000,
            toolCalls: [],
            isStreaming: true,
        });

        setupBridge();
        send("STREAM_CHUNK", { delta: "", done: false, replaceContent: "" });

        expect(useStore.getState().messages[0].content).toBe("");
        expect(useStore.getState().messages[0].isStreaming).toBe(true);
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

    test("IDLE clears stale taskProgress when no TASK_COMPLETION was received", () => {
        useStore.getState().setTaskProgress({
            taskId: "t1",
            subtasks: [{ description: "Step 1", status: "running", turnsUsed: 2, turnBudget: 20 }],
            currentIndex: 0,
            totalTurnsUsed: 2,
        });

        setupBridge();
        send("AGENT_STATUS", { status: AgentStatus.IDLE, detail: "Stopped" });

        expect(useStore.getState().taskProgress).toBeNull();
        expect(useStore.getState().taskCompletion).toBeNull();
    });

    test("ERROR clears stale taskProgress when no TASK_COMPLETION was received", () => {
        useStore.getState().setTaskProgress({
            taskId: "t1",
            subtasks: [{ description: "Step 1", status: "running", turnsUsed: 1, turnBudget: 10 }],
            currentIndex: 0,
            totalTurnsUsed: 1,
        });

        setupBridge();
        send("AGENT_STATUS", { status: AgentStatus.ERROR, detail: "Runtime error" });

        expect(useStore.getState().taskProgress).toBeNull();
        expect(useStore.getState().taskCompletion).toBeNull();
    });

    test("IDLE preserves taskCompletion after normal TASK_COMPLETION flow", () => {
        useStore.getState().setTaskProgress({
            taskId: "t1",
            subtasks: [],
            currentIndex: 0,
            totalTurnsUsed: 0,
        });

        setupBridge();

        // Normal flow: TASK_COMPLETION arrives first
        send("TASK_COMPLETION", {
            taskId: "t1",
            status: "completed",
            summary: "All done",
            totalTurnsUsed: 5,
            subtaskResults: [],
        });

        // Then IDLE arrives
        send("AGENT_STATUS", { status: AgentStatus.IDLE, detail: "Done" });

        // taskCompletion should be preserved (TASK_COMPLETION already cleared taskProgress)
        expect(useStore.getState().taskCompletion).not.toBeNull();
        expect(useStore.getState().taskCompletion!.status).toBe("completed");
        expect(useStore.getState().taskProgress).toBeNull();
    });
});
