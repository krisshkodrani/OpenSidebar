import { describe, test, expect, vi, beforeEach } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";

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
        private model = "accounts/fireworks/routers/kimi-k2p5-turbo";
        _isPlannerTier = false;
        complete = mockComplete;
        completeStream = mockCompleteStream;
        switchToPlanner = vi.fn(() => { this.model = "accounts/fireworks/routers/kimi-k2p5-turbo"; this._isPlannerTier = true; });
        switchToExecutor = vi.fn(() => { this.model = "accounts/fireworks/routers/kimi-k2p5-turbo"; this._isPlannerTier = false; });
        isPlannerTier = () => this._isPlannerTier;
        getCurrentModel = () => this.model;
        getCurrentProvider = () => "fireworks";
    },
    MODEL_EXECUTOR: "accounts/fireworks/routers/kimi-k2p5-turbo",
    MODEL_PLANNER: "accounts/fireworks/routers/kimi-k2p5-turbo",
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
import {
    getLoadedSkillContract,
    getSkillToolPolicy,
    getSkillToolSuppressionPolicy,
    resolveSkillToolProfile,
    selectPrimarySkill,
} from "../../src/background/orchestrator/skills";

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

    test("compacts over-decomposed field-value form plans instead of truncating submit", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "moderate",
                steps: [
                    {
                        objective: "Create a new incident record",
                        successCriteria: "The new incident form is visible",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Fill Short description field with EMAIL Server Down Again",
                        successCriteria: "Short description is EMAIL Server Down Again",
                        dependencies: [0],
                        assumptions: [],
                    },
                    {
                        objective: "Fill Caller field with Joe Employee",
                        successCriteria: "Caller is Joe Employee",
                        dependencies: [1],
                        assumptions: [],
                    },
                    {
                        objective: "Set Knowledge field to false",
                        successCriteria: "Knowledge is false",
                        dependencies: [2],
                        assumptions: [],
                    },
                    {
                        objective: "Leave Service field empty",
                        successCriteria: "Service is empty",
                        dependencies: [3],
                        assumptions: [],
                    },
                    {
                        objective: "Fill Resolution notes field",
                        successCriteria: "Resolution notes are filled",
                        dependencies: [4],
                        assumptions: [],
                    },
                    {
                        objective: "Fill Description field",
                        successCriteria: "Description is filled",
                        dependencies: [5],
                        assumptions: [],
                    },
                    {
                        objective: "Leave Change Request field empty",
                        successCriteria: "Change Request is empty",
                        dependencies: [6],
                        assumptions: [],
                    },
                    {
                        objective: "Set Channel field to Phone",
                        successCriteria: "Channel is Phone",
                        dependencies: [7],
                        assumptions: [],
                    },
                    {
                        objective: "Submit the incident form",
                        successCriteria: "Incident is created",
                        dependencies: [8],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new TaskPlanner("test-key");
        const result = await planner.decompose(
            'Create a new incident with a value of "EMAIL Server Down Again" for field "Short description", a value of "Joe Employee" for field "Caller", a value of "false" for field "Knowledge", a value of "" for field "Service", a value of "Closed before close notes were made mandatory" for field "Resolution notes", a value of "Multiple employees have reported that they are unable to send/receive email." for field "Description", a value of "" for field "Change Request", and a value of "Phone" for field "Channel".',
            "Create incident",
            "https://example.service-now.com/incident.do",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toHaveLength(2);
        expect(result!.steps![0].toolProfile).toBe("form_fill");
        expect(result!.steps![0].objective).toContain('Channel="Phone"');
        expect(result!.steps![1].toolProfile).toBe("submit_form");
        expect(result!.steps![1].dependencies).toEqual([0]);
    });

    test("prefers compact field-value form plan even when micro-steps are under the cap", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "moderate",
                steps: [
                    {
                        objective: "Open the new incident form",
                        successCriteria: "The incident form is open",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Fill Short description with EMAIL Server Down Again",
                        successCriteria: "Short description is EMAIL Server Down Again",
                        dependencies: [0],
                        assumptions: [],
                    },
                    {
                        objective: "Fill Caller with Joe Employee",
                        successCriteria: "Caller is Joe Employee",
                        dependencies: [1],
                        assumptions: [],
                    },
                    {
                        objective: "Fill Description with Multiple employees have reported that they are unable to send/receive email.",
                        successCriteria: "Description is filled",
                        dependencies: [2],
                        assumptions: [],
                    },
                    {
                        objective: "Set Channel to Phone",
                        successCriteria: "Channel is Phone",
                        dependencies: [3],
                        assumptions: [],
                    },
                    {
                        objective: "Submit the incident form",
                        successCriteria: "Incident is created",
                        dependencies: [4],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new TaskPlanner("test-key");
        const result = await planner.decompose(
            'Create a new incident with a value of "EMAIL Server Down Again" for field "Short description", a value of "Joe Employee" for field "Caller", a value of "Multiple employees have reported that they are unable to send/receive email." for field "Description", and a value of "Phone" for field "Channel".',
            "Create incident",
            "https://example.service-now.com/incident.do",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toHaveLength(2);
        expect(result!.steps![0].objective).toContain('Caller="Joe Employee"');
        expect(result!.steps![0].objective).toContain('Channel="Phone"');
        expect(result!.steps![1].objective).toContain("Submit");
    });

    test("prefers synthesized field-value form contract over same-length model form plan", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "moderate",
                steps: [
                    {
                        objective: "Fill the incident form with all required field values",
                        successCriteria: "The incident form is ready for submission",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Submit the incident form by clicking the Submit button",
                        successCriteria: "Incident is created",
                        dependencies: [0],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new TaskPlanner("test-key");
        const result = await planner.decompose(
            'Create a new incident with a value of "EMAIL Server Down Again" for field "Short description", a value of "Joe Employee" for field "Caller", a value of "false" for field "Knowledge", a value of "" for field "Service", a value of "Closed before close notes were made mandatory" for field "Resolution notes", a value of "Multiple employees have reported that they are unable to send/receive email." for field "Description", a value of "" for field "Change Request", and a value of "Phone" for field "Channel".',
            "Create incident",
            "https://example.service-now.com/incident.do",
        );

        expect(result).not.toBeNull();
        expect(result!.steps).toHaveLength(2);
        expect(result!.steps![0].objective).toContain(
            "Do not submit the form yet",
        );
        expect(result!.steps![0].objective).toContain('Caller="Joe Employee"');
        expect(result!.steps![0].toolProfile).toBe("form_fill");
        expect(result!.steps![1].toolProfile).toBe("submit_form");
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
        expect(
            inferToolProfileForStep(
                "Reply in the project-updates channel with the release timing and blocker",
                "The message is posted in the channel",
            ),
        ).toBe("submit_form");
        expect(
            inferToolProfileForStep(
                "Read the customer message thread and summarize the blocker",
                "The blocker is identified",
            ),
        ).toBe("read_only");
        expect(
            inferToolProfileForStep(
                "Read the project-updates channel to identify who should draft the changelog",
                "The changelog drafter is identified",
            ),
        ).toBe("read_only");
        expect(
            inferToolProfileForStep(
                "Update the support ticket status to escalated and add an internal note",
                "The ticket status and internal note are visible after save",
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
            expect(system).toContain(
                'do not assume that the word "thread" means there is a separate clickable thread view',
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

    test("expandNode defaults dependency-free replanned child steps to sequential order", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                steps: [
                    {
                        objective: "Scan page 2 of the salary table",
                        successCriteria: "Page 2 salaries are recorded",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Scan page 3 of the salary table",
                        successCriteria: "Page 3 salaries are recorded",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Scan page 4 of the salary table",
                        successCriteria: "Page 4 salaries are recorded",
                        dependencies: [],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const expanded = await planner.expandNode(
            {
                id: "node-salary-scan",
                role: "executor",
                description: "Find the highest salary across the paginated table",
                successCriteria: "Highest salary is identified from all pages",
                allowedTools: Object.values(ToolName),
                dependencies: ["node-open-table"],
                assumptions: [],
                handoffArtifacts: [],
                reflexionLog: [],
                handoffDepth: 0,
                status: "running",
                retries: 0,
            } as any,
            "Salary Table",
            "https://example.com/salaries",
            "Need to scan remaining pages",
        );

        expect(expanded).not.toBeNull();
        expect(expanded).toHaveLength(3);
        expect(expanded![0].dependencies).toEqual(["node-open-table"]);
        expect(expanded![1].dependencies).toEqual([expanded![0].id]);
        expect(expanded![2].dependencies).toEqual([expanded![1].id]);
    });

    test("collapses paginated aggregate page plans into one skill-owned scan node", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "complex",
                steps: [
                    {
                        objective: "Extract salaries from page 1 of the employee directory table",
                        successCriteria: "Page 1 salary values are recorded",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Extract salaries from page 2 of the employee directory table",
                        successCriteria: "Page 2 salary values are recorded",
                        dependencies: [0],
                        assumptions: [],
                    },
                    {
                        objective: "Compare all extracted salaries and report the highest salary",
                        successCriteria: "The employee with the highest salary and the salary value are reported",
                        dependencies: [1],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            "Review the employee directory and tell me which employee has the highest salary and what that salary is.",
            "Employee Directory",
            "https://example.com/data-table",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.nodes[0].selectedSkillId).toBe("paginated-table-scan");
        expect(result.nodes[0].description).toContain("Scan the full paginated data surface");
        expect(result.nodes[0].successCriteria).toContain("All pages or visible row ranges");
    });

    test("collapses WorkArena-style list filter plans into one skill-owned workflow node", async () => {
        completeImpl = () => Promise.resolve({
            role: "assistant",
            content: JSON.stringify({
                isMultiStep: true,
                difficulty: "complex",
                steps: [
                    {
                        objective: "Open the filter builder on the incident list",
                        successCriteria: "Filter builder is visible",
                        dependencies: [],
                        assumptions: [],
                    },
                    {
                        objective: "Add condition Caller is Margaret Grey",
                        successCriteria: "Caller condition is set",
                        dependencies: [0],
                        assumptions: [],
                    },
                    {
                        objective: "Run the filter and verify the incident list updated",
                        successCriteria: "Applied filter state is visible",
                        dependencies: [1],
                        assumptions: [],
                    },
                ],
            }),
            tool_calls: undefined,
            finish_reason: "stop",
        });

        const planner = new OrchestratorPlanner("test-key");
        const result = await planner.buildNodes(
            'Create a filter for the list to extract all entries where "Caller" is "Margaret Grey".',
            "Incidents | ServiceNow",
            "https://example.service-now.com/incident_list.do",
        );

        expect(result.nodes).toHaveLength(1);
        expect(result.isSingleNode).toBe(true);
        expect(result.nodes[0].selectedSkillId).toBe("list-filter-workflow");
        expect(result.nodes[0].description).toContain("Complete the workflow for the original request");
        expect(result.nodes[0].successCriteria).toContain("not merely an intermediate");
        expect(result.nodes[0].allowedTools).toContain(ToolName.INSPECT_FILTER_STATE);
        expect(result.nodes[0].allowedTools).toContain(ToolName.APPLY_LIST_FILTER);
        expect(result.nodes[0].allowedTools).toContain(ToolName.INSPECT_TABLE);
    });

    test("fallback executor nodes expose workflow inspector tools", () => {
        const nodes = buildFallbackNodes(
            "Tell me the value shown in the dashboard chart.",
            "Dashboard",
            "https://example.com/dashboard",
        );

        expect(nodes[0].allowedTools).toContain(ToolName.INSPECT_CHART);
        expect(nodes[0].allowedTools).toContain(ToolName.INSPECT_TABLE);
        expect(nodes[0].allowedTools).toContain(ToolName.INSPECT_FILTER_STATE);
        expect(nodes[0].allowedTools).toContain(ToolName.APPLY_LIST_FILTER);
        expect(nodes[0].allowedTools).toContain(ToolName.INSPECT_CATALOG_ITEM);
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

    test("matches chart value extraction workflows", () => {
        expect(
            selectPrimarySkill({
                query: "Open the dashboard chart and tell me the value for Critical incidents.",
                objective: "Read the incident chart and extract the Critical value",
                successCriteria: "Final answer includes the concrete chart value",
                pageTitle: "Service Dashboard",
            })?.id,
        ).toBe("chart-value-extraction");
    });

    test("matches search answer extraction workflows", () => {
        expect(
            selectPrimarySkill({
                query: "Search the knowledge base and answer what users should do before resetting MFA.",
                objective: "Use the knowledge search result to answer the user's question",
                successCriteria: "Final answer contains the requested fact from the article",
                pageTitle: "Knowledge Base",
            })?.id,
        ).toBe("search-answer-extraction");
    });

    test("matches list filter workflows", () => {
        expect(
            selectPrimarySkill({
                query: "Filter the incident list to show only priority 1 records.",
                objective: "Apply the requested filter to the incident table",
                successCriteria: "Filtered list state is visible and verified",
                pageTitle: "Incidents",
            })?.id,
        ).toBe("list-filter-workflow");
    });

    test("matches list sort workflows", () => {
        expect(
            selectPrimarySkill({
                query: "Sort the incident list by Updated in descending order.",
                objective: "Sort the incident table by the Updated column descending",
                successCriteria: "Sort state is visible on the list",
                pageTitle: "Incidents",
            })?.id,
        ).toBe("list-sort-workflow");
    });

    test("matches catalog order workflows before generic form fill", () => {
        expect(
            selectPrimarySkill({
                query: "Order a standard laptop from the service catalog with quantity 1.",
                objective: "Configure the standard laptop catalog item and submit the request",
                successCriteria: "Catalog request confirmation is visible",
                pageTitle: "Service Catalog",
            })?.id,
        ).toBe("catalog-order-workflow");
    });

    test("exposes inspector tools through new workflow skill policies", () => {
        expect(getSkillToolPolicy("chart-value-extraction")?.preferredTools).toContain(
            ToolName.INSPECT_CHART,
        );
        expect(
            resolveSkillToolProfile(
                "chart-value-extraction",
                "Read the incident chart and report the value for the empty category",
                "Final answer includes the requested chart percentage",
            ),
        ).toBe("read_only");
        const chartSkill = getLoadedSkillContract("chart-value-extraction");
        expect(chartSkill?.procedureMarkdown).toContain("exactly one numeric value");
        expect(chartSkill?.executionContract?.completionChecks).toContain(
            "For single-value questions, the final answer contains only one numeric value.",
        );
        const listFilterPolicy = getSkillToolPolicy("list-filter-workflow");
        expect(listFilterPolicy?.preferredTools).toContain(ToolName.APPLY_LIST_FILTER);
        expect(listFilterPolicy?.discouragedTools).toContain(ToolName.CLICK_ELEMENT);
        expect(listFilterPolicy?.discouragedTools).toContain(ToolName.FIND_ELEMENT);
        expect(
            resolveSkillToolProfile(
                "list-filter-workflow",
                'Create a filter where "Caller" is "Margaret Grey"',
                "Applied query is visible",
            ),
        ).toBe("form_fill");
        expect(getSkillToolPolicy("list-sort-workflow")?.preferredTools).toContain(
            ToolName.APPLY_LIST_SORT,
        );
        expect(getSkillToolPolicy("list-sort-workflow")?.preferredTools).toContain(
            ToolName.INSPECT_TABLE,
        );
        expect(
            resolveSkillToolProfile(
                "list-sort-workflow",
                "Sort by Number descending and Duration descending",
                "Applied sort query is visible",
            ),
        ).toBe("form_fill");
        expect(getSkillToolPolicy("catalog-order-workflow")?.preferredTools).toContain(
            ToolName.INSPECT_CATALOG_ITEM,
        );
        expect(getSkillToolPolicy("catalog-order-workflow")?.preferredTools).toContain(
            ToolName.CONFIGURE_CATALOG_ITEM,
        );
        expect(
            resolveSkillToolProfile(
                "catalog-order-workflow",
                "Order a standard laptop from the service catalog",
                "Request confirmation is visible",
                "form_fill",
            ),
        ).toBe("full");
        expect(
            selectPrimarySkill({
                query:
                    'Navigate to the "Database Instances > HBase" module of the "Configuration" application.',
                objective:
                    "Navigate to the Database Instances > HBase module in the Configuration application",
                successCriteria: "HBase Instances page is visible",
                pageTitle: "Home | ServiceNow",
            })?.id,
        ).toBe("servicenow-module-navigation");
        expect(
            getSkillToolPolicy("servicenow-module-navigation")?.preferredTools,
        ).toContain(ToolName.OPEN_SERVICENOW_MODULE);
        expect(
            getSkillToolPolicy("servicenow-module-navigation")?.discouragedTools,
        ).toContain(ToolName.NAVIGATE);
        expect(
            resolveSkillToolProfile(
                "servicenow-module-navigation",
                "Navigate to the Database Instances > HBase module",
                "HBase Instances page is visible",
            ),
        ).toBe("navigate");
    });

    test("matches paginated aggregate table scans", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Review the employee directory and tell me which employee has the highest salary and what that salary is.",
                objective:
                    "Read the employee directory table and identify the employee with the highest salary",
                successCriteria:
                    "Final answer names the employee with the highest salary after covering all rows in the table",
                pageTitle: "Employee Directory",
                pageUrl: "https://example.com/data-table",
            })?.id,
        ).toBe("paginated-table-scan");
    });

    test("matches targeted paginated record lookups without using aggregate scans", () => {
        expect(
            selectPrimarySkill({
                query: "Search for Diana in the employee directory and tell me her salary.",
                objective:
                    "Find Diana in the employee directory table and report the salary from her row",
                successCriteria:
                    "Final answer reports Diana's salary after verifying the exact employee row",
                pageTitle: "Employee Directory",
                pageUrl: "https://example.com/data-table",
            })?.id,
        ).toBe("paginated-record-lookup");
    });

    test("matches targeted feed lookups as paginated record lookups", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Find Post #35 'The Secret Formula for Productivity' in the feed and tell me the secret code mentioned in it.",
                objective:
                    "Locate Post #35 in the feed and extract the secret code from that exact post",
                successCriteria:
                    "Final answer gives the code from Post #35, not from another post",
                pageTitle: "Activity Feed",
            })?.id,
        ).toBe("paginated-record-lookup");
    });

    test("keeps paginated aggregate scans on read and forward-click tools", () => {
        const policy = getSkillToolPolicy("paginated-table-scan");
        const suppression = getSkillToolSuppressionPolicy("paginated-table-scan");

        expect(policy?.preferredTools).toContain(ToolName.READ_PAGE);
        expect(policy?.preferredTools).toContain(ToolName.CLICK_ELEMENT);
        expect(policy?.discouragedTools).toContain(ToolName.READ_ELEMENT);
        expect(policy?.discouragedTools).toContain(ToolName.TYPE_TEXT);
        expect(policy?.discouragedTools).toContain(ToolName.PRESS_KEY);
        expect(policy?.discouragedTools).toContain(ToolName.SCROLL_PAGE);
        expect(suppression?.temporarilySuppressedTools).toContain(ToolName.READ_ELEMENT);
        expect(suppression?.temporarilySuppressedTools).toContain(ToolName.TYPE_TEXT);
        expect(suppression?.temporarilySuppressedTools).toContain(ToolName.PRESS_KEY);
        expect(suppression?.temporarilySuppressedTools).toContain(ToolName.SCROLL_PAGE);
        expect(suppression?.temporarilySuppressedTools).toContain(ToolName.CREATE_TAB);
    });

    test("keeps paginated record lookup distinct from aggregate scan policy", () => {
        const policy = getSkillToolPolicy("paginated-record-lookup");
        const suppression = getSkillToolSuppressionPolicy("paginated-record-lookup");

        expect(policy?.preferredTools).toContain(ToolName.FIND_ELEMENT);
        expect(policy?.preferredTools).toContain(ToolName.TYPE_TEXT);
        expect(policy?.preferredTools).toContain(ToolName.CLICK_ELEMENT);
        expect(policy?.preferredTools).toContain(ToolName.SCROLL_PAGE);
        expect(policy?.discouragedTools).toContain(ToolName.READ_ELEMENT);
        expect(policy?.discouragedTools).toContain(ToolName.PRESS_KEY);
        expect(suppression?.temporarilySuppressedTools).toContain(ToolName.READ_ELEMENT);
        expect(suppression?.temporarilySuppressedTools).toContain(ToolName.PRESS_KEY);
        expect(suppression?.temporarilySuppressedTools).not.toContain(ToolName.SCROLL_PAGE);
        expect(suppression?.temporarilySuppressedTools).toContain(ToolName.CREATE_TAB);
    });

    test("keeps recommendation list reviews out of paginated aggregate scans", () => {
        expect(
            selectPrimarySkill({
                query:
                    "I'm a senior frontend engineer looking for a fully remote position in the $120K-$160K salary range. Review the job listings and tell me which ones are the best matches for my profile and why.",
                objective:
                    "Read all job listings on the TechJobs Board page, analyze each against the user's profile, and report the best matches with reasoning",
                successCriteria:
                    "Best job recommendations are grounded in reviewed listing details",
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

    test("does not use cross-tab compare for single-page report navigation", () => {
        expect(
            selectPrimarySkill({
                query: "Now switch to the Reports tab and tell me what reports are available.",
                objective: "Open the Reports tab and read the available reports",
                successCriteria: "Available reports are listed from the Reports tab",
                pageTitle: "Admin Dashboard",
            })?.id,
        ).not.toBe("cross-tab-compare");
    });

    test("keeps product configurators on structured form fill", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Configure the product: pick the Large (32 oz) size, enable custom engraving, and tell me the total price.",
                objective:
                    "Choose the requested product options and verify the total price",
                successCriteria:
                    "Selected options and total price are visible before answering",
                pageTitle: "Product Configurator",
            })?.id,
        ).toBe("structured-form-fill");
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

    test("keeps paginated salary aggregates out of budget mode even with recovery context", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Review the employee directory and tell me which employee has the highest salary and what that salary is. Prior attempt reached the turn budget.",
                objective:
                    "Analyze the employee salary data to identify the employee with the highest salary value",
                successCriteria:
                    "Highest salary employee identified with name and exact salary amount extracted from the table",
                pageTitle: "Employee Directory",
                pageUrl: "http://127.0.0.1/data-table",
            })?.id,
        ).toBe("paginated-table-scan");
    });

    test("matches careful email reply workflows before generic continuation editing", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Reply to David's email confirming Friday at 10 AM for the Q3 strategy review, and briefly acknowledge the main agenda items from his email.",
                objective:
                    "Read David's email, draft a contextual reply, verify the recipient and content, then send it",
                successCriteria:
                    "Email reply is sent to David with the requested time and agenda context, without unsupported claims",
                pageTitle: "Inbox - Q3 Strategy Review",
            })?.id,
        ).toBe("email-reply-careful");
    });

    test("does not treat contact form email fields as email reply workflows", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Fill out the contact form with email test@example.com and message 'Hello, this is a test message for the contact form' and send it.",
                objective: "Fill the contact form fields and submit the form",
                successCriteria: "Contact form submission is accepted",
            })?.id,
        ).toBe("structured-form-fill");
    });

    test("matches careful thread message workflows with language and tone context", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Reply to Lisa in the Cloud-Migration Team thread. Confirm that the Friday update should include a progress summary, a revised cost plan, and Markus owning the technical part.",
                objective:
                    "Read the message thread and post a reply that preserves the thread's language, tone, owner, deadline, and deliverables",
                successCriteria:
                    "Reply appears in the Cloud-Migration Team thread and reflects the requested owners and deliverables",
                pageTitle: "Messaging Thread",
            })?.id,
        ).toBe("thread-message-careful");
    });

    test("matches CRM ticket update workflows before generic status checks", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Review TICKET-4271. If it needs escalation, update the ticket accordingly and leave an internal note with the customer impact, account context, and next step.",
                objective:
                    "Read the support ticket, update the appropriate ticket fields, and add a grounded internal note",
                successCriteria:
                    "Ticket escalation state and internal note are visible after save",
                pageTitle: "Support Ticket TICKET-4271",
            })?.id,
        ).toBe("crm-ticket-update");
    });

    test("keeps escalation ticket workflows out of continuation-edit", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Review TICKET-4271. If it needs escalation, set the ticket status to In Progress, raise the priority to Urgent, and leave an internal note with the customer impact, account context, and next step.",
                objective:
                    "Review the ticket, update status and priority, and add an internal note with customer impact and next step",
                successCriteria:
                    "Ticket status is In Progress, priority is Urgent, and internal note is visible",
                pageTitle: "TICKET-4271 — CSV Export Timeout",
            })?.id,
        ).toBe("crm-ticket-update");
    });

    test("keeps ticket dropdown updates on crm-ticket-update instead of hover reveal", () => {
        expect(
            selectPrimarySkill({
                query:
                    "Set ticket TICKET-4271 to In Progress and add an internal note summarizing the issue and next steps.",
                objective:
                    "Update the support ticket status dropdown and add a grounded internal note",
                successCriteria:
                    "Ticket status is In Progress and the internal note is visible after save",
                pageTitle: "Support Ticket TICKET-4271",
            })?.id,
        ).toBe("crm-ticket-update");
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
