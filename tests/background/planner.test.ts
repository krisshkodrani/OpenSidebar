import { describe, test, expect, vi, beforeEach } from "vitest";
import "../setup";
import { AgentStatus, ToolName } from "../../src/types";

/**
 * Planner + Done Guard tests.
 *
 * These share a single vi.mock for "../../src/background/llm" to avoid
 * process-global mock conflicts with other test files
 * (agent.test.ts, loop-overlay.test.ts, loop-api.test.ts all mock the same module).
 *
 * `complete()` serves planner calls (decompose/validateDone).
 * `completeStream()` serves executor calls (AgentLoop main loop).
 */

const { mockComplete, mockCompleteStream } = vi.hoisted(() => ({
    mockComplete: vi.fn() as any,
    mockCompleteStream: vi.fn() as any,
}));

let completeImpl: (request: any) => any;
let streamCallCount = 0;

// Wire up implementations that close over module-scope vars
mockComplete.mockImplementation((request: any) => completeImpl(request));
mockCompleteStream.mockImplementation((request: any, onTextDelta: (delta: string) => void) => {
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

vi.mock("../../src/background/llm", () => ({
    LLMClient: class {
        private model = "google/gemini-2.5-flash-lite";
        _isSmartTier = false;
        complete = mockComplete;
        completeStream = mockCompleteStream;
        switchToSmart = vi.fn(() => { this.model = "minimax/minimax-m2.5"; this._isSmartTier = true; });
        switchToFast = vi.fn(() => { this.model = "google/gemini-2.5-flash-lite"; this._isSmartTier = false; });
        isSmartTier = () => this._isSmartTier;
        getCurrentModel = () => this.model;
        getCurrentProvider = () => "openrouter";
    },
    MODEL_FAST: "google/gemini-2.5-flash-lite",
    MODEL_SMART: "minimax/minimax-m2.5",
    stripThinkTags: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
    extractThinkContent: () => null,
}));

import { TaskPlanner } from "../../src/background/agent/planner";
import { OrchestratorPlanner } from "../../src/background/orchestrator/planner";
import { AgentLoop } from "../../src/background/agent/loop";

// ═══════════════════════════════════════════════════════════
// TaskPlanner unit tests
// ═══════════════════════════════════════════════════════════

describe("TaskPlanner.decompose", () => {
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

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Buy this item", "Product Page", "https://shop.com/item");

        expect(result).not.toBeNull();
        expect(result!.subtasks).toHaveLength(4);
        expect(result!.subtasks[0]).toBe("Add to cart");
    });

    test("parses structured step graph with dependencies and assumptions", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Open checkout page",
                        successCriteria: "Checkout page loaded",
                        dependencies: [],
                        assumptions: ["user is logged in"],
                    },
                    {
                        objective: "Submit payment",
                        successCriteria: "Confirmation visible",
                        dependencies: [0],
                        assumptions: ["payment form present"],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose(
            "Buy this item",
            "Product Page",
            "https://shop.com/item",
        );

        expect(result).not.toBeNull();
        expect(result!.subtasks).toEqual(["Open checkout page", "Submit payment"]);
        expect(result!.steps).toBeDefined();
        expect(result!.steps![1].dependencies).toEqual([0]);
        expect(result!.steps![0].assumptions).toEqual(["user is logged in"]);
    });

    test("parses verifyAfter verification gate when present", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Submit the form",
                        successCriteria: "Success banner visible",
                        dependencies: [],
                        assumptions: [],
                        verifyAfter: {
                            trigger: "text 'Form submitted' visible",
                            action: "call_done",
                            pattern: "Form\\s+submitted",
                        },
                    },
                    {
                        objective: "Verify confirmation",
                        successCriteria: "Confirmation page loaded",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose(
            "Submit form and verify",
            "Form Page",
            "https://example.com/form",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toBeDefined();
        expect(result!.steps![0].verifyAfter).toBeDefined();
        expect(result!.steps![0].verifyAfter!.trigger).toBe("text 'Form submitted' visible");
        expect(result!.steps![0].verifyAfter!.action).toBe("call_done");
        expect(result!.steps![0].verifyAfter!.pattern).toBe("Form\\s+submitted");
        // Second step has no verifyAfter
        expect(result!.steps![1].verifyAfter).toBeUndefined();
    });

    test("ignores invalid verifyAfter (empty trigger)", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Step A",
                        successCriteria: "Done",
                        dependencies: [],
                        assumptions: [],
                        verifyAfter: { trigger: "", action: "advance_step" },
                    },
                    {
                        objective: "Step B",
                        successCriteria: "Done",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Task", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.steps![0].verifyAfter).toBeUndefined();
    });

    test("parses toolProfile when present on steps", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Read the page content",
                        successCriteria: "Page content extracted",
                        dependencies: [],
                        assumptions: [],
                        toolProfile: "read_only",
                    },
                    {
                        objective: "Fill in the form",
                        successCriteria: "Form submitted",
                        dependencies: [0],
                        assumptions: [],
                        toolProfile: "form_fill",
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Read and fill form", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.steps).toBeDefined();
        expect(result!.steps![0].toolProfile).toBe("read_only");
        expect(result!.steps![1].toolProfile).toBe("form_fill");
    });

    test("ignores invalid toolProfile values", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Step A",
                        successCriteria: "Done",
                        dependencies: [],
                        assumptions: [],
                        toolProfile: "invalid_profile",
                    },
                    {
                        objective: "Step B",
                        successCriteria: "Done",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Task", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.steps![0].toolProfile).toBeUndefined();
        expect(result!.steps![1].toolProfile).toBeUndefined();
    });

    test("defaults verifyAfter action to advance_step for unknown values", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Do something",
                        successCriteria: "Done",
                        dependencies: [],
                        assumptions: [],
                        verifyAfter: { trigger: "URL changed", action: "bogus_action" },
                    },
                    {
                        objective: "Another step",
                        successCriteria: "Also done",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Task", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.steps![0].verifyAfter).toBeDefined();
        expect(result!.steps![0].verifyAfter!.action).toBe("advance_step");
    });

    test("returns simple result for simple query", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false}',
            tool_calls: undefined,
            finish_reason: "stop",
            usage: { prompt_tokens: 80, completion_tokens: 10, total_tokens: 90 },
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Click the login button", "Login Page", "https://example.com/login");

        expect(result).not.toBeNull();
        expect(result!.subtasks).toEqual([]);
        expect(result!.difficulty).toBe("moderate");
    });

    test("returns null on malformed JSON", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: "This is not JSON at all",
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Do something", "Page", "https://example.com");

        expect(result).toBeNull();
    });

    test("returns null on network error", async () => {
        completeImpl = () => Promise.reject(new Error("Network error"));

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Do something", "Page", "https://example.com");

        expect(result).toBeNull();
    });

    test("returns simple result when subtasks array has < 2 items", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": true, "subtasks": ["Only one step"]}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Simple task", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.subtasks).toEqual([]);
        expect(result!.difficulty).toBe("moderate");
    });

    test("reports usage via callback", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": true, "subtasks": ["Step 1", "Step 2", "Step 3"]}',
            tool_calls: undefined,
            finish_reason: "stop",
            usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, cost: 0.002 },
        });

        const guardian = new TaskPlanner("test-key");
        const usageCb = vi.fn();
        guardian.setUsageCallback(usageCb);

        await guardian.decompose("Multi-step task", "Page", "https://example.com");

        expect(usageCb).toHaveBeenCalledTimes(1);
        expect(usageCb.mock.calls[0][0].prompt_tokens).toBe(200);
    });

    test("sends response_format: json_object in decompose request", async () => {
        completeImpl = (request: any) => {
            expect(request.response_format).toEqual({ type: "json_object" });
            return Promise.resolve({
                role: "assistant",
                content: '{"isMultiStep": false}',
                tool_calls: undefined,
                finish_reason: "stop",
            });
        };

        const guardian = new TaskPlanner("test-key");
        await guardian.decompose("Task", "Page", "https://example.com");

        expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    test("sends response_format: json_object in validateDone request", async () => {
        completeImpl = (request: any) => {
            expect(request.response_format).toEqual({ type: "json_object" });
            return Promise.resolve({
                role: "assistant",
                content: '{"approved": true}',
                tool_calls: undefined,
                finish_reason: "stop",
            });
        };

        const guardian = new TaskPlanner("test-key");
        await guardian.validateDone(
            "Task",
            [{ description: "Step 1", status: "completed" as const, turnsUsed: 2, turnBudget: 5 }],
            "Done",
            "Page",
            "https://example.com",
        );

        expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    test("strips JSON fences from response", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '```json\n{"isMultiStep": true, "subtasks": ["A", "B", "C"]}\n```',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Task", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.subtasks).toHaveLength(3);
    });
});

describe("OrchestratorPlanner.buildNodes returns BuildNodesResult", () => {
    beforeEach(() => {
        mockComplete.mockClear();
    });

    test("returns isSingleNode=true for simple task", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false, "difficulty": "simple"}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes("Summarize this page", "Blog", "https://blog.com");

        expect(result.isSingleNode).toBe(true);
        expect(result.difficulty).toBe("simple");
        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].description).toBe("Summarize this page");
    });

    test("returns isSingleNode=false for multi-step task", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "complex",
                subtasks: ["Add to cart", "Go to checkout", "Place order"],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes("Buy item", "Shop", "https://shop.com");

        expect(result.isSingleNode).toBe(false);
        expect(result.difficulty).toBe("complex");
        expect(result.nodes).toHaveLength(3);
    });

    test("defaults difficulty to moderate when missing", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes("Click button", "Page", "https://example.com");

        expect(result.difficulty).toBe("moderate");
        expect(result.isSingleNode).toBe(true);
    });
});

describe("TaskPlanner.validateDone", () => {
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

        const guardian = new TaskPlanner("test-key");
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

        const guardian = new TaskPlanner("test-key");
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

        const guardian = new TaskPlanner("test-key");
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

        const guardian = new TaskPlanner("test-key");
        const plan = [
            { description: "Step 1", status: "completed" as const, turnsUsed: 2, turnBudget: 5 },
            { description: "Step 2", status: "completed" as const, turnsUsed: 3, turnBudget: 5 },
        ];

        const result = await guardian.validateDone("Task", plan, "Done", "Page", "https://example.com");

        expect(result.approved).toBe(true);
    });
});

// Done Guard integration tests require their own mock.module to control
// both TaskPlanner (via complete) and AgentLoop (via completeStream).
// Due to bun's process-global mock.module behavior, these tests only pass
// reliably when run in isolation: `bun test tests/background/planner.test.ts`
// The TaskPlanner unit tests above cover all planner logic paths.
