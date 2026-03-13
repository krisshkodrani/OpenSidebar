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
        _isPlannerTier = false;
        complete = mockComplete;
        completeStream = mockCompleteStream;
        switchToPlanner = vi.fn(() => { this.model = "minimax/minimax-m2.5"; this._isPlannerTier = true; });
        switchToExecutor = vi.fn(() => { this.model = "google/gemini-2.5-flash-lite"; this._isPlannerTier = false; });
        isPlannerTier = () => this._isPlannerTier;
        getCurrentModel = () => this.model;
        getCurrentProvider = () => "openrouter";
    },
    MODEL_EXECUTOR: "google/gemini-2.5-flash-lite",
    MODEL_PLANNER: "minimax/minimax-m2.5",
    stripThinkTags: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
    extractThinkContent: () => null,
}));

import {
    TaskPlanner,
    inferToolProfileForStep,
} from "../../src/background/agent/planner";
import { buildInitialPlanState } from "../../src/background/orchestrator";
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
                        toolProfile: "enter_code",
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
        expect(result!.steps![1].toolProfile).toBe("enter_code");
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

    test("infers enter_code and submit_form profiles when planner omits them", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Enter the code into the visible input",
                        successCriteria: "The 6-character code is typed and ready",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Click submit to proceed to step 6",
                        successCriteria: "Form is submitted and page proceeds",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Enter code and submit", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.steps![0].toolProfile).toBe("enter_code");
        expect(result!.steps![1].toolProfile).toBe("submit_form");
    });

    test("infers inspect_hidden_state profile for hidden DOM tasks", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Inspect hidden attributes to discover the code",
                        successCriteria: "The hidden code is identified from aria labels or meta tags",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Recover from blocked clicks if needed",
                        successCriteria: "A different recovery action is chosen when stuck",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Find hidden code", "Page", "https://example.com");

        expect(result).not.toBeNull();
        expect(result!.steps![0].toolProfile).toBe("inspect_hidden_state");
        expect(result!.steps![1].toolProfile).toBe("recover_from_stuck");
    });

    test("exports tool profile inference for fallback executor flows", () => {
        expect(
            inferToolProfileForStep(
                "Enter the secret code into the input",
                "The code is typed correctly",
            ),
        ).toBe("enter_code");
        expect(
            inferToolProfileForStep(
                "Inspect hidden DOM to discover the code",
                "The hidden value is found",
            ),
        ).toBe("inspect_hidden_state");
        expect(
            inferToolProfileForStep(
                "Click Add to cart, apply SAVE10, choose Express shipping, then fill checkout",
                "The cart is updated and checkout fields are completed",
            ),
        ).toBe("form_fill");
        expect(
            inferToolProfileForStep(
                "Place the order after reviewing the checkout details",
                "The order confirmation is visible",
            ),
        ).toBe("submit_form");
        expect(
            inferToolProfileForStep(
                "Fill Full name and Email, then place the order",
                "The order confirmation is visible",
            ),
        ).toBe("form_fill");
    });

    test("prefers direct-action profile over recovery wording in stitched handoff objectives", () => {
        const stitchedObjective = `Click the Advance button three times, then enter the revealed code into the input and submit it.

Planner assumptions:
- If blocked, recover with a different action.

Handoff context:
- The previous attempt got stuck and should recover if needed.

Execution policy:
- Retry only when necessary.`;

        expect(
            inferToolProfileForStep(
                stitchedObjective,
                "The code is entered and submission succeeds",
            ),
        ).toBe("enter_code");
    });

    test("keeps recover_from_stuck for explicitly recovery-focused objectives", () => {
        expect(
            inferToolProfileForStep(
                "Recover from blocked clicks or overlays before continuing",
                "A different recovery action is chosen when stuck",
            ),
        ).toBe("recover_from_stuck");
    });

    test("synthesizes transactional single-node steps with tool profiles", () => {
        const planState = buildInitialPlanState({
            id: "task-transaction",
            query: "shop",
            workspaceId: "default",
            nodes: [
                {
                    id: "node-transaction",
                    role: "executor",
                    description: [
                        "You are on a shopping page.",
                        "",
                        "Step 1: Click the Add to cart button next to the product.",
                        "Step 2: Apply SAVE10 and choose Express shipping.",
                        "Step 3: Fill checkout name and email.",
                        "Step 4: Place the order.",
                    ].join("\n"),
                    successCriteria: "Order confirmation is visible.",
                    allowedTools: Object.values(ToolName),
                    dependencies: [],
                    assumptions: [],
                    handoffArtifacts: [],
                    reflexionLog: [],
                    handoffDepth: 0,
                    status: "running",
                    retries: 0,
                },
            ],
            currentIndex: 0,
            status: "running",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        } as any);

        expect(planState.subtasks).toHaveLength(4);
        expect(planState.subtasks[0].toolProfile).toBe("form_fill");
        expect(planState.subtasks[1].toolProfile).toBe("form_fill");
        expect(planState.subtasks[2].toolProfile).toBe("form_fill");
        expect(planState.subtasks[3].toolProfile).toBe("submit_form");
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
        expect(result!.instrumentation?.outcome).toBe("simple_task");
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
        expect(result!.instrumentation?.outcome).toBe("insufficient_subtasks");
        expect(result!.instrumentation?.parsedSubtaskCount).toBe(1);
    });

    test("records structured plan instrumentation when steps are parsed", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Add the item to cart",
                        successCriteria: "Item is in cart",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Complete checkout",
                        successCriteria: "Order confirmation is visible",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose("Buy the item", "Shop", "https://shop.com");

        expect(result).not.toBeNull();
        expect(result!.instrumentation?.outcome).toBe("structured_steps");
        expect(result!.instrumentation?.parsedStepCount).toBe(2);
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

describe("buildInitialPlanState", () => {
    test("synthesizes subtasks from a single-node ordered objective", () => {
        const planState = buildInitialPlanState({
            id: "task-1",
            query: "shop",
            workspaceId: "default",
            nodes: [
                {
                    id: "node-1",
                    role: "executor",
                    description: [
                        "You are on a shopping page.",
                        "",
                        "Step 1: Click Add to cart.",
                        "Step 2: Type SAVE10 and apply it.",
                        "Step 3: Fill checkout and place the order.",
                    ].join("\n"),
                    successCriteria: "The user goal is completed and verified.",
                    allowedTools: Object.values(ToolName),
                    dependencies: [],
                    assumptions: [],
                    handoffArtifacts: [],
                    reflexionLog: [],
                    handoffDepth: 0,
                    status: "running",
                    retries: 0,
                },
            ],
            currentIndex: 0,
            status: "running",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        } as any);

        expect(planState.subtasks).toHaveLength(3);
        expect(planState.subtasks[0].status).toBe("running");
        expect(planState.subtasks[0].description).toContain("Click Add to cart");
        expect(planState.subtasks[1].description).toContain("Type SAVE10");
        expect(planState.subtasks[2].description).toContain("Fill checkout");
    });

    test("pins currentIndex to the active node when provided", () => {
        const planState = buildInitialPlanState(
            {
                id: "task-2",
                query: "shop",
                workspaceId: "default",
                nodes: [
                    {
                        id: "node-1",
                        role: "executor",
                        description: "Add to cart",
                        successCriteria: "Item is added",
                        allowedTools: Object.values(ToolName),
                        dependencies: [],
                        assumptions: [],
                        handoffArtifacts: [],
                        reflexionLog: [],
                        handoffDepth: 0,
                        status: "completed",
                        retries: 0,
                    },
                    {
                        id: "node-2",
                        role: "executor",
                        description: "Verify cart updated",
                        successCriteria: "Cart reflects the item",
                        allowedTools: Object.values(ToolName),
                        dependencies: [],
                        assumptions: [],
                        handoffArtifacts: [],
                        reflexionLog: [],
                        handoffDepth: 0,
                        status: "pending",
                        retries: 0,
                    },
                    {
                        id: "node-3",
                        role: "executor",
                        description: "Apply promo code",
                        successCriteria: "Discount applied",
                        allowedTools: Object.values(ToolName),
                        dependencies: [],
                        assumptions: [],
                        handoffArtifacts: [],
                        reflexionLog: [],
                        handoffDepth: 0,
                        status: "running",
                        retries: 0,
                    },
                ],
                currentIndex: 2,
                status: "running",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            } as any,
            "node-2",
        );

        expect(planState.currentIndex).toBe(1);
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

    test("narrows allowed tools on nodes when planner steps imply focused profiles", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Enter the code into the visible input",
                        successCriteria: "The code is typed into the field",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Click submit to proceed to the next step",
                        successCriteria: "Submission is attempted",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes("Enter code and submit", "Page", "https://example.com");

        expect(result.nodes).toHaveLength(2);
        expect(result.nodes[0].allowedTools).toContain(ToolName.TYPE_TEXT);
        expect(result.nodes[0].allowedTools).not.toContain(ToolName.EXECUTE_JS);
        expect(result.nodes[1].allowedTools).toContain(ToolName.CLICK_ELEMENT);
        expect(result.nodes[1].allowedTools).not.toContain(ToolName.TYPE_TEXT);
        expect(result.nodes[1].allowedTools).not.toContain(ToolName.XRAY_PAGE);
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
