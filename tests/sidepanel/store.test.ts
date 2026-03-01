import { describe, test, expect, beforeEach, vi } from "vitest";
import "../setup";
import { useStore } from "../../src/sidepanel/store";
import { AgentStatus } from "../../src/types";

describe("SidePanel Store", () => {
    beforeEach(() => {
        // Ensure chrome mocks are available and reset
        globalThis.chrome = globalThis.chrome || {} as any;
        globalThis.chrome.storage = {
            session: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
            },
            local: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
            },
            sync: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
            },
        } as any;

        useStore.setState({
            activeWorkspaceId: "ws-test",
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
            pendingPlanConfirmation: null,
            pendingClarification: null,
            taskRecovery: null,
            laneTelemetry: null,
            settings: {
                openRouterApiKey: "",
                groqApiKey: "",
                useGroqFast: false,
                maxTurns: 30,
                contextWindowSize: 128000,
                workspaceEnabled: true,
                theme: "system",
                visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
                showSessionMetrics: false,
                disableNavigation: false,
                bypassApprovals: false,
            },
        });
    });

    test("adds message", () => {
        const msg = {
            id: "1",
            role: "user" as const,
            content: "Hello",
            timestamp: 123,
            toolCalls: [],
            isStreaming: false
        };

        useStore.getState().addMessage(msg);
        expect(useStore.getState().messages).toHaveLength(1);
        expect(useStore.getState().messages[0]).toEqual(msg);
    });

    test("updates status", () => {
        useStore.getState().updateStatus(AgentStatus.THINKING, "Hmm...");
        expect(useStore.getState().agentStatus).toBe(AgentStatus.THINKING);
        expect(useStore.getState().statusDetail).toBe("Hmm...");
    });

    test("clears history", () => {
        useStore.getState().addMessage({
            id: "1",
            role: "user" as const,
            content: "Hi",
            timestamp: 1,
            toolCalls: [],
            isStreaming: false
        });
        useStore.getState().clearHistory();
        expect(useStore.getState().messages).toHaveLength(0);
    });

    test("sets input text", () => {
        useStore.getState().setInputText("foo");
        expect(useStore.getState().inputText).toBe("foo");
    });

    test("loadSettingsFromStorage merges saved settings with defaults", async () => {
        // Mock storage to return partial settings
        (chrome.storage.sync.get as any) = vi.fn(async () => ({
            userSettings: {
                openRouterApiKey: "sk-or-test-123",
                maxTurns: 10,
            },
        }));

        await useStore.getState().loadSettingsFromStorage();

        const settings = useStore.getState().settings;
        expect(settings.openRouterApiKey).toBe("sk-or-test-123");
        expect(settings.maxTurns).toBe(10);
        // Defaults preserved for missing fields
        expect(settings.workspaceEnabled).toBe(true);
        expect(settings.theme).toBe("system");
        expect(settings.contextWindowSize).toBe(128000);
    });

    test("loadSettingsFromStorage uses defaults when storage is empty", async () => {
        (chrome.storage.sync.get as any) = vi.fn(async () => ({}));

        await useStore.getState().loadSettingsFromStorage();

        const settings = useStore.getState().settings;
        expect(settings.openRouterApiKey).toBe("");
        expect(settings.maxTurns).toBe(30);
        expect(settings.workspaceEnabled).toBe(true);
    });

    test("loadMessagesFromStorage restores messages and finalizes streaming", async () => {
        const storedMessages = [
            {
                id: "m1",
                role: "user" as const,
                content: "Hello",
                timestamp: 1000,
                toolCalls: [],
                isStreaming: false,
            },
            {
                id: "m2",
                role: "assistant" as const,
                content: "Hi there, I was still strea",
                timestamp: 1001,
                toolCalls: [],
                isStreaming: true, // leftover streaming state
            },
        ];

        (chrome.storage.local.get as any) = vi.fn(async () => ({
            "chatMessages:ws-test": storedMessages,
        }));

        await useStore.getState().loadMessagesFromStorage();

        const messages = useStore.getState().messages;
        expect(messages).toHaveLength(2);
        expect(messages[0].content).toBe("Hello");
        expect(messages[0].isStreaming).toBe(false);
        // Streaming should be finalized
        expect(messages[1].content).toBe("Hi there, I was still strea");
        expect(messages[1].isStreaming).toBe(false);
    });

    test("loadMessagesFromStorage handles empty storage", async () => {
        (chrome.storage.session.get as any) = vi.fn(async () => ({}));

        await useStore.getState().loadMessagesFromStorage();

        expect(useStore.getState().messages).toHaveLength(0);
    });

    test("clearHistory clears persisted messages", async () => {
        const setSpy = vi.fn(async () => {});
        (chrome.storage.local.set as any) = setSpy;

        useStore.getState().addMessage({
            id: "1",
            role: "user" as const,
            content: "Hi",
            timestamp: 1,
            toolCalls: [],
            isStreaming: false,
        });

        useStore.getState().clearHistory();

        expect(useStore.getState().messages).toHaveLength(0);
        // Verify workspace-scoped storage was cleared
        expect(setSpy).toHaveBeenCalledWith({ "chatMessages:ws-test": [] });
    });

    test("DEFAULT_SETTINGS includes workspaceEnabled", () => {
        const settings = useStore.getState().settings;
        expect(settings.workspaceEnabled).toBe(true);
    });

    test("addStep pushes step to last assistant message", () => {
        // Add an assistant message first
        useStore.getState().addMessage({
            id: "a1",
            role: "assistant",
            content: "Hello",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: true,
        });

        const step = {
            id: "s1",
            type: "thinking" as const,
            label: "Planning approach",
            status: "running" as const,
            timestamp: Date.now(),
        };

        useStore.getState().addStep(step);

        const msgs = useStore.getState().messages;
        expect(msgs[0].steps).toHaveLength(1);
        expect(msgs[0].steps![0].id).toBe("s1");
        expect(msgs[0].steps![0].label).toBe("Planning approach");
    });

    test("updateStep replaces step by ID", () => {
        useStore.getState().addMessage({
            id: "a2",
            role: "assistant",
            content: "",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: true,
            steps: [
                {
                    id: "s2",
                    type: "thinking" as const,
                    label: "Thinking...",
                    status: "running" as const,
                    timestamp: 1000,
                },
            ],
        });

        useStore.getState().updateStep({
            id: "s2",
            type: "thinking",
            label: "Thinking...",
            status: "done",
            timestamp: 1000,
            durationMs: 500,
        });

        const msgs = useStore.getState().messages;
        expect(msgs[0].steps![0].status).toBe("done");
        expect(msgs[0].steps![0].durationMs).toBe(500);
    });

    test("addStep creates steps array if not present", () => {
        useStore.getState().addMessage({
            id: "a3",
            role: "assistant",
            content: "",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: true,
        });

        // steps field should be undefined initially
        expect(useStore.getState().messages[0].steps).toBeUndefined();

        useStore.getState().addStep({
            id: "s3",
            type: "tool",
            label: "Click element [5]",
            status: "running",
            timestamp: Date.now(),
        });

        expect(useStore.getState().messages[0].steps).toHaveLength(1);
    });

    test("addStep does NOT attach to finalized (non-streaming) assistant message", () => {
        // Agent must be running for addStep to create new messages
        useStore.getState().setAgentRunning(true);

        // Add a finalized assistant message (previous turn)
        useStore.getState().addMessage({
            id: "a-final",
            role: "assistant",
            content: "Previous turn done",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: false,
        });

        useStore.getState().addStep({
            id: "s-new",
            type: "thinking",
            label: "New turn thinking",
            status: "running",
            timestamp: Date.now(),
        });

        // Should NOT attach to the finalized message
        expect(useStore.getState().messages[0].steps).toBeUndefined();
        // Should create a new streaming message
        expect(useStore.getState().messages).toHaveLength(2);
        expect(useStore.getState().messages[1].role).toBe("assistant");
        expect(useStore.getState().messages[1].isStreaming).toBe(true);
        expect(useStore.getState().messages[1].steps).toHaveLength(1);
        expect(useStore.getState().messages[1].steps![0].id).toBe("s-new");
    });

    test("addStep creates new streaming message when no assistant messages exist", () => {
        // Agent must be running for addStep to create new messages
        useStore.getState().setAgentRunning(true);

        // Only a user message exists
        useStore.getState().addMessage({
            id: "u1",
            role: "user",
            content: "Hello",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: false,
        });

        useStore.getState().addStep({
            id: "s-orphan",
            type: "tool",
            label: "Clicking element",
            status: "running",
            timestamp: Date.now(),
        });

        expect(useStore.getState().messages).toHaveLength(2);
        const newMsg = useStore.getState().messages[1];
        expect(newMsg.role).toBe("assistant");
        expect(newMsg.isStreaming).toBe(true);
        expect(newMsg.content).toBe("");
        expect(newMsg.steps).toHaveLength(1);
    });

    test("addStep silently drops step when agent is not running and no streaming message", () => {
        // Agent is NOT running (default state)
        useStore.getState().addMessage({
            id: "u1",
            role: "user",
            content: "Hello",
            timestamp: 1000,
            toolCalls: [],
            isStreaming: false,
        });

        useStore.getState().addStep({
            id: "s-late",
            type: "info",
            label: "Late arriving step",
            status: "done",
            timestamp: Date.now(),
        });

        // No ghost bubble created
        expect(useStore.getState().messages).toHaveLength(1);
        expect(useStore.getState().messages[0].role).toBe("user");
    });

    // --- Agent feedback action tests ---

    test("setTaskProgress stores payload", () => {
        const payload = {
            taskId: "t1",
            subtasks: [
                { description: "Search", status: "completed" as const, turnsUsed: 3, turnBudget: 20 },
                { description: "Fill form", status: "running" as const, turnsUsed: 1, turnBudget: 20 },
            ],
            currentIndex: 1,
            totalTurnsUsed: 4,
        };

        useStore.getState().setTaskProgress(payload);
        expect(useStore.getState().taskProgress).toEqual(payload);
    });

    test("setTaskCompletion stores payload and clears taskProgress", () => {
        // Set progress first
        useStore.getState().setTaskProgress({
            taskId: "t1",
            subtasks: [{ description: "Do thing", status: "running" as const, turnsUsed: 1, turnBudget: 20 }],
            currentIndex: 0,
            totalTurnsUsed: 1,
        });
        expect(useStore.getState().taskProgress).not.toBeNull();

        // Completion should clear progress
        const completion = {
            taskId: "t1",
            status: "completed" as const,
            summary: "All done",
            totalTurnsUsed: 5,
            subtaskResults: [
                { description: "Do thing", outcome: "completed" as const, turnsUsed: 5 },
            ],
        };
        useStore.getState().setTaskCompletion(completion);

        expect(useStore.getState().taskCompletion).toEqual(completion);
        expect(useStore.getState().taskProgress).toBeNull();
    });

    test("clearTaskProgress clears both progress and completion", () => {
        useStore.getState().setTaskProgress({
            taskId: "t1",
            subtasks: [],
            currentIndex: 0,
            totalTurnsUsed: 0,
        });
        useStore.getState().setTaskCompletion({
            taskId: "t1",
            status: "completed" as const,
            summary: "",
            totalTurnsUsed: 0,
            subtaskResults: [],
        });

        useStore.getState().clearTaskProgress();
        expect(useStore.getState().taskProgress).toBeNull();
        expect(useStore.getState().taskCompletion).toBeNull();
    });

    test("setStagnationState stores stagnation info", () => {
        const stagnation = {
            signal: "nudge" as const,
            stagnantTurns: 6,
            url: "https://example.com",
            receivedAt: Date.now(),
        };
        useStore.getState().setStagnationState(stagnation);
        expect(useStore.getState().stagnationState).toEqual(stagnation);
    });

    test("clearStagnationState resets to null", () => {
        useStore.getState().setStagnationState({
            signal: "escalate" as const,
            stagnantTurns: 12,
            url: "https://example.com",
            receivedAt: Date.now(),
        });
        useStore.getState().clearStagnationState();
        expect(useStore.getState().stagnationState).toBeNull();
    });

    test("setTurnProgress stores turn info", () => {
        useStore.getState().setTurnProgress({ turn: 5, maxTurns: 30 });
        expect(useStore.getState().turnProgress).toEqual({ turn: 5, maxTurns: 30 });
    });

    test("clearTurnProgress resets to null", () => {
        useStore.getState().setTurnProgress({ turn: 10, maxTurns: 30 });
        useStore.getState().clearTurnProgress();
        expect(useStore.getState().turnProgress).toBeNull();
    });

    test("setPendingApproval and clearPendingApproval", () => {
        useStore.getState().setPendingApproval({
            approvalId: "ap-1",
            toolName: "navigate" as any,
            args: { url: "https://example.com" },
            risk: "high" as any,
            context: "Navigate to example.com",
            timeoutMs: 30000,
            requestedAt: Date.now(),
        });
        expect(useStore.getState().pendingApproval).not.toBeNull();
        useStore.getState().clearPendingApproval();
        expect(useStore.getState().pendingApproval).toBeNull();
    });

    test("setTaskRecovery and clearTaskRecovery", () => {
        useStore.getState().setTaskRecovery({
            workspaceId: "ws-1",
            taskId: "task-1",
            totalSubtasks: 8,
            completedSubtasks: 3,
            pendingSubtasks: 5,
            recoveredAt: Date.now(),
        });
        expect(useStore.getState().taskRecovery).not.toBeNull();
        useStore.getState().clearTaskRecovery();
        expect(useStore.getState().taskRecovery).toBeNull();
    });

    test("DEFAULT_SETTINGS includes visionModel", () => {
        const settings = useStore.getState().settings;
        expect(settings.visionModel).toBe("qwen/qwen3-vl-235b-a22b-instruct");
    });

    test("DEFAULT_SETTINGS includes bypassApprovals", () => {
        const settings = useStore.getState().settings;
        expect(settings.bypassApprovals).toBe(false);
    });

    test("setActiveWorkspaceId clears workspace-scoped transient state", () => {
        useStore.getState().setTaskProgress({
            taskId: "task-1",
            subtasks: [],
            currentIndex: 0,
            totalTurnsUsed: 0,
        });
        useStore.getState().setTaskCompletion({
            taskId: "task-1",
            status: "completed",
            summary: "done",
            totalTurnsUsed: 0,
            subtaskResults: [],
        });
        useStore.getState().setStagnationState({
            signal: "nudge" as const,
            stagnantTurns: 6,
            url: "https://example.com",
            receivedAt: Date.now(),
        });
        useStore.getState().setTurnProgress({ turn: 1, maxTurns: 30 });
        useStore.getState().setPendingApproval({
            approvalId: "a1",
            toolName: "navigate" as any,
            args: { url: "https://example.com" },
            risk: "high" as any,
            context: "Navigate",
            timeoutMs: 30000,
            requestedAt: Date.now(),
        });
        useStore.getState().setTaskRecovery({
            workspaceId: "ws-1",
            taskId: "task-1",
            totalSubtasks: 2,
            completedSubtasks: 1,
            pendingSubtasks: 1,
            recoveredAt: Date.now(),
        });
        useStore.getState().setPendingEscalation({
            escalationId: "esc-1",
            taskId: "task-1",
            workspaceId: "ws-1",
            nodeId: "n1",
            risk: "high",
            confidence: 0.3,
            reason: "Need operator decision",
            options: [
                {
                    id: "approve_continue",
                    label: "Continue",
                    impact: "Retry policy applies",
                },
            ],
            recommendedOption: "approve_continue",
            snapshotSummary: "Example summary",
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
            requestedAt: Date.now(),
        });

        useStore.getState().setActiveWorkspaceId("ws-2");
        const state = useStore.getState();
        expect(state.taskProgress).toBeNull();
        expect(state.taskCompletion).toBeNull();
        expect(state.stagnationState).toBeNull();
        expect(state.turnProgress).toBeNull();
        expect(state.pendingApproval).toBeNull();
        expect(state.pendingEscalation).toBeNull();
        expect(state.pendingPlanConfirmation).toBeNull();
        expect(state.pendingClarification).toBeNull();
        expect(state.taskRecovery).toBeNull();
    });

    test("setPendingPlanConfirmation and clearPendingPlanConfirmation", () => {
        useStore.getState().setPendingPlanConfirmation({
            confirmationId: "pc-1",
            nodes: [{ description: "Step 1", successCriteria: "Done" }],
            query: "Do something",
            requestedAt: Date.now(),
        });
        expect(useStore.getState().pendingPlanConfirmation).not.toBeNull();
        useStore.getState().clearPendingPlanConfirmation();
        expect(useStore.getState().pendingPlanConfirmation).toBeNull();
    });

    test("setPendingClarification and clearPendingClarification", () => {
        useStore.getState().setPendingClarification({
            clarificationId: "cl-1",
            question: "What color?",
            timeoutMs: 120000,
            requestedAt: Date.now(),
        });
        expect(useStore.getState().pendingClarification).not.toBeNull();
        useStore.getState().clearPendingClarification();
        expect(useStore.getState().pendingClarification).toBeNull();
    });

    test("setActiveWorkspaceId flushes messages before clearing", () => {
        // Set workspace A with messages
        useStore.getState().setActiveWorkspaceId("ws-A");
        useStore.setState({
            messages: [
                {
                    id: "msg-1",
                    role: "user",
                    content: "Hello workspace A",
                    timestamp: Date.now(),
                    toolCalls: [],
                    isStreaming: false,
                },
            ],
        });

        // Reset the mock to track new calls
        const setMock = chrome.storage.local.set as ReturnType<typeof mock>;
        setMock.mockClear();

        // Switch to workspace B
        useStore.getState().setActiveWorkspaceId("ws-B");

        // flushPersist should have called chrome.storage.local.set with ws-A key
        expect(setMock).toHaveBeenCalled();
        const firstCall = setMock.mock.calls[0][0] as Record<string, unknown>;
        expect(firstCall).toHaveProperty("chatMessages:ws-A");
        const flushedMessages = firstCall["chatMessages:ws-A"] as any[];
        expect(flushedMessages).toHaveLength(1);
        expect(flushedMessages[0].content).toBe("Hello workspace A");

        // Store messages should be cleared for ws-B
        expect(useStore.getState().messages).toEqual([]);
    });
});
