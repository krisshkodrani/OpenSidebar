import { describe, test, expect, beforeEach, mock } from "bun:test";
import "../setup";
import { useStore } from "../../src/sidepanel/store";
import { AgentStatus } from "../../src/types";

describe("SidePanel Store", () => {
    beforeEach(() => {
        // Ensure chrome mocks are available and reset
        globalThis.chrome = globalThis.chrome || {} as any;
        globalThis.chrome.storage = {
            session: {
                get: mock(async () => ({})),
                set: mock(async () => {}),
            },
            local: {
                get: mock(async () => ({})),
                set: mock(async () => {}),
            },
            sync: {
                get: mock(async () => ({})),
                set: mock(async () => {}),
            },
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
                openRouterApiKey: "",
                groqApiKey: "",
                cerebrasApiKey: "",
                useGroqFast: false,
                maxTurns: 30,
                contextWindowSize: 128000,
                memoryEnabled: true,
                workspaceEnabled: true,
                theme: "system",
                showElementTags: false,
                visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
                confirmPlan: false,
                showSessionMetrics: false,
                disableScreenshot: false,
                disableNavigation: false,
                speechProvider: "browser",
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
        (chrome.storage.sync.get as any) = mock(async () => ({
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
        expect(settings.memoryEnabled).toBe(true);
        expect(settings.workspaceEnabled).toBe(true);
        expect(settings.theme).toBe("system");
        expect(settings.contextWindowSize).toBe(128000);
    });

    test("loadSettingsFromStorage uses defaults when storage is empty", async () => {
        (chrome.storage.sync.get as any) = mock(async () => ({}));

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

        (chrome.storage.session.get as any) = mock(async () => ({
            chatMessages: storedMessages,
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
        (chrome.storage.session.get as any) = mock(async () => ({}));

        await useStore.getState().loadMessagesFromStorage();

        expect(useStore.getState().messages).toHaveLength(0);
    });

    test("clearHistory clears persisted messages", async () => {
        const setSpy = mock(async () => {});
        (chrome.storage.session.set as any) = setSpy;

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
        // Verify session storage was called with empty messages
        expect(setSpy).toHaveBeenCalledWith({ chatMessages: [] });
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

    test("setStuckState stores stuck info", () => {
        const stuck = {
            signal: "nudge" as const,
            staleTurns: 6,
            url: "https://example.com",
            receivedAt: Date.now(),
        };
        useStore.getState().setStuckState(stuck);
        expect(useStore.getState().stuckState).toEqual(stuck);
    });

    test("clearStuckState resets to null", () => {
        useStore.getState().setStuckState({
            signal: "escalate" as const,
            staleTurns: 12,
            url: "https://example.com",
            receivedAt: Date.now(),
        });
        useStore.getState().clearStuckState();
        expect(useStore.getState().stuckState).toBeNull();
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

    test("DEFAULT_SETTINGS includes visionModel and confirmPlan", () => {
        const settings = useStore.getState().settings;
        expect(settings.visionModel).toBe("qwen/qwen3-vl-235b-a22b-instruct");
        expect(settings.confirmPlan).toBe(false);
    });

    test("DEFAULT_SETTINGS includes speechProvider", () => {
        const settings = useStore.getState().settings;
        expect(settings.speechProvider).toBe("browser");
    });
});
