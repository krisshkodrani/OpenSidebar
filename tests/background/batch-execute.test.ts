import { describe, test, expect, mock, beforeEach, beforeAll } from "bun:test";
import "../setup";
import { ToolName } from "../../src/types";

// Default completeStream implementation (text only, no tool calls)
const defaultCompleteStreamFn = (
  request: any,
  onTextDelta: (delta: string) => void,
) => {
  onTextDelta("Final answer");
  return Promise.resolve({
    role: "assistant",
    content: "Final answer",
    tool_calls: undefined,
    finish_reason: "stop",
  });
};

// Mock LLM Client — same pattern as agent.test.ts
const mockCompleteStream = mock(defaultCompleteStreamFn);

mock.module("../../src/background/llm", () => ({
  LLMClient: class {
    private model = "google/gemini-2.5-flash-lite";
    _isSmartTier = false;
    complete = mock(() =>
      Promise.resolve({
        role: "assistant",
        content: "Final answer",
        tool_calls: undefined,
        finish_reason: "stop",
      }),
    );
    completeStream = mockCompleteStream;
    switchToSmart = mock(() => {
      this.model = "minimax/minimax-m2.5"; this._isSmartTier = true;
    });
    switchToFast = mock(() => {
      this.model = "google/gemini-2.5-flash-lite"; this._isSmartTier = false;
    });
    isSmartTier = () => this._isSmartTier;
    getCurrentModel = () => this.model;
    getCurrentProvider = () => "openrouter";
    getActiveProviderInfo = () => ({
      providerId: "openrouter",
      model: this.model,
    });
    setFailoverCallback = mock(() => {});
  },
  MODEL_FAST: "google/gemini-2.5-flash-lite",
  MODEL_SMART: "minimax/minimax-m2.5",
  stripThinkTags: (text: string) =>
    text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
}));

import { AgentLoop } from "../../src/background/agent/loop";
import { toolRegistry } from "../../src/background/tools/registry";
import { registerTools } from "../../src/background/tools";

// Register all tools once
beforeAll(() => {
  toolRegistry.clear();
  registerTools();
});

