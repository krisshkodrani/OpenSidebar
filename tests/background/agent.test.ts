import { describe, test, expect, mock } from "bun:test";
import "../setup";
import { AgentLoop } from "../../src/background/agent/loop";
import { AgentStatus } from "../../src/types";

// Mock LLM Client — now mocking completeStream instead of complete
const mockCompleteStream = mock((request: any, onTextDelta: (delta: string) => void) => {
    // Simulate streaming by calling the delta callback
    onTextDelta("Final answer");
    return Promise.resolve({
        role: "assistant",
        content: "Final answer",
        tool_calls: undefined,
        finish_reason: "stop",
    });
});

mock.module("../../src/background/llm", () => ({
    LLMClient: class {
        complete = mock(() => Promise.resolve({
            role: "assistant",
            content: "Final answer",
            tool_calls: undefined,
            finish_reason: "stop",
        }));
        completeStream = mockCompleteStream;
    },
}));

describe("AgentLoop", () => {
    test("runs simple conversation with streaming", async () => {
        const onStatus = mock();
        const onMessage = mock();
        const onStep = mock();

        const agent = new AgentLoop("test-key", {
            onStatusUpdate: onStatus,
            onMessage: onMessage,
            onStep: onStep,
        });

        await agent.start("Hello", 123);

        expect(mockCompleteStream).toHaveBeenCalled();
        expect(onStatus).toHaveBeenCalledWith(AgentStatus.THINKING, "Analyzing...");
        expect(onStatus).toHaveBeenCalledWith(AgentStatus.IDLE, "Done");
    });

    test("emits thinking steps during simple conversation", async () => {
        const onStatus = mock();
        const onMessage = mock();
        const onStep = mock();

        const agent = new AgentLoop("test-key", {
            onStatusUpdate: onStatus,
            onMessage: onMessage,
            onStep: onStep,
        });

        await agent.start("Hello", 123);

        // Should emit a thinking step (new) and a thinking step (update/done)
        expect(onStep).toHaveBeenCalledTimes(2);

        // First call: new thinking step with running status
        const firstCall = onStep.mock.calls[0];
        expect(firstCall[0].type).toBe("thinking");
        expect(firstCall[0].status).toBe("running");
        expect(firstCall[1]).toBe(false); // update = false (new step)

        // Second call: update thinking step to done
        const secondCall = onStep.mock.calls[1];
        expect(secondCall[0].type).toBe("thinking");
        expect(secondCall[0].status).toBe("done");
        expect(secondCall[0].durationMs).toBeDefined();
        expect(secondCall[1]).toBe(true); // update = true
    });
});
