import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import "../setup";
import { useStore } from "../../src/sidepanel/store";
import { initializeBridge } from "../../src/sidepanel/bridge";
import { AgentStatus, MessageSource } from "../../src/types";
import type { TaskCompletionMessage } from "../../src/types";

/**
 * Helper: capture the listener registered via chrome.runtime.onMessage.addListener
 * so we can dispatch messages to it manually.
 */
let capturedListener: ((message: any) => void) | null = null;

/**
 * Helper: capture the onDisconnect listener from chrome.runtime.connect
 * so we can simulate SW crashes.
 */
let capturedPortDisconnectListener: (() => void) | null = null;
let mockPort: {
    disconnect: ReturnType<typeof vi.fn>;
    onDisconnect: { addListener: ReturnType<typeof vi.fn> };
};

function createMockPort() {
    capturedPortDisconnectListener = null;
    mockPort = {
        disconnect: vi.fn(),
        onDisconnect: {
            addListener: vi.fn((fn: any) => {
                capturedPortDisconnectListener = fn;
            }),
        },
    };
    return mockPort;
}

describe("Bridge Message Routing", () => {
    beforeEach(() => {
        capturedListener = null;

        globalThis.chrome = globalThis.chrome || ({} as any);
        globalThis.chrome.runtime = {
            onMessage: {
                addListener: vi.fn((fn: any) => {
                    capturedListener = fn;
                }),
                removeListener: vi.fn(() => {}),
            },
            sendMessage: vi.fn(async () => {}),
            connect: vi.fn(() => createMockPort()),
        } as any;
        globalThis.chrome.storage = {
            session: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
            },
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
            activeWorkspaceId: null,
            taskProgress: null,
            taskCompletion: null,
            stagnationState: null,
            turnProgress: null,
            passiveStatus: null,
            passiveStatusDetail: null,
            passiveInstructions: "",
            passiveInputSources: ["page"],
            passiveLastObservationAt: null,
            passiveSessionId: null,
            durableRunStatus: null,
            pendingApproval: null,
            pendingEscalation: null,
            pendingPlanConfirmation: null,
            pendingClarification: null,
            taskRecovery: null,
            laneTelemetry: null,
            actionPresentation: null,
            settings: {
                openRouterApiKey: "",
                maxTurns: 30,
                theme: "system",
                showSessionMetrics: false,
                requireApprovals: true,
                allowNavigation: true,
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

    test("correlates action presentation and ignores stale sequences", () => {
        setupBridge();
        send("ACTION_PRESENTATION", {
            toolCallId: "call-new",
            sequence: 20,
            phase: "acquiring",
            label: "Opening Settings",
            toolName: "click_element",
        });
        send("ACTION_PRESENTATION", {
            toolCallId: "call-old",
            sequence: 19,
            phase: "acting",
            label: "Opening Old Target",
            toolName: "click_element",
        });
        send("ACTION_PRESENTATION", {
            toolCallId: "call-new",
            sequence: 20,
            phase: "acting",
            label: "Opening Settings",
            toolName: "click_element",
        });
        send("ACTION_PRESENTATION", {
            toolCallId: "call-new",
            sequence: 20,
            phase: "acquiring",
            label: "Opening Settings",
            toolName: "click_element",
        });

        expect(useStore.getState().actionPresentation).toMatchObject({
            toolCallId: "call-new",
            sequence: 20,
            phase: "acting",
            label: "Opening Settings",
        });
    });

    test("USER_CHAT_ACCEPTED renders externally-started user chat", () => {
        setupBridge();
        send("USER_CHAT_ACCEPTED", {
            text: "Complete the Ashby application",
            tabId: 123,
            workspaceId: "ws-1",
            messageId: "u1",
            timestamp: 1000,
        });

        const state = useStore.getState();
        expect(state.messages).toEqual([
            {
                id: "u1",
                role: "user",
                content: "Complete the Ashby application",
                timestamp: 1000,
                toolCalls: [],
                isStreaming: false,
            },
        ]);
        expect(state.isAgentRunning).toBe(true);
        expect(state.agentStatus).toBe(AgentStatus.THINKING);
        expect(state.isPlanning).toBe(true);
    });

    test("USER_CHAT_ACCEPTED dedupes locally-sent sidepanel chat", () => {
        useStore.getState().addMessage({
            id: "u1",
            role: "user",
            content: "Summarize this page",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: false,
        });

        setupBridge();
        send("USER_CHAT_ACCEPTED", {
            text: "Summarize this page",
            tabId: 123,
            workspaceId: "ws-1",
            messageId: "u1",
            timestamp: 1000,
        });

        expect(useStore.getState().messages).toHaveLength(1);
    });

    test("AGENT_STATUS updates status and running state", () => {
        setupBridge();
        send("AGENT_STATUS", {
            status: AgentStatus.THINKING,
            detail: "Analyzing...",
        });

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

        expect(useStore.getState().turnProgress).toEqual({
            turn: 5,
            maxTurns: 30,
        });
    });

    test("DURABLE_RUN_STATUS updates minimal durable run awareness", () => {
        setupBridge();
        send("DURABLE_RUN_STATUS", {
            runId: "run-1",
            query: "Resume the procurement task",
            status: "running",
            canResume: true,
            stopRequestedAt: 123,
        });

        expect(useStore.getState().durableRunStatus).toEqual({
            runId: "run-1",
            query: "Resume the procurement task",
            status: "running",
            canResume: true,
            stopRequestedAt: 123,
        });
    });

    test("TASK_PROGRESS sets task progress", () => {
        setupBridge();
        const payload = {
            taskId: "t1",
            subtasks: [
                {
                    description: "Step 1",
                    status: "running",
                    turnsUsed: 2,
                    turnBudget: 20,
                },
            ],
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
        useStore.getState().addMessage({
            id: "a1",
            role: "assistant",
            content: "Done",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: true,
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
        expect(useStore.getState().messages[0].completionData).toEqual(payload);
        expect(useStore.getState().messages[0].isStreaming).toBe(false);
    });

    test("TASK_COMPLETION preserves a fuller streamed final answer", () => {
        const fullSummary =
            "Wikipedia Homepage Summary\n\n" +
            "Overview: The Wikipedia homepage serves as the central portal for accessing Wikipedia in multiple languages and discovering related Wikimedia projects.\n\n" +
            "Key Sections\n\n" +
            "Header & Search: The page includes a central search input and language selector.\n\n" +
            "Language Options: The homepage prominently displays links to the top 10 Wikipedia language editions and keeps the answer complete.";
        const truncatedSummary =
            "Wikipedia Homepage Summary\n\n" +
            "Overview: The Wikipedia homepage serves as the central portal for accessing Wikipedia in multiple languages and discovering related Wikimedia projects.\n\n" +
            "Key Sections\n\n" +
            "Header & Search: The page includes a central search input and language selector.\n\n" +
            "Language Options: The homepage prominently displays links to the top 10 Wikipedia language";

        useStore.getState().addMessage({
            id: "a1",
            role: "assistant",
            content: fullSummary,
            timestamp: 1000,
            toolCalls: [],
            isStreaming: true,
        });

        setupBridge();
        const payload: TaskCompletionMessage["payload"] = {
            taskId: "t1",
            status: "completed",
            summary: truncatedSummary,
            totalTurnsUsed: 2,
            totalTimeMs: 1000,
            subtaskResults: [],
            urlHistory: [],
        };
        send("TASK_COMPLETION", payload);

        const state = useStore.getState();
        expect(state.taskCompletion?.summary).toBe(fullSummary);
        expect(state.messages[0].content).toBe(fullSummary);
        expect(state.messages[0].completionData?.summary).toBe(fullSummary);
        expect(state.messages[0].isStreaming).toBe(false);
    });

    test("TASK_COMPLETION does not append duplicate completion cards after reconnect replay", () => {
        const payload: TaskCompletionMessage["payload"] = {
            taskId: "t1",
            status: "completed",
            summary: "Done",
            totalTurnsUsed: 10,
            totalTimeMs: 1000,
            subtaskResults: [],
            urlHistory: [],
        };
        const existingPayload = { ...payload, totalTimeMs: 900 };
        useStore.getState().addMessage({
            id: "a1",
            role: "assistant",
            content: "Done",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: false,
            completionData: existingPayload,
        });
        useStore.getState().setAgentRunning(true);

        setupBridge();
        send("AGENT_STEP", {
            update: false,
            step: {
                id: "replayed-step",
                type: "tool",
                label: "Task complete",
                status: "running",
                timestamp: Date.now(),
            },
        });
        send("TASK_COMPLETION", payload);

        const completionMessages = useStore
            .getState()
            .messages.filter((message) => message.completionData?.taskId === "t1");
        expect(completionMessages).toHaveLength(1);
        expect(useStore.getState().messages).toHaveLength(1);
    });

    test("ignores stale active updates after terminal completion", () => {
        const payload: TaskCompletionMessage["payload"] = {
            taskId: "t1",
            status: "completed",
            summary: "Done",
            totalTurnsUsed: 10,
            subtaskResults: [],
        };
        useStore.setState({
            messages: [
                {
                    id: "a1",
                    role: "assistant",
                    content: "Done",
                    timestamp: 1000,
                    toolCalls: [],
                    isStreaming: false,
                    completionData: payload,
                },
            ],
            taskCompletion: payload,
            isAgentRunning: false,
            agentStatus: AgentStatus.IDLE,
            taskProgress: null,
            turnProgress: null,
            stagnationState: null,
        });

        setupBridge();
        send("AGENT_STATUS", {
            status: AgentStatus.ACTING,
            detail: "Verifying...",
        });
        send("TASK_PROGRESS", {
            taskId: "t1",
            subtasks: [{ description: "Old step", status: "running" }],
            currentIndex: 0,
            totalTurnsUsed: 10,
        });
        send("AGENT_TURN", { turn: 11, maxTurns: 30, provider: "test" });
        send("AGENT_STAGNATION", {
            signal: "nudge",
            stagnantTurns: 3,
            url: "https://example.com",
        });

        const state = useStore.getState();
        expect(state.isAgentRunning).toBe(false);
        expect(state.agentStatus).toBe(AgentStatus.IDLE);
        expect(state.taskCompletion).toEqual(payload);
        expect(state.taskProgress).toBeNull();
        expect(state.turnProgress).toBeNull();
        expect(state.stagnationState).toBeNull();
    });

    test("allows active status after a newer user message starts another run", () => {
        const payload: TaskCompletionMessage["payload"] = {
            taskId: "t1",
            status: "completed",
            summary: "Done",
            totalTurnsUsed: 10,
            subtaskResults: [],
        };
        useStore.setState({
            messages: [
                {
                    id: "a1",
                    role: "assistant",
                    content: "Done",
                    timestamp: 1000,
                    toolCalls: [],
                    isStreaming: false,
                    completionData: payload,
                },
                {
                    id: "u2",
                    role: "user",
                    content: "Run another task",
                    timestamp: 2000,
                    toolCalls: [],
                    isStreaming: false,
                },
            ],
            taskCompletion: payload,
            isAgentRunning: false,
            agentStatus: AgentStatus.IDLE,
        });

        setupBridge();
        send("AGENT_STATUS", {
            status: AgentStatus.THINKING,
            detail: "Planning...",
        });

        expect(useStore.getState().isAgentRunning).toBe(true);
        expect(useStore.getState().agentStatus).toBe(AgentStatus.THINKING);
        expect(useStore.getState().taskCompletion).toBeNull();
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

    test("PLAN_CONFIRMATION_REQUEST stores pending plan confirmation", () => {
        setupBridge();
        send("PLAN_CONFIRMATION_REQUEST", {
            confirmationId: "pc-1",
            nodes: [
                { description: "Step 1", successCriteria: "Done 1" },
                { description: "Step 2", successCriteria: "Done 2" },
            ],
            difficulty: "moderate",
            query: "Do something complex",
        });

        const confirmation = useStore.getState().pendingPlanConfirmation;
        expect(confirmation).not.toBeNull();
        expect(confirmation!.confirmationId).toBe("pc-1");
        expect(confirmation!.nodes).toHaveLength(2);
        expect(confirmation!.requestedAt).toBeGreaterThan(0);
    });

    test("CLARIFICATION_REQUEST stores pending clarification", () => {
        setupBridge();
        send("CLARIFICATION_REQUEST", {
            clarificationId: "cl-1",
            question: "Which address?",
            suggestions: ["Home", "Work"],
            timeoutMs: 120000,
        });

        const clarification = useStore.getState().pendingClarification;
        expect(clarification).not.toBeNull();
        expect(clarification!.clarificationId).toBe("cl-1");
        expect(clarification!.question).toBe("Which address?");
        expect(clarification!.requestedAt).toBeGreaterThan(0);
    });

    test("AGENT_STATUS IDLE clears pending plan confirmation and clarification", () => {
        setupBridge();
        useStore.getState().setPendingPlanConfirmation({
            confirmationId: "pc-1",
            nodes: [{ description: "Step 1", successCriteria: "Done" }],
            query: "test",
            requestedAt: Date.now(),
        });
        useStore.getState().setPendingClarification({
            clarificationId: "cl-1",
            question: "test?",
            timeoutMs: 120000,
            requestedAt: Date.now(),
        });

        send("AGENT_STATUS", { status: AgentStatus.IDLE, detail: "Done" });

        expect(useStore.getState().pendingPlanConfirmation).toBeNull();
        expect(useStore.getState().pendingClarification).toBeNull();
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
        useStore.setState({ activeWorkspaceId: "ws-recovered" });
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
        const payload = {
            dataUrl: "data:image/png;base64,abc",
            context: "test",
            timestamp: 123,
        };
        send("SCREENSHOT_CAPTURED", payload);

        expect(onScreenshot).toHaveBeenCalledWith(payload);
    });

    test("PASSIVE_MONITOR_STATUS updates watch mode state", () => {
        useStore.setState({ activeWorkspaceId: "ws-1" });
        setupBridge();
        capturedListener!({
            type: "PASSIVE_MONITOR_STATUS",
            requestId: "passive-status",
            source: MessageSource.BACKGROUND,
            workspaceId: "ws-1",
            payload: {
                status: "watching",
                detail: "Watching page changes.",
                sessionId: "session-1",
                observedAt: 1234,
            },
        });

        const state = useStore.getState();
        expect(state.passiveStatus).toBe("watching");
        expect(state.passiveStatusDetail).toBe("Watching page changes.");
        expect(state.passiveSessionId).toBe("session-1");
        expect(state.passiveLastObservationAt).toBe(1234);
    });

    test("PASSIVE_MONITOR_SUGGESTION appends a passive assistant message once", () => {
        useStore.setState({ activeWorkspaceId: "ws-1" });
        setupBridge();
        const message = {
            type: "PASSIVE_MONITOR_SUGGESTION",
            requestId: "passive-suggestion",
            source: MessageSource.BACKGROUND,
            workspaceId: "ws-1",
            payload: {
                suggestionId: "suggestion-1",
                sessionId: "session-1",
                answer: "Choose B.",
                confidence: "high",
                evidence: ["The page says option B matches the prompt."],
                reason: "new_question",
                observedAt: 2000,
                fingerprint: "fp-1",
            },
        } as const;

        capturedListener!(message);
        capturedListener!(message);

        const state = useStore.getState();
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
            id: "suggestion-1",
            role: "assistant",
            isPassive: true,
            isStreaming: false,
        });
        expect(state.messages[0].content).toContain("Choose B.");
        expect(state.messages[0].content).not.toContain("Confidence:");
        expect(state.messages[0].content).not.toContain("Evidence:");
        expect(state.passiveStatus).toBe("watching");
        expect(state.passiveSessionId).toBe("session-1");
    });

    test("PASSIVE_MONITOR_SUGGESTION dedupes identical passive content across suggestion ids", () => {
        useStore.setState({ activeWorkspaceId: "ws-1" });
        setupBridge();

        const basePayload = {
            sessionId: "session-1",
            answer: "Question 49: Reduce the number of tokens in the input.",
            confidence: "high",
            evidence: ["The page shows question 49."],
            reason: "new_question",
            observedAt: 2000,
            fingerprint: "fp-1",
        } as const;

        capturedListener!({
            type: "PASSIVE_MONITOR_SUGGESTION",
            requestId: "passive-suggestion-1",
            source: MessageSource.BACKGROUND,
            workspaceId: "ws-1",
            payload: { ...basePayload, suggestionId: "suggestion-1" },
        });
        capturedListener!({
            type: "PASSIVE_MONITOR_SUGGESTION",
            requestId: "passive-suggestion-2",
            source: MessageSource.BACKGROUND,
            workspaceId: "ws-1",
            payload: {
                ...basePayload,
                suggestionId: "suggestion-2",
                answer: " Question 49:   Reduce the number of tokens in the input. ",
                observedAt: 2010,
            },
        });

        const state = useStore.getState();
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0].id).toBe("suggestion-1");
        expect(state.passiveStatus).toBe("watching");
        expect(state.passiveSessionId).toBe("session-1");
    });

    test("PASSIVE_MONITOR_SUGGESTION allows changed content or page fingerprint", () => {
        useStore.setState({ activeWorkspaceId: "ws-1" });
        setupBridge();

        const basePayload = {
            sessionId: "session-1",
            answer: "Question 49: Reduce the number of tokens in the input.",
            confidence: "high",
            evidence: ["The page shows question 49."],
            reason: "new_question",
            observedAt: 2000,
            fingerprint: "fp-1",
        } as const;

        for (const payload of [
            { ...basePayload, suggestionId: "suggestion-1" },
            {
                ...basePayload,
                suggestionId: "suggestion-2",
                answer: "Question 50: Choose the storage class.",
                observedAt: 2010,
            },
            {
                ...basePayload,
                suggestionId: "suggestion-3",
                fingerprint: "fp-2",
                observedAt: 2020,
            },
        ]) {
            capturedListener!({
                type: "PASSIVE_MONITOR_SUGGESTION",
                requestId: payload.suggestionId,
                source: MessageSource.BACKGROUND,
                workspaceId: "ws-1",
                payload,
            });
        }

        expect(useStore.getState().messages.map((message) => message.id)).toEqual([
            "suggestion-1",
            "suggestion-2",
            "suggestion-3",
        ]);
    });

    test("PASSIVE_MONITOR_SUGGESTION allows identical passive content after dedupe TTL", () => {
        useStore.setState({ activeWorkspaceId: "ws-1" });
        setupBridge();

        const basePayload = {
            sessionId: "session-1",
            answer: "Question 49: Reduce the number of tokens in the input.",
            confidence: "high",
            evidence: ["The page shows question 49."],
            reason: "new_question",
            fingerprint: "fp-1",
        } as const;

        for (const payload of [
            { ...basePayload, suggestionId: "suggestion-1", observedAt: 2000 },
            {
                ...basePayload,
                suggestionId: "suggestion-2",
                observedAt: 63_000,
            },
        ]) {
            capturedListener!({
                type: "PASSIVE_MONITOR_SUGGESTION",
                requestId: payload.suggestionId,
                source: MessageSource.BACKGROUND,
                workspaceId: "ws-1",
                payload,
            });
        }

        expect(useStore.getState().messages.map((message) => message.id)).toEqual(["suggestion-1", "suggestion-2"]);
    });

    test("PASSIVE_MONITOR_SUGGESTION resets content dedupe on active task start", () => {
        useStore.setState({ activeWorkspaceId: "ws-1" });
        setupBridge();

        const basePayload = {
            sessionId: "session-1",
            answer: "Question 49: Reduce the number of tokens in the input.",
            confidence: "high",
            evidence: ["The page shows question 49."],
            reason: "new_question",
            observedAt: 2000,
            fingerprint: "fp-1",
        } as const;

        capturedListener!({
            type: "PASSIVE_MONITOR_SUGGESTION",
            requestId: "passive-suggestion-1",
            source: MessageSource.BACKGROUND,
            workspaceId: "ws-1",
            payload: { ...basePayload, suggestionId: "suggestion-1" },
        });
        capturedListener!({
            type: "AGENT_STATUS",
            requestId: "agent-thinking",
            source: MessageSource.BACKGROUND,
            workspaceId: "ws-1",
            payload: { status: AgentStatus.THINKING, detail: "Starting task" },
        });
        capturedListener!({
            type: "PASSIVE_MONITOR_SUGGESTION",
            requestId: "passive-suggestion-2",
            source: MessageSource.BACKGROUND,
            workspaceId: "ws-1",
            payload: {
                ...basePayload,
                suggestionId: "suggestion-2",
                observedAt: 2010,
            },
        });

        expect(useStore.getState().messages.map((message) => message.id)).toEqual(["suggestion-1", "suggestion-2"]);
    });

    test("IDLE clears stale taskProgress when no TASK_COMPLETION was received", () => {
        useStore.getState().setTaskProgress({
            taskId: "t1",
            subtasks: [
                {
                    description: "Step 1",
                    status: "running",
                    turnsUsed: 2,
                    turnBudget: 20,
                },
            ],
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
            subtasks: [
                {
                    description: "Step 1",
                    status: "running",
                    turnsUsed: 1,
                    turnBudget: 10,
                },
            ],
            currentIndex: 0,
            totalTurnsUsed: 1,
        });

        setupBridge();
        send("AGENT_STATUS", {
            status: AgentStatus.ERROR,
            detail: "Runtime error",
        });

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

describe("Bridge Port Keepalive", () => {
    beforeEach(() => {
        capturedListener = null;
        vi.useFakeTimers();

        globalThis.chrome = globalThis.chrome || ({} as any);
        globalThis.chrome.runtime = {
            onMessage: {
                addListener: vi.fn((fn: any) => {
                    capturedListener = fn;
                }),
                removeListener: vi.fn(() => {}),
            },
            sendMessage: vi.fn(async () => {}),
            connect: vi.fn(() => createMockPort()),
        } as any;
        globalThis.chrome.storage = {
            session: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
            },
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
            activeWorkspaceId: null,
            taskProgress: null,
            taskCompletion: null,
            stagnationState: null,
            turnProgress: null,
            passiveStatus: null,
            passiveStatusDetail: null,
            passiveInstructions: "",
            passiveInputSources: ["page"],
            passiveLastObservationAt: null,
            passiveSessionId: null,
            pendingApproval: null,
            pendingEscalation: null,
            pendingPlanConfirmation: null,
            pendingClarification: null,
            taskRecovery: null,
            laneTelemetry: null,
            settings: {
                openRouterApiKey: "",
                maxTurns: 30,
                theme: "system",
                showSessionMetrics: false,
                requireApprovals: true,
                allowNavigation: true,
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function setupBridge() {
        const onScreenshot = vi.fn();
        const onClose = vi.fn();
        const cleanup = initializeBridge(useStore, { onScreenshot, onClose });
        return { cleanup };
    }

    test("connects port on initialization", () => {
        setupBridge();
        expect(chrome.runtime.connect).toHaveBeenCalledWith({
            name: "sidepanel-keepalive",
        });
    });

    test("port disconnect resets isAgentRunning when agent was running", () => {
        useStore.getState().setAgentRunning(true);
        setupBridge();

        // Simulate SW crash
        capturedPortDisconnectListener!();

        expect(useStore.getState().isAgentRunning).toBe(false);
        expect(useStore.getState().agentStatus).toBe(AgentStatus.IDLE);
    });

    test("port disconnect does not change status when agent was idle", () => {
        setupBridge();

        capturedPortDisconnectListener!();

        // Should remain IDLE, not be set to IDLE again (no unnecessary status change)
        expect(useStore.getState().isAgentRunning).toBe(false);
        expect(useStore.getState().agentStatus).toBe(AgentStatus.IDLE);
    });

    test("port disconnect clears all pending overlays", () => {
        useStore.getState().setPendingApproval({
            approvalId: "a1",
            toolName: "navigate" as any,
            args: { url: "https://example.com" },
            risk: "high" as any,
            context: "Navigate",
            timeoutMs: 30000,
            requestedAt: Date.now(),
        });
        useStore.getState().setPendingEscalation({
            escalationId: "esc-1",
            taskId: "t1",
            workspaceId: "ws-1",
            nodeId: "n1",
            risk: "high",
            confidence: 0.3,
            reason: "Stuck",
            options: [{ id: "approve_continue", label: "Continue", impact: "Retry" }],
            recommendedOption: "approve_continue",
            snapshotSummary: "Example",
            lastActions: [],
            budgetState: {
                elapsedMs: 0,
                maxSessionTimeMs: 10000,
                totalTokens: 0,
                maxTotalTokens: 1000,
                totalCostUsd: 0,
                maxTotalCostUsd: 1,
            },
            timeoutMs: 60000,
            timestamp: Date.now(),
            requestedAt: Date.now(),
        });
        useStore.getState().setPendingPlanConfirmation({
            confirmationId: "pc-1",
            nodes: [{ description: "Step 1", successCriteria: "Done" }],
            query: "test",
            requestedAt: Date.now(),
        });
        useStore.getState().setPendingClarification({
            clarificationId: "cl-1",
            question: "Which?",
            timeoutMs: 120000,
            requestedAt: Date.now(),
        });

        setupBridge();
        capturedPortDisconnectListener!();

        expect(useStore.getState().pendingApproval).toBeNull();
        expect(useStore.getState().pendingEscalation).toBeNull();
        expect(useStore.getState().pendingPlanConfirmation).toBeNull();
        expect(useStore.getState().pendingClarification).toBeNull();
    });

    test("port disconnect schedules reconnect after delay", () => {
        setupBridge();

        // First disconnect → reconnect at 1s
        capturedPortDisconnectListener!();
        expect(chrome.runtime.connect).toHaveBeenCalledTimes(1); // only initial

        vi.advanceTimersByTime(1000);
        expect(chrome.runtime.connect).toHaveBeenCalledTimes(2); // reconnected
    });

    test("backoff doubles on consecutive connect failures", () => {
        // Make connect throw on second call (reconnect fails)
        let connectAttempt = 0;
        (chrome.runtime.connect as any).mockImplementation(() => {
            connectAttempt++;
            if (connectAttempt === 1) return createMockPort(); // initial OK
            if (connectAttempt === 2) return createMockPort(); // first reconnect OK
            // Third call: simulate the disconnect immediately triggering the backoff path
            return createMockPort();
        });

        setupBridge();
        expect(connectAttempt).toBe(1);

        // Disconnect → 1s → reconnect OK (resets backoff) → disconnect → 1s → reconnect
        capturedPortDisconnectListener!();
        vi.advanceTimersByTime(1000);
        expect(connectAttempt).toBe(2); // reconnected

        // Second disconnect → still 1s because successful connect reset backoff
        capturedPortDisconnectListener!();
        vi.advanceTimersByTime(1000);
        expect(connectAttempt).toBe(3);
    });

    test("cleanup cancels pending reconnect timer", () => {
        const { cleanup } = setupBridge();

        // Trigger disconnect (schedules reconnect)
        capturedPortDisconnectListener!();

        // Cleanup before reconnect fires
        cleanup();

        // Advance past the reconnect delay
        vi.advanceTimersByTime(5000);

        // Should NOT have reconnected (only initial connect)
        expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    });

    test("cleanup disconnects active port", () => {
        const { cleanup } = setupBridge();
        cleanup();

        expect(mockPort.disconnect).toHaveBeenCalledTimes(1);
    });

    test("port disconnect after cleanup is a no-op (tornDown guard)", () => {
        useStore.getState().setAgentRunning(true);
        const { cleanup } = setupBridge();

        cleanup();

        // Simulate late disconnect event after cleanup
        capturedPortDisconnectListener!();

        // Should NOT have reset agent state (tornDown = true)
        expect(useStore.getState().isAgentRunning).toBe(true);
    });
});
