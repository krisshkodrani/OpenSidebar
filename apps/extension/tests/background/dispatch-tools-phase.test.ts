import { describe, expect, it, vi } from "vitest";
import { ToolName, type ToolCall } from "../../src/types";
import { LoopSession, TurnScope } from "../../src/background/agent/loop-scope";
import { TurnState } from "../../src/background/agent/turn-state";
import {
  runDispatchToolsPhase,
  type DispatchToolsDeps,
  type DispatchToolsHost,
} from "../../src/background/agent/turn-phases/dispatch-tools";

const dispatch = vi.hoisted(() => ({ sequential: vi.fn(), parallel: vi.fn() }));
vi.mock("../../src/background/agent/sequential-tool-dispatch", () => ({
  executeSequentialToolCalls: dispatch.sequential,
}));
vi.mock("../../src/background/agent/parallel-tool-dispatch", () => ({
  executeParallelToolCalls: dispatch.parallel,
}));

function call(name: string, args: object, id: string): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function setup(calls: ToolCall[]) {
  dispatch.sequential.mockReset().mockImplementation(async ({ state }) => ({ ...state }));
  dispatch.parallel.mockReset().mockImplementation(async ({ state }) => ({ state, results: [] }));
  const host = {
    turnCount: 6, context: { addMessage: vi.fn(), setLastActionOutcome: vi.fn() },
    log: { warn: vi.fn() }, traceRecorder: { recordEvent: vi.fn() },
    throwIfGracefulStopRequested: vi.fn(), getServiceNowMissingFieldAdmissionSummary: () => null,
    statusHandler: vi.fn(),
    finalizeParallelToolResults: vi.fn(), escalationRescue: { noteEscalation: vi.fn() },
  } as unknown as DispatchToolsHost;
  const deps = {
    session: new LoopSession(1, 0), turn: new TurnScope(), turnState: new TurnState(),
    esc: { tier: 0, orientationPhase: false, orientationToolsUsed: new Set() },
    verifiedFinalClickBypassKeys: new Set(), blockedActions: [], signalCompletedResult: vi.fn(),
    response: { content: "Read the page.", tool_calls: calls }, cleanContent: "Read the page.",
    toolsRecoveredFromText: false, llmIntention: null, hadThinking: true,
  } as unknown as DispatchToolsDeps;
  return { host, deps };
}

describe("dispatch tool admission", () => {
  it.each([ToolName.READ_PAGE, ToolName.READ_ELEMENT, ToolName.FIND_ELEMENT])(
    "allows another useful %s after five reading turns", async (name) => {
      const requested = call(name, name === ToolName.READ_ELEMENT ? { id: 6 } : {}, "next-read");
      const { host, deps } = setup([requested]);
      deps.session.consecutiveExplorationTurns = 5;
      await runDispatchToolsPhase(host, deps);
      const executed = [...dispatch.sequential.mock.calls, ...dispatch.parallel.mock.calls]
        .flatMap(([input]) => input.toolCalls);
      expect(executed).toEqual([requested]);
      expect(host.context.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({
        role: "tool", content: expect.stringContaining("Exploration blocked"),
      }));
    },
  );

  it.each([
    call("nonexistent_tool", {}, "invalid-name"),
    call(ToolName.NAVIGATE, { url: "javascript:void(0)" }, "invalid-url"),
    call(ToolName.EXECUTE_JS, { code: 'location.href = "https://example.test/"' }, "invalid-script"),
  ])("does not dispatch a rejected call alongside an allowed call: $id", async (rejected) => {
    const allowed = call(ToolName.READ_PAGE, {}, "allowed-read");
    const { host, deps } = setup([rejected, allowed]);
    await runDispatchToolsPhase(host, deps);
    const executed = [...dispatch.sequential.mock.calls, ...dispatch.parallel.mock.calls]
      .flatMap(([input]) => input.toolCalls);
    expect(executed).toEqual([allowed]);
    expect(host.context.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "tool", tool_call_id: rejected.id, content: expect.stringContaining("Blocked:"),
    }));
  });
});
