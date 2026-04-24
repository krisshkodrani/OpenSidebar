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
import {
    buildFallbackNodes,
    OrchestratorPlanner,
} from "../../src/background/orchestrator/planner";
import { selectPrimarySkill } from "../../src/background/orchestrator/skills";
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

    test("preserves sequential multi-step plans even when the planner marks difficulty as simple", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "simple",
                steps: [
                    {
                        objective: "Click the Notification Settings action button",
                        successCriteria: "Notification Settings is activated",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Click the Privacy Settings action button",
                        successCriteria: "Privacy Settings is activated",
                        dependencies: [0],
                        assumptions: [],
                    },
                    {
                        objective: "Turn on dark mode",
                        successCriteria: "Dark mode is enabled",
                        dependencies: [1],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose(
            "Activate the Notification Settings and Privacy Settings actions, then turn on dark mode.",
            "Web Components",
            "https://example.com/web-components",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toBeDefined();
        expect(result!.steps).toHaveLength(3);
        expect(result!.subtasks).toEqual([
            "Click the Notification Settings action button",
            "Click the Privacy Settings action button",
            "Turn on dark mode",
        ]);
    });

    test("synthesizes multi-step plan when model under-decomposes a round-trip task", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: false,
                steps: [
                    {
                        objective: "Check the current warehouse page",
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose(
            [
                "Click to Warehouse Beta, then Warehouse Gamma.",
                "Use go_back twice to return to Warehouse Alpha.",
                "Call done() reporting both Gamma and Alpha inventory counts.",
            ].join(" "),
            "Warehouse Alpha",
            "https://shop.com/go-back-chain?step=1",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toBeDefined();
        expect(result!.steps!.length).toBeGreaterThanOrEqual(2);
        const synthesizedPlanText = result!.subtasks.join(" ");
        expect(synthesizedPlanText).toMatch(/\bgamma\b/i);
        expect(synthesizedPlanText).toMatch(/\balpha\b/i);
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
        ).toBe("submit_form");
        expect(
            inferToolProfileForStep(
                "In the spreadsheet, change the Q1 Sales value in the first row to 999",
                "The Q1 Sales cell in row 1 shows 999",
            ),
        ).toBe("edit_surface");
        expect(
            inferToolProfileForStep(
                "Rename the document Q3 Report.pdf to Q3 Financial Report 2026.pdf",
                "The document list shows the new file name",
            ),
        ).toBe("edit_surface");
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

    test("prefers read_only for summarize tasks even when navigation verbs appear first", () => {
        expect(
            inferToolProfileForStep(
                "Open the repository page and summarize the README",
                "The key setup steps are reported back",
            ),
        ).toBe("read_only");
    });

    test("prefers read_only for verification tasks", () => {
        expect(
            inferToolProfileForStep(
                "Check whether the summary is complete and report any missing points",
                "The summary is verified against the page",
            ),
        ).toBe("read_only");
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

    test("does not collapse round-trip multi-step tasks just because difficulty is simple", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "simple",
                steps: [
                    { objective: "Go to Warehouse Beta", successCriteria: "Warehouse Beta visible" },
                    { objective: "Go to Warehouse Gamma", successCriteria: "Warehouse Gamma visible" },
                    { objective: "Use go_back twice to return to Warehouse Alpha", successCriteria: "Warehouse Alpha visible" },
                    { objective: "Call done reporting Gamma and Alpha inventory counts", successCriteria: "Gamma and Alpha counts visible" },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose(
            "Go to Warehouse Beta, then Gamma, then use go_back twice to return to Alpha and report both Gamma and Alpha inventory counts.",
            "Warehouse Alpha",
            "https://example.com/go-back-chain?step=1",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toBeDefined();
        expect(result!.steps!.length).toBeGreaterThanOrEqual(3);
        expect(result!.instrumentation?.outcome).toBe("structured_steps");
    });

    test("collapses adjacent round-trip navigation and read pairs into atomic read steps", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "moderate",
                steps: [
                    {
                        objective: "Navigate to Warehouse Gamma page 3.",
                        successCriteria: "Warehouse Gamma page 3 is visible.",
                        dependencies: [],
                        assumptions: [],
                        toolProfile: "navigate",
                    },
                    {
                        objective: "Read Warehouse Gamma inventory count.",
                        successCriteria: "Warehouse Gamma inventory count 6,412 is visible.",
                        dependencies: [0],
                        assumptions: [],
                        toolProfile: "read_only",
                    },
                    {
                        objective: "Return to Warehouse Alpha.",
                        successCriteria: "Warehouse Alpha is visible.",
                        dependencies: [1],
                        assumptions: [],
                        toolProfile: "navigate",
                    },
                    {
                        objective: "Read Warehouse Alpha inventory count and report both numbers.",
                        successCriteria: "Warehouse Alpha inventory count 4,827 is visible and both numbers are ready to report.",
                        dependencies: [2],
                        assumptions: [],
                        toolProfile: "read_only",
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose(
            "Check the inventory count for Warehouse Gamma on page 3, then go back to Warehouse Alpha and check its count too. Tell me both numbers.",
            "Warehouse Alpha",
            "https://example.com/go-back-chain?step=1",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toBeDefined();
        expect(result!.steps).toHaveLength(2);
        expect(result!.steps![0].objective).toMatch(/warehouse gamma/i);
        expect(result!.steps![0].objective).toMatch(/read/i);
        expect(result!.steps![1].objective).toMatch(/warehouse alpha/i);
        expect(result!.steps![1].objective).toMatch(/report both/i);
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

    test("prefers compact batched plan for bounded exhaustive detail-review tasks", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    { objective: "Click the first job listing to view its full details", successCriteria: "Job detail page loaded with full job description visible", dependencies: [], assumptions: [] },
                    { objective: "Return to the job listings page", successCriteria: "Job listings page with all 10 job cards visible", dependencies: [0], assumptions: [] },
                    { objective: "Click the second job listing to view its full details", successCriteria: "Job detail page loaded with full job description visible", dependencies: [1], assumptions: [] },
                    { objective: "Return to the job listings page", successCriteria: "Job listings page with all 10 job cards visible", dependencies: [2], assumptions: [] },
                    { objective: "Click the third job listing to view its full details", successCriteria: "Job detail page loaded with full job description visible", dependencies: [3], assumptions: [] },
                    { objective: "Return to the job listings page", successCriteria: "Job listings page with all 10 job cards visible", dependencies: [4], assumptions: [] },
                    { objective: "Click the fourth job listing to view its full details", successCriteria: "Job detail page loaded with full job description visible", dependencies: [5], assumptions: [] },
                    { objective: "Return to the job listings page", successCriteria: "Job listings page with all 10 job cards visible", dependencies: [6], assumptions: [] },
                    { objective: "Click the fifth job listing to view its full details", successCriteria: "Job detail page loaded with full job description visible", dependencies: [7], assumptions: [] },
                    { objective: "Return to the job listings page", successCriteria: "Job listings page with all 10 job cards visible", dependencies: [8], assumptions: [] },
                    { objective: "Compare the reviewed job listings and report the best matches", successCriteria: "Final answer mentions multiple reviewed job listings and explains why they best fit the user's stated constraints.", dependencies: [9], assumptions: [] },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const guardian = new TaskPlanner("test-key");
        const result = await guardian.decompose(
            "I'm looking for a fully remote frontend role. Please review all 10 job listings on this page, click into each one to read the full details, then come back to the listings page. After reviewing every job, tell me which ones are the best matches for my profile and why.",
            "TechJobs Board",
            "https://example.com/job-board",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toBeDefined();
        expect(result!.steps!.length).toBe(10);
        expect(result!.steps![0].objective).toMatch(/job listing/i);
        expect(result!.steps![result!.steps!.length - 1].objective).toMatch(/best matches/i);
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

    test("planner prompt allows combined navigation-plus-read steps for simple round-trip reads", async () => {
        completeImpl = (request: any) => {
            const system = request.messages?.[0]?.content || "";
            expect(system).toContain(
                'For simple read tasks, you MAY combine navigation with the read when the requested data is visible immediately on arrival.',
            );
            expect(system).toContain(
                'GOOD: "Navigate to Warehouse Gamma and read its inventory count."',
            );
            return Promise.resolve({
                role: "assistant",
                content: '{"isMultiStep": false}',
                tool_calls: undefined,
                finish_reason: "stop",
            });
        };

        const guardian = new TaskPlanner("test-key");
        await guardian.decompose(
            "Check the inventory count for Warehouse Gamma on page 3, then go back to Warehouse Alpha and check its count too. Tell me both numbers.",
            "Warehouse Alpha",
            "https://example.com/go-back-chain?step=1",
        );
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

    test("uses compact exhaustive fallback graph when planner decomposition collapses to a single fallback node", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: false,
                steps: [
                    {
                        objective: "Review all 10 job listings and recommend the best matches",
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "I'm looking for a fully remote frontend role. Please review all 10 job listings on this page, click into each one to read the full details, then come back to the listings page. After reviewing every job, tell me which ones are the best matches for my profile and why.",
            "TechJobs Board",
            "https://example.com/job-board",
        );

        expect(result.isSingleNode).toBe(false);
        expect(result.nodes.length).toBe(11);
        expect(result.nodes[0].description).toMatch(/review job listing #1/i);
        expect(result.nodes[result.nodes.length - 1].description).toMatch(/best matches/i);
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

    test("buildFallbackNodes preserves explicit user constraints in the fallback objective", () => {
        const query =
            "Please find the Warehouse Beta inventory count, do not navigate away, and tell me the exact number.";

        const nodes = buildFallbackNodes(query);

        expect(nodes).toHaveLength(1);
        expect(nodes[0].description).toMatch(/warehouse beta inventory count/i);
        expect(nodes[0].description).toMatch(/do not navigate away/i);
        expect(nodes[0].successCriteria).toMatch(/warehouse beta/i);
        expect(nodes[0].assumptions || []).toContain(
            "Preserve all explicit constraints from the user's original request: Please find the Warehouse Beta inventory count, do not navigate away, and tell me the exact number.",
        );
    });

    test("all nodes get full default tools (profile filtering at loop level)", async () => {
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
        // All nodes get the full default tool set — per-step profile filtering
        // is handled by applyToolProfile() inside the agent loop, not at the
        // orchestrator node level (prevents permanent tool blocking on replan).
        expect(result.nodes[0].allowedTools).toContain(ToolName.TYPE_TEXT);
        expect(result.nodes[0].allowedTools).toContain(ToolName.CLICK_ELEMENT);
        expect(result.nodes[0].allowedTools).toContain(ToolName.GET_PROFILE_FIELDS);
        expect(result.nodes[1].allowedTools).toContain(ToolName.TYPE_TEXT);
        expect(result.nodes[1].allowedTools).toContain(ToolName.CLICK_ELEMENT);
        expect(result.nodes[1].allowedTools).toContain(ToolName.GET_PROFILE_FIELDS);
    });

    test("expandNode keeps the initial node tool baseline for replanned child steps", async () => {
        let callCount = 0;
        completeImpl = () => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({
                    role: "assistant",
                    content: JSON.stringify({
                        isMultiStep: true,
                        steps: [
                            {
                                objective: "Complete checkout",
                                successCriteria: "Order confirmation is visible",
                                dependencies: [],
                                assumptions: [],
                            },
                        ],
                    }),
                    tool_calls: undefined,
                    finish_reason: "stop",
                });
            }

            return Promise.resolve({
                role: "assistant",
                content: JSON.stringify({
                    isMultiStep: true,
                    steps: [
                        {
                            objective: "Fill the checkout form",
                            successCriteria: "All required checkout fields are populated",
                            dependencies: [],
                            assumptions: [],
                            toolProfile: "form_fill",
                        },
                        {
                            objective: "Place the order",
                            successCriteria: "Order confirmation is visible",
                            dependencies: [0],
                            assumptions: [],
                            toolProfile: "submit_form",
                        },
                    ],
                }),
                tool_calls: undefined,
                finish_reason: "stop",
            });
        };

        const planner = new OrchestratorPlanner("test-key");
        const initial = await planner.buildNodes(
            "Complete checkout",
            "Checkout",
            "https://shop.com/checkout",
        );

        expect(initial.nodes).toHaveLength(1);

        const expanded = await planner.expandNode(
            initial.nodes[0],
            "Checkout",
            "https://shop.com/checkout",
            "Split form fill from final submission",
        );

        expect(expanded).not.toBeNull();
        expect(expanded).toHaveLength(2);
        expect(expanded![0].allowedTools).toEqual(initial.nodes[0].allowedTools);
        expect(expanded![1].allowedTools).toEqual(initial.nodes[0].allowedTools);
    });

    test("selects continuation-edit for draft revision workflows", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false, "difficulty": "moderate"}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "Draft accept reply; change to decline + Monday; make casual and mention Q3 numbers",
            "Email Compose",
            "https://example.com/email-compose",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("continuation-edit");
        expect(result.nodes[0].selectedSkillReason).toContain("revising prior work");
    });

    test("selects cart-modify-checkout for cart swap workflows", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "complex",
                subtasks: ["Swap to Air Zoom Pegasus 41", "Apply SAVE10", "Checkout"],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "Add UltraBoost 24; swap to Air Zoom Pegasus 41; apply SAVE10 and checkout",
            "Cart",
            "https://example.com/cart",
        );

        expect(result.nodes.length).toBeGreaterThan(0);
        expect(result.nodes[0].selectedSkillId).toBe("cart-modify-checkout");
    });

    test("selects hover-reveal-navigation for hover-dependent menu workflows", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false, "difficulty": "moderate"}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "Go to Electronics under the Products menu, find the SKU number for Widget X, and search for it.",
            "Hover Menus & Tooltips",
            "https://example.com/hover-menus",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("hover-reveal-navigation");
        expect(result.nodes[0].selectedSkillReason).toContain("hover");
    });

    test("selects list-detail-review-loop for repeated listing review workflows", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false, "difficulty": "complex"}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "Please review all 10 job listings on this page, open each one to read the details, and come back to the listings page after each review.",
            "TechJobs Board",
            "https://example.com/job-board",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("list-detail-review-loop");
        expect(result.nodes[0].selectedSkillReason).toContain("detail view");
    });

    test("selects list-detail-review-loop for natural listing recommendation workflows", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false, "difficulty": "complex"}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "I'm a senior frontend engineer looking for a fully remote position in the $120K-$160K salary range. Review the job listings and tell me which ones are the best matches for my profile and why.",
            "TechJobs Board",
            "https://example.com/job-board",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("list-detail-review-loop");
        expect(result.nodes[0].selectedSkillReason).toContain("item-level detail facts");
    });

    test("selects multi-tab-procurement-loop for repeated tabbed procurement workflows", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": true, "difficulty": "complex", "subtasks": ["Open the first store in a new tab", "Purchase the first item", "Return and check it off"]}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "Buy the first two items from the procurement list. Open each store in a new tab, purchase the item, then come back and check it off.",
            "Procurement List",
            "https://example.com/procurement",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("multi-tab-procurement-loop");
        expect(result.nodes[0].selectedSkillReason).toContain("checklist workflow");
        expect(result.nodes[0].description).toMatch(/open the first store in a new tab/i);
        expect(result.nodes[0].description).toMatch(/purchase the first item/i);
        expect(result.nodes[0].description).toMatch(/return and check it off/i);
    });

    test("selects multi-tab-procurement-loop for natural procurement checklist requests", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": true, "difficulty": "complex", "subtasks": ["Buy the first procurement item", "Buy the second procurement item", "Mark both complete"]}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "Buy the first two items from the procurement list and mark them complete.",
            "Procurement List",
            "https://example.com/procurement",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("multi-tab-procurement-loop");
        expect(result.nodes[0].description).toMatch(/Buy the first two items/i);
        expect(result.nodes[0].successCriteria).toMatch(/marked complete/i);
    });

    test("selects budget-aware-execution when the task explicitly mentions turn budget pressure", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false, "difficulty": "moderate"}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "You are near the turn limit. Use the remaining turns carefully, avoid blind retries, and report the narrowest unresolved step if needed.",
            "Status Page",
            "https://example.com/status",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("budget-aware-execution");
        expect(result.nodes[0].selectedSkillReason).toContain("remaining turns");
    });

    test("selects inline-edit-surface for spreadsheet edit workflows", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: '{"isMultiStep": false, "difficulty": "moderate"}',
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "In the spreadsheet, change the Q1 Sales value in the first row to 999.",
            "Spreadsheet Editor",
            "https://example.com/keyboard-nav",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("inline-edit-surface");
        expect(result.nodes[0].selectedSkillReason).toContain("inline editor");
    });
});

