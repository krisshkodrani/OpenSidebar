import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";

vi.mock("../../src/background/infrastructure/tab-ready", () => ({
  waitForDomReady: vi.fn(),
}));

import { waitForDomReady } from "../../src/background/infrastructure/tab-ready";
import {
  actionExecutionContext,
  preflightDirectPageAction,
  settleToolAction,
  stageGroundedAction,
} from "../../src/background/agent/page-state/action-lifecycle";
import { PageStateCoordinator } from "../../src/background/agent/page-state";
import { ToolRegistry } from "../../src/background/tools/registry";
import { ToolName, type DomSnapshot, type PageDocumentState } from "../../src/types";

const documentState: PageDocumentState = {
  documentInstanceId: "doc-1",
  mutationEpoch: 4,
  url: "https://example.test/",
  viewport: { width: 1280, height: 720 },
  scroll: { x: 0, y: 0 },
};

const snapshot: DomSnapshot = {
  title: "Example",
  url: documentState.url,
  elements: [],
  viewport: documentState.viewport,
  scroll: { ...documentState.scroll, maxY: 0, viewportHeight: 720 },
};

describe("page-state action lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  test("rejects a direct background mutation before its executor runs", async () => {
    vi.mocked(waitForDomReady).mockResolvedValue({
      waitedMs: 0,
      elementCount: 1,
      documentState: { ...documentState, mutationEpoch: 5 },
    });
    const coordinator = new PageStateCoordinator();
    const observation = coordinator.acceptDomObservation({
      snapshot,
      documentState,
    });
    const basis = stageGroundedAction(
      coordinator,
      "call-js",
      observation.basis,
    );

    const result = await preflightDirectPageAction({
      coordinator,
      traceRecorder: null,
      actionId: "call-js",
      toolName: ToolName.EXECUTE_JS,
      basis,
      enforceConsistency: true,
      tabId: 9,
    });

    expect(result).toContain("fresh observation");
    expect(coordinator.getLastActionReceipt()).toMatchObject({
      actionId: "call-js",
      status: "stale",
      reason: "stale_observation",
    });
  });

  test("keeps executor-visible schemas unchanged while passing trusted context", async () => {
    const registry = new ToolRegistry();
    const executor = vi.fn(async () => "clicked");
    const definition = {
      type: "function" as const,
      function: {
        name: ToolName.CLICK_ELEMENT,
        description: "Click",
        parameters: { type: "object", properties: {} },
      },
    };
    registry.register(ToolName.CLICK_ELEMENT, definition, executor);
    const coordinator = new PageStateCoordinator();
    coordinator.acceptDomObservation({ snapshot, documentState });
    const context = actionExecutionContext(
      coordinator.getCurrentObservation()!.basis,
      ToolName.CLICK_ELEMENT,
      true,
    );

    await registry.executeDetailed(
      {
        id: "call-click",
        type: "function",
        function: { name: ToolName.CLICK_ELEMENT, arguments: "{}" },
      },
      9,
      undefined,
      context,
    );

    expect(registry.getDefinitions()).toEqual([definition]);
    expect(executor.mock.calls[0][4]).toEqual(context);
  });

  test("defers navigation receipts until the destination observation exists", () => {
    const coordinator = new PageStateCoordinator();
    const before = coordinator.acceptDomObservation({ snapshot, documentState });
    coordinator.stageAction("navigate-1", before.basis);

    settleToolAction({
      coordinator,
      traceRecorder: null,
      actionId: "navigate-1",
      toolName: ToolName.NAVIGATE,
      basis: before.basis,
      execution: { result: "Navigated" },
    });
    expect(coordinator.getActionReceipts()).toHaveLength(0);

    const destinationUrl = "https://example.test/next";
    const after = coordinator.acceptDomObservation({
      snapshot: { ...snapshot, url: destinationUrl },
      documentState: {
        ...documentState,
        mutationEpoch: 5,
        url: destinationUrl,
      },
    });
    const [receipt] = coordinator.finalizePendingActions(after);

    expect(receipt).toMatchObject({
      actionId: "navigate-1",
      status: "executed",
      effect: { urlChanged: true },
      after: { observationRevision: after.basis.observationRevision },
    });
  });
});
