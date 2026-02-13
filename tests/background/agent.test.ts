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
        switchToSmart = mock(() => { this.model = "minimax/minimax-m2.5"; });
        switchToFast = mock(() => { this.model = "google/gemini-2.5-flash-lite"; });
        getCurrentModel = () => this.model;
        getCurrentProvider = () => "openrouter";
    },
    MODEL_FAST: "google/gemini-2.5-flash-lite",
    MODEL_SMART: "minimax/minimax-m2.5",
    stripThinkTags: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

describe("AgentLoop", () => {
    test("runs simple conversation with streaming", async () => {
        const onStatus = mock();
        const onMessage = mock();
        const onStep = mock();

        const agent = new AgentLoop("test-key", undefined, false, {
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

        const agent = new AgentLoop("test-key", undefined, false, {
            onStatusUpdate: onStatus,
            onMessage: onMessage,
            onStep: onStep,
        });

        await agent.start("Hello", 123);

        // Guardian decompose step + Unified nudge→pivot→escalate+pivot→give-up for text-only:
        // Pre-loop: guardian thinking(running) "Analyzing task scope..."
        // Turn 1: thinking(running) + thinking(done) → soft nudge (consecutiveNudges=1)
        // Turn 2: thinking(running) + thinking(done) → pivot (info "Rethinking approach") → reset
        // Turn 3: thinking(running) + thinking(done) → nudge (consecutiveNudges=1)
        // Turn 4: thinking(running) + thinking(done) → escalate+pivot (info "Rethinking" + info "Switching")
        // Turn 5: thinking(running) + thinking(done) → nudge (consecutiveNudges=1)
        // Turn 6: thinking(running) + thinking(done) → nudge (consecutiveNudges=2)
        // Turn 7: thinking(running) + thinking(done) → give-up (consecutiveNudges=3)
        // = 1 guardian + 7 turns × 2 thinking + 1 pivot info + 2 escalate+pivot info = 18
        expect(onStep).toHaveBeenCalledTimes(18);

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

        // Index 5: info step "Rethinking approach from scratch" from first pivot
        const pivotStep = onStep.mock.calls[5];
        expect(pivotStep[0].type).toBe("info");
        expect(pivotStep[0].label).toBe("Rethinking approach from scratch");
        expect(pivotStep[1]).toBe(false);
    });
});