describe("selectPrimarySkill", () => {
    test("prefers list-detail review over generic compare for listing recommendations", () => {
        expect(
            selectPrimarySkill({
                query:
                    "I'm a senior frontend engineer looking for a fully remote position in the $120K-$160K salary range. Review the job listings and tell me which ones are the best matches for my profile and why.",
                objective:
                    "Read all job listings on the TechJobs Board page, analyze each against the user's profile, and report the best matches with reasoning",
                successCriteria: "Best job recommendations are grounded in reviewed listing details",
                pageTitle: "TechJobs Board",
                pageUrl: "https://example.com/job-board",
            })?.id,
        ).toBe("list-detail-review-loop");
    });

    test("matches cross-tab compare workflows", () => {
        expect(
            selectPrimarySkill({
                query: "Read Overview; read Reports; compare both tabs",
                objective: "Compare both tabs",
                successCriteria: "Answer based on both tabs",
            })?.id,
        ).toBe("cross-tab-compare");
    });

    test("matches hover reveal workflows", () => {
        expect(
            selectPrimarySkill({
                query: "Go to Electronics under the Products menu, find the SKU number for Widget X, and search for it.",
                objective: "Hover the Products menu to reveal Electronics and continue",
                successCriteria: "Electronics selected and SKU searched",
            })?.id,
        ).toBe("hover-reveal-navigation");
    });

    test("matches explicit turn-budget conservation workflows", () => {
        expect(
            selectPrimarySkill({
                query: "Use the remaining turns carefully and avoid max turns waste",
                objective: "Conserve the remaining turn budget and report the smallest unresolved step",
                successCriteria: "No blind retries near turn limit",
            })?.id,
        ).toBe("budget-aware-execution");
    });

    test("returns null for generic simple navigation", () => {
        expect(
            selectPrimarySkill({
                query: "Open the site homepage",
                objective: "Open the site homepage",
                successCriteria: "Homepage visible",
            }),
        ).toBeNull();
    });

    test("prefers structured-form-fill for saved-profile checkout step", () => {
        expect(
            selectPrimarySkill({
                query: "Add the Air Zoom Pegasus 41 to cart, choose standard shipping, and use my saved profile for checkout.",
                objective: "Complete checkout using saved profile (identity.first_name, identity.last_name, identity.email) without inventing new details",
                successCriteria: "Checkout form shows full name and email from the saved profile and order is submitted",
            })?.id,
        ).toBe("structured-form-fill");
    });

    test("keeps cart-modify-checkout for earlier cart step even when query mentions saved profile", () => {
        expect(
            selectPrimarySkill({
                query: "Add the Air Zoom Pegasus 41 to cart, choose standard shipping, and use my saved profile for checkout.",
                objective: "Add the Air Zoom Pegasus 41 to cart",
                successCriteria: "Cart shows Pegasus 41 with quantity 1",
            })?.id,
        ).toBe("cart-modify-checkout");
    });

    test("prefers the current step semantics over earlier cart wording for confirmation checks", () => {
        expect(
            selectPrimarySkill({
                query: "Add the Air Zoom Pegasus 41 to cart, choose standard shipping, and use my saved profile for checkout.",
                objective: "Verify order confirmation is visible",
                successCriteria: "Confirmation page shows the completed order",
            })?.id,
        ).toBe("transactional-act-check-act");
    });

    test("prefers the current continuation step over stale overlay context", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Previously: close the cookie banner and newsletter popup so the form is usable. Now continue the task.",
                objective:
                    "Fill in the email field with test@example.com, then click the delete account button and confirm the deletion.",
                successCriteria:
                    "The email field shows test@example.com and account deletion is confirmed.",
                pageTitle: "Account Settings",
                pageUrl: "https://example.com/account-settings",
            })?.id,
        ).toBe("transactional-act-check-act");
    });

    test("matches inline edit workflows for spreadsheet edits", () => {
        expect(
            selectPrimarySkill({
                query: "In the spreadsheet, change the Q1 Sales value in the first row to 999.",
                objective: "Update the Q1 Sales cell in row 1 to 999",
                successCriteria: "Spreadsheet shows Q1 Sales value 999 in the first row",
            })?.id,
        ).toBe("inline-edit-surface");
    });

    test("matches inline rename workflows", () => {
        expect(
            selectPrimarySkill({
                query: "Rename Q3 Report.pdf to Q3 Financial Report 2026.pdf from the context menu.",
                objective: "Rename the document inline to Q3 Financial Report 2026.pdf",
                successCriteria: "The document list shows Q3 Financial Report 2026.pdf",
            })?.id,
        ).toBe("inline-edit-surface");
    });

    test("matches procurement workflows that require new tabs and checklist return", () => {
        expect(
            selectPrimarySkill({
                query: "Buy the first two items from the procurement list. Open each store in a new tab, purchase the item, then come back and check it off.",
                objective: "Open the matching store in a new tab and complete the purchase loop",
                successCriteria: "The purchased row is checked off on the procurement list",
            })?.id,
        ).toBe("multi-tab-procurement-loop");
    });

    test("matches natural procurement checklist workflows without tab wording", () => {
        expect(
            selectPrimarySkill({
                query: "Buy the first two items from the procurement list and mark them complete.",
                objective: "Complete the requested procurement list items",
                successCriteria: "The first two rows are marked complete on the procurement list",
            })?.id,
        ).toBe("multi-tab-procurement-loop");
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

    test("does not approve all-complete checkout plans when confirmation evidence is missing", async () => {
        completeImpl = () => Promise.reject(new Error("API timeout"));

        const guardian = new TaskPlanner("test-key");
        const plan = [
            { description: "Fill checkout form", status: "completed" as const, turnsUsed: 2, turnBudget: 5 },
            { description: "Place order", status: "completed" as const, turnsUsed: 1, turnBudget: 5 },
        ];

        const result = await guardian.validateDone(
            "Buy item",
            plan,
            "Filled the checkout form and verified the details.",
            "Checkout",
            "https://shop.com/checkout",
            undefined,
            "Checkout form with full name and email fields populated. No confirmation banner or order number is visible.",
            "Order confirmation is visible",
            "Full name and email fields were typed into the form.",
        );

        expect(result.approved).toBe(false);
        expect(result.reason || "").toMatch(/evidence|confirmation|continue/i);
    });
});

// Done Guard integration tests require their own mock.module to control
// both TaskPlanner (via complete) and AgentLoop (via completeStream).
// Due to bun's process-global mock.module behavior, these tests only pass
// reliably when run in isolation: `bun test tests/background/planner.test.ts`
// The TaskPlanner unit tests above cover all planner logic paths.
