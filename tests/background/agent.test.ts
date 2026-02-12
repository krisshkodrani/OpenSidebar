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
        private model = "google/gemini-2.5-flash-lite";
        complete = mock(() => Promise.resolve({
            role: "assistant",
            content: "Final answer",
            tool_calls: undefined,
            finish_reason: "stop",
        }));
        completeStream = mockCompleteStream;
        switchModel = mock((m: string) => { this.model = m; });
        getCurrentModel = () => this.model;
    },
    MODEL_FAST: "google/gemini-2.5-flash-lite",
    MODEL_SMART: "moonshotai/kimi-k2.5",
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
        // Unified mode: nudge→escalate→give-up ends with "Stuck" since mock LLM never emits tools
        expect(onStatus).toHaveBeenCalledWith(AgentStatus.IDLE, "Stuck — send a follow-up to continue");
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

        // Guardian decompose step + Unified nudge→escalate→give-up for text-only responses:
        // Pre-loop: guardian thinking(running) "Analyzing task scope..."
        // Turn 1: thinking(running) + thinking(done) → nudge (consecutiveNudges=1)
        // Turn 2: thinking(running) + thinking(done) → escalate (info step) + nudge (reset to 0)
        // Turn 3: thinking(running) + thinking(done) → nudge (consecutiveNudges=1)
        // Turn 4: thinking(running) + thinking(done) → nudge (consecutiveNudges=2)
        // Turn 5: thinking(running) + thinking(done) → give-up (consecutiveNudges=3)
        // = 1 guardian step + 5 turns × 2 thinking steps + 1 info step = 12
        expect(onStep).toHaveBeenCalledTimes(12);

        // First call: guardian decompose thinking step
        const guardianCall = onStep.mock.calls[0];
        expect(guardianCall[0].type).toBe("thinking");
        expect(guardianCall[0].status).toBe("running");
        expect(guardianCall[1]).toBe(false);

        // Second call: turn 1 thinking step with running status
        const firstCall = onStep.mock.calls[1];
        expect(firstCall[0].type).toBe("thinking");
        expect(firstCall[0].status).toBe("running");
        expect(firstCall[1]).toBe(false); // update = false (new step)

        // Third call: update turn 1 thinking step to done
        const secondCall = onStep.mock.calls[2];
        expect(secondCall[0].type).toBe("thinking");
        expect(secondCall[0].status).toBe("done");
        expect(secondCall[0].durationMs).toBeDefined();
        expect(secondCall[1]).toBe(true); // update = true

        // Sixth call (index 5): info step "Switching to smarter model" from escalation
        const escalationStep = onStep.mock.calls[5];
        expect(escalationStep[0].type).toBe("info");
        expect(escalationStep[0].label).toBe("Switching to smarter model");
        expect(escalationStep[1]).toBe(false); // new step, not update
    });
});
