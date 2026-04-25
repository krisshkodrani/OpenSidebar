import { describe, test, expect, vi } from "vitest";
import "../setup";
import { AgentLoop } from "../../src/background/agent/loop";
import { SubtaskSummary } from "../../src/types";

// Mock LLM Client
vi.mock("../../src/background/llm", () => ({
    LLMClient: class {
        private model = "accounts/fireworks/routers/kimi-k2p5-turbo";
        _isPlannerTier = false;
        complete = vi.fn(() => Promise.resolve({
            role: "assistant",
            content: "ok",
            tool_calls: undefined,
            finish_reason: "stop",
        }));
        completeStream = vi.fn((_req: any, onDelta: (d: string) => void) => {
            onDelta("ok");
            return Promise.resolve({
                role: "assistant",
                content: "ok",
                tool_calls: undefined,
                finish_reason: "stop",
            });
        });
        switchToPlanner = vi.fn(() => { this.model = "accounts/fireworks/routers/kimi-k2p5-turbo"; this._isPlannerTier = true; });
        switchToExecutor = vi.fn(() => { this.model = "accounts/fireworks/routers/kimi-k2p5-turbo"; this._isPlannerTier = false; });
        isPlannerTier = () => this._isPlannerTier;
        getCurrentModel = () => this.model;
        getCurrentProvider = () => "fireworks";
        getActiveProviderInfo = () => ({ providerId: "fireworks", model: this.model });
        setFailoverCallback = vi.fn(() => {});
    },
    MODEL_EXECUTOR: "accounts/fireworks/routers/kimi-k2p5-turbo",
    MODEL_PLANNER: "accounts/fireworks/routers/kimi-k2p5-turbo",
    stripThinkTags: (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
    extractThinkContent: () => null,
}));

function createAgent(): AgentLoop {
    return new AgentLoop("test-key", {
        onStatusUpdate: vi.fn(),
        onMessage: vi.fn(),
        onStep: vi.fn(),
    });
}

/** Access private checkNavigateGuard via type escape */
function checkGuard(agent: AgentLoop, url: string): string | null {
    return (agent as any).checkNavigateGuard(url);
}

/** Set private planSubtasks directly */
function setPlanSubtasks(agent: AgentLoop, subtasks: SubtaskSummary[]): void {
    (agent as any).planSubtasks = subtasks;
}

describe("Navigate Guard", () => {
    test("returns null when no plan exists (empty planSubtasks)", () => {
        const agent = createAgent();
        // planSubtasks is [] by default
        expect(checkGuard(agent, "https://example.com/step1")).toBeNull();
    });

    test("returns null when plan has no completed steps with URLs", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            { description: "Do step 1", status: "completed", turnsUsed: 1, turnBudget: 0 },
            { description: "Do step 2", status: "running", turnsUsed: 0, turnBudget: 0 },
        ]);
        // No completedAtUrl set → guard returns null
        expect(checkGuard(agent, "https://example.com/step1")).toBeNull();
    });

    test("blocks navigation to a completed step URL (exact path match)", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            {
                description: "Complete step 1",
                status: "completed",
                turnsUsed: 2,
                turnBudget: 0,
                completedAtUrl: "https://challenge.example.com/step1?version=1",
            },
            { description: "Do step 2", status: "running", turnsUsed: 0, turnBudget: 0 },
        ]);

        const result = checkGuard(agent, "https://challenge.example.com/step1?version=2");
        expect(result).not.toBeNull();
        expect(result).toContain("BLOCKED");
        expect(result).toContain("step 1");
        expect(result).toContain("Complete step 1");
    });

    test("origin+pathname matching ignores query params and hash", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            {
                description: "Fill out form",
                status: "completed",
                turnsUsed: 3,
                turnBudget: 0,
                completedAtUrl: "https://app.test/form?id=abc#section1",
            },
            { description: "Review", status: "running", turnsUsed: 0, turnBudget: 0 },
        ]);

        // Same origin+pathname, different query → blocked
        expect(checkGuard(agent, "https://app.test/form?id=xyz")).not.toBeNull();
        // Same origin+pathname, no query → blocked
        expect(checkGuard(agent, "https://app.test/form")).not.toBeNull();
        // Same origin+pathname, different hash → blocked
        expect(checkGuard(agent, "https://app.test/form#other")).not.toBeNull();
    });

    test("allows navigation to a different path on the same origin", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            {
                description: "Step 1",
                status: "completed",
                turnsUsed: 1,
                turnBudget: 0,
                completedAtUrl: "https://example.com/step1",
            },
            { description: "Step 2", status: "running", turnsUsed: 0, turnBudget: 0 },
        ]);

        expect(checkGuard(agent, "https://example.com/step2")).toBeNull();
        expect(checkGuard(agent, "https://example.com/other/path")).toBeNull();
    });

    test("allows navigation to a different origin", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            {
                description: "Step 1",
                status: "completed",
                turnsUsed: 1,
                turnBudget: 0,
                completedAtUrl: "https://example.com/step1",
            },
            { description: "Step 2", status: "running", turnsUsed: 0, turnBudget: 0 },
        ]);

        expect(checkGuard(agent, "https://other-site.com/step1")).toBeNull();
    });

    test("handles unparseable target URL gracefully (returns null)", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            {
                description: "Step 1",
                status: "completed",
                turnsUsed: 1,
                turnBudget: 0,
                completedAtUrl: "https://example.com/step1",
            },
        ]);

        expect(checkGuard(agent, "not-a-valid-url")).toBeNull();
    });

    test("skips steps whose completedAtUrl is unparseable", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            {
                description: "Step 1",
                status: "completed",
                turnsUsed: 1,
                turnBudget: 0,
                completedAtUrl: "bad-url-no-protocol",
            },
            {
                description: "Step 2",
                status: "completed",
                turnsUsed: 1,
                turnBudget: 0,
                completedAtUrl: "https://example.com/step2",
            },
            { description: "Step 3", status: "running", turnsUsed: 0, turnBudget: 0 },
        ]);

        // Step 1's bad URL is skipped; step 2's URL still blocks
        expect(checkGuard(agent, "https://example.com/step2")).not.toBeNull();
        // And unrelated URL goes through
        expect(checkGuard(agent, "https://example.com/step3")).toBeNull();
    });

    test("only checks completed steps, not running/pending", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            {
                description: "Step 1",
                status: "completed",
                turnsUsed: 1,
                turnBudget: 0,
                completedAtUrl: "https://example.com/step1",
            },
            {
                description: "Step 2",
                status: "running",
                turnsUsed: 0,
                turnBudget: 0,
                completedAtUrl: "https://example.com/step2", // has URL but not completed
            },
            {
                description: "Step 3",
                status: "pending",
                turnsUsed: 0,
                turnBudget: 0,
                completedAtUrl: "https://example.com/step3", // has URL but not completed
            },
        ]);

        expect(checkGuard(agent, "https://example.com/step1")).not.toBeNull(); // completed → blocked
        expect(checkGuard(agent, "https://example.com/step2")).toBeNull();      // running → allowed
        expect(checkGuard(agent, "https://example.com/step3")).toBeNull();      // pending → allowed
    });

    test("block message includes correct step number and description", () => {
        const agent = createAgent();
        setPlanSubtasks(agent, [
            { description: "Login to site", status: "completed", turnsUsed: 1, turnBudget: 0 },
            {
                description: "Navigate to search",
                status: "completed",
                turnsUsed: 2,
                turnBudget: 0,
                completedAtUrl: "https://site.com/search",
            },
            { description: "Run query", status: "running", turnsUsed: 0, turnBudget: 0 },
        ]);

        const result = checkGuard(agent, "https://site.com/search?q=test");
        expect(result).not.toBeNull();
        expect(result).toContain("step 2");
        expect(result).toContain("Navigate to search");
        expect(result).toContain("revise your plan first");
    });
});