describe("batch_execute", () => {
  const doneResponse = {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "tc_auto_done",
        type: "function",
        function: { name: "done", arguments: '{"summary":"Auto-done"}' },
      },
    ],
    finish_reason: "tool_calls",
  };

  function setupLLMSequence(responses: any[]) {
    let callIdx = 0;
    mockCompleteStream.mockImplementation((_req: any, _delta: any) => {
      const resp =
        callIdx < responses.length ? responses[callIdx] : doneResponse;
      callIdx++;
      return Promise.resolve(resp);
    });
  }

  function createAgent() {
    return new AgentLoop("test-key", undefined, undefined, {
      onStatusUpdate: mock(),
      onMessage: mock(),
      onStep: mock(),
    });
  }

  function makeBatchCall(
    id: string,
    steps: Array<{ tool: string; args: Record<string, unknown>; expect?: string }>,
    verify?: string,
  ) {
    const batchArgs: Record<string, unknown> = { steps };
    if (verify) batchArgs.verify = verify;
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: { name: "batch_execute", arguments: JSON.stringify(batchArgs) },
        },
      ],
      finish_reason: "tool_calls",
    };
  }

  // Save original for restoration
  const origSendMessage = chrome.tabs.sendMessage;

  beforeEach(() => {
    mockCompleteStream.mockImplementation(defaultCompleteStreamFn);
    mockCompleteStream.mockClear();
    (chrome.tabs as any).sendMessage = origSendMessage;
  });

  test("happy path: all steps succeed", async () => {
    // 3-step batch: click, type, click
    setupLLMSequence([
      makeBatchCall("tc_batch", [
        { tool: "click_element", args: { id: 1 } },
        { tool: "type_text", args: { id: 2, text: "hello" } },
        { tool: "click_element", args: { id: 3 } },
      ]),
    ]);

    const agent = createAgent();
    await agent.start("Fill a form", 123);

    // Find the tool result in the second completeStream call's messages
    const msgs = mockCompleteStream.mock.calls[1]?.[0]?.messages;
    const toolResult = msgs?.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_batch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("Batch OK: 3/3 steps completed");
    expect(toolResult.content).toContain("[0] click_element:");
    expect(toolResult.content).toContain("[1] type_text:");
    expect(toolResult.content).toContain("[2] click_element:");
  });

  test("bail on blocked tool (navigate)", async () => {
    setupLLMSequence([
      makeBatchCall("tc_batch", [
        { tool: "click_element", args: { id: 1 } },
        { tool: "navigate", args: { url: "https://example.com" } },
        { tool: "click_element", args: { id: 3 } },
      ]),
    ]);

    const agent = createAgent();
    await agent.start("Navigate away", 123);

    const msgs = mockCompleteStream.mock.calls[1]?.[0]?.messages;
    const toolResult = msgs?.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_batch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("BAILED");
    expect(toolResult.content).toContain("not allowed in batch");
    expect(toolResult.content).toContain('"navigate"');
    // First step should have completed before the bail
    expect(toolResult.content).toContain("[0] click_element:");
  });

  test("bail on error result", async () => {
    // Mock chrome.tabs.sendMessage to return error on second call
    let callCount = 0;
    (chrome.tabs as any).sendMessage = mock(async () => {
      callCount++;
      // Fail on the 2nd tool call (type_text, after click snapshot requests)
      // The second TOOL_EXECUTE message should be for type_text
      if (callCount === 2) {
        return { payload: { result: "Error: No element with tag 99", success: false } };
      }
      return { payload: { result: "ok", success: true } };
    });

    setupLLMSequence([
      makeBatchCall("tc_batch", [
        { tool: "click_element", args: { id: 1 } },
        { tool: "type_text", args: { id: 99, text: "hello" } },
        { tool: "click_element", args: { id: 3 } },
      ]),
    ]);

    const agent = createAgent();
    await agent.start("Fill a form", 123);

    const msgs = mockCompleteStream.mock.calls[1]?.[0]?.messages;
    const toolResult = msgs?.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_batch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("BAILED");
    expect(toolResult.content).toContain("Error");
    // Step 0 should be completed
    expect(toolResult.content).toContain("[0] click_element:");
    // Only 1 out of 3 steps completed (bailed on step 1)
    expect(toolResult.content).toContain("1/3");
  });

  test("bail on expect mismatch", async () => {
    setupLLMSequence([
      makeBatchCall("tc_batch", [
        { tool: "click_element", args: { id: 1 }, expect: "submitted" },
      ]),
    ]);

    const agent = createAgent();
    await agent.start("Click button", 123);

    const msgs = mockCompleteStream.mock.calls[1]?.[0]?.messages;
    const toolResult = msgs?.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_batch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("BAILED");
    expect(toolResult.content).toContain('expected "submitted" not found');
    expect(toolResult.content).toContain("0/1");
  });

  test("max steps cap at 10", async () => {
    // Create 15 steps — only first 10 should execute
    const steps = Array.from({ length: 15 }, (_, i) => ({
      tool: "click_element",
      args: { id: i + 1 },
    }));

    setupLLMSequence([makeBatchCall("tc_batch", steps)]);

    const agent = createAgent();
    await agent.start("Click many", 123);

    const msgs = mockCompleteStream.mock.calls[1]?.[0]?.messages;
    const toolResult = msgs?.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_batch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("10/10 steps completed");
    // Should not have step [10] (0-indexed, max is 9)
    expect(toolResult.content).toContain("[9] click_element:");
    expect(toolResult.content).not.toContain("[10]");
  });

  test("empty steps array", async () => {
    setupLLMSequence([makeBatchCall("tc_batch", [])]);

    const agent = createAgent();
    await agent.start("Empty batch", 123);

    const msgs = mockCompleteStream.mock.calls[1]?.[0]?.messages;
    const toolResult = msgs?.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_batch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("Batch OK: 0/0 steps completed");
  });

  test("blocked tools: execute_js, create_tab, batch_execute itself", async () => {
    // Each of these should bail immediately
    for (const blockedTool of ["execute_js", "create_tab", "batch_execute"]) {
      setupLLMSequence([
        makeBatchCall("tc_batch", [
          { tool: blockedTool, args: {} },
        ]),
      ]);

      const agent = createAgent();
      await agent.start(`Test ${blockedTool}`, 123);

      const msgs = mockCompleteStream.mock.calls[1]?.[0]?.messages;
      const toolResult = msgs?.find(
        (m: any) => m.role === "tool" && m.tool_call_id === "tc_batch",
      );
      expect(toolResult).toBeDefined();
      expect(toolResult.content).toContain("not allowed in batch");
      expect(toolResult.content).toContain(blockedTool);

      // Reset for next iteration
      mockCompleteStream.mockClear();
    }
  });

  test("verify string is included in result footer", async () => {
    setupLLMSequence([
      makeBatchCall(
        "tc_batch",
        [{ tool: "click_element", args: { id: 1 } }],
        "Form should be submitted",
      ),
    ]);

    const agent = createAgent();
    await agent.start("Submit form", 123);

    const msgs = mockCompleteStream.mock.calls[1]?.[0]?.messages;
    const toolResult = msgs?.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc_batch",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult.content).toContain("Verify: Form should be submitted");
  });

  test("step handler receives batch status updates", async () => {
    const onStep = mock();
    setupLLMSequence([
      makeBatchCall("tc_batch", [
        { tool: "click_element", args: { id: 1 } },
        { tool: "click_element", args: { id: 2 } },
      ]),
    ]);

    const agent = new AgentLoop("test-key", undefined, undefined, {
      onStatusUpdate: mock(),
      onMessage: mock(),
      onStep: onStep,
    });
    await agent.start("Click two", 123);

    // Find batch-related step calls
    const batchSteps = onStep.mock.calls.filter(
      (call: any) => call[0]?.toolName === ToolName.BATCH_EXECUTE,
    );

    // Should have at least 2 step calls: running + done/error
    expect(batchSteps.length).toBeGreaterThanOrEqual(2);

    // First batch step: running
    expect(batchSteps[0][0].status).toBe("running");
    expect(batchSteps[0][0].label).toContain("Batch: 2 steps");

    // Last batch step: done (since all steps succeed)
    const lastBatch = batchSteps[batchSteps.length - 1];
    expect(lastBatch[0].status).toBe("done");
    expect(lastBatch[0].label).toContain("2 steps OK");
  });
});
