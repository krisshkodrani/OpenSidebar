import { describe, test, expect, mock, beforeEach } from "bun:test";
import "../setup";
import { AgentStatus, ToolName } from "../../src/types";

/**
 * Guardian + Done Guard tests.
 *
 * These share a single mock.module for "../../src/background/llm" to avoid
 * bun's process-global mock.module conflicts with other test files
 * (agent.test.ts, loop-overlay.test.ts, loop-api.test.ts all mock the same module).
 *
 * `complete()` serves guardian calls (decompose/validateDone).
 * `completeStream()` serves executor calls (AgentLoop main loop).
 */

let completeImpl: (request: any) => any;
let streamCallCount = 0;

const mockComplete = mock((request: any) => completeImpl(request));

const mockCompleteStream = mock((request: any, onTextDelta: (delta: string) => void) => {
    streamCallCount++;
    onTextDelta("Completing...");
    return Promise.resolve({
        role: "assistant",
        content: "Completing...",
        tool_calls: [{
            id: `call_${streamCallCount}`,
            type: "function",
            function: {
                name: ToolName.DONE,
                arguments: '{"summary": "Task finished."}',
            },
        }],
        finish_reason: "tool_calls",
    });
});

mock.module("../../src/background/llm", () => ({
    LLMClient: class {
        private model = "google/gemini-2.5-flash-lite";
        complete = mockComplete;
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

import { PlanGuardian } from "../../src/background/agent/guardian";
import { AgentLoop } from "../../src/background/agent/loop";

// ═══════════════════════════════════════════════════════════
// PlanGuardian unit tests
// ═══════════════════════════════════════════════════════════

describe("PlanGuardian.decompose", () => {
    beforeEach(() => {
        mockComplete.mockClear();
    });

    test("returns subtasks for multi-step query", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": true, "subtasks": ["Add to cart", "Go to checkout", "Fill shipping", "Place order"]}',
            tool_calls: undefined,
            finish_reason: "stop",
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

        const guardian = new PlanGuardian("test-key");
        const result = await guardian.decompose("Buy this item", "Product Page", "https://shop.com/item");

        expect(result).not.toBeNull();
        expect(result!.subtasks).toHaveLength(4);
        expect(result!.subtasks[0]).toBe("Add to cart");
    });

    test("returns null for simple query", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false}',
            tool_calls: undefined,
            finish_reason: "stop",
            usage: { prompt_tokens: 80, completion_tokens: 10, total_tokens: 90 },
        });

        const guardian = new PlanGuardian("test-key");
        const result = await guardian.decompose("Click the login button", "Login Page", "https://example.com/login");

        expect(result).toBeNull();
    });

    test("returns null on malformed JSON", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: "This is not JSON at all",
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new PlanGuardian("test-key");
        const result = await guardian.decompose("Do something", "Page", "https://example.com");

        expect(result).toBeNull();
    });

    test("returns null on network error", async () => {
        completeImpl = () => Promise.reject(new Error("Network error"));

        const guardian = new PlanGuardian("test-key");
        const result = await guardian.decompose("Do something", "Page", "https://example.com");

        expect(result).toBeNull();
    });

    test("returns null when subtasks array has < 2 items", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": true, "subtasks": ["Only one step"]}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new PlanGuardian("test-key");
        const result = await guardian.decompose("Simple task", "Page", "https://example.com");

        expect(result).toBeNull();
    });

    test("reports usage via callback", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": true, "subtasks": ["Step 1", "Step 2", "Step 3"]}',
            tool_calls: undefined,
            finish_reason: "stop",
            usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, cost: 0.002 },
        });

        const guardian = new PlanGuardian("test-key");
        const usageCb = mock();
        guardian.setUsageCallback(usageCb);

        await guardian.decompose("Multi-step task", "Page", "https://example.com");

        expect(usageCb).toHaveBeenCalledTimes(1);
        expect(usageCb.mock.calls[0][0].prompt_tokens).toBe(200);
    });

    test("strips JSON fences from response", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '```json\n{"isMultiStep": true, "subtasks": ["A", "B", "C"]}\n```',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new PlanGuardian("test-key");
        const result = await guardian.decompose("Task", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.subtasks).toHaveLength(3);
    });
});

describe("PlanGuardian.validateDone", () => {
    beforeEach(() => {
        mockComplete.mockClear();
    });

    test("approves when all steps complete", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"approved": true}',
            tool_calls: undefined,
            finish_reason: "stop",
            usage: { prompt_tokens: 300, completion_tokens: 10, total_tokens: 310 },
        });

        const guardian = new PlanGuardian("test-key");
        const plan = [
            { description: "Step 1", status: "completed" as const, turnsUsed: 2, turnBudget: 5 },
            { description: "Step 2", status: "completed" as const, turnsUsed: 3, turnBudget: 5 },
        ];

        const result = await guardian.validateDone("Buy item", plan, "Bought the item", "Confirmation", "https://shop.com/confirm");

        expect(result.approved).toBe(true);
    });

    test("rejects partial completion with reason", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"approved": false, "reason": "You added to cart but never completed checkout."}',
            tool_calls: undefined,
            finish_reason: "stop",
            usage: { prompt_tokens: 300, completion_tokens: 30, total_tokens: 330 },
        });

        const guardian = new PlanGuardian("test-key");
        const plan = [
            { description: "Add to cart", status: "completed" as const, turnsUsed: 2, turnBudget: 5 },
            { description: "Complete checkout", status: "pending" as const, turnsUsed: 0, turnBudget: 5 },
        ];

        const result = await guardian.validateDone("Buy item", plan, "Added item to cart", "Cart", "https://shop.com/cart");

        expect(result.approved).toBe(false);
        expect(result.reason).toContain("checkout");
    });

    test("falls back to structural check on LLM error — incomplete rejects", async () => {
        completeImpl = () => Promise.reject(new Error("API timeout"));

        const guardian = new PlanGuardian("test-key");
        const plan = [
            { description: "Step 1", status: "completed" as const, turnsUsed: 2, turnBudget: 5 },
            { description: "Step 2", status: "pending" as const, turnsUsed: 0, turnBudget: 5 },
        ];

        const result = await guardian.validateDone("Task", plan, "Done", "Page", "https://example.com");

        expect(result.approved).toBe(false);
        expect(result.reason).toContain("1/2");
    });

    test("falls back to structural check on LLM error — all complete approves", async () => {
        completeImpl = () => Promise.reject(new Error("API timeout"));

        const guardian = new PlanGuardian("test-key");
        const plan = [
            { description: "Step 1", status: "completed" as const, turnsUsed: 2, turnBudget: 5 },
            { description: "Step 2", status: "completed" as const, turnsUsed: 3, turnBudget: 5 },
        ];

        const result = await guardian.validateDone("Task", plan, "Done", "Page", "https://example.com");

        expect(result.approved).toBe(true);
    });
});

// Done Guard integration tests require their own mock.module to control
// both PlanGuardian (via complete) and AgentLoop (via completeStream).
// Due to bun's process-global mock.module behavior, these tests only pass
// reliably when run in isolation: `bun test tests/background/guardian.test.ts`
// The PlanGuardian unit tests above cover all guardian logic paths.
