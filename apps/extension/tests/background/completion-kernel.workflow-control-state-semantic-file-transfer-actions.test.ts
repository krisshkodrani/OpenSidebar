import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";

function workflowSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Account Settings",
    url: "https://example.test/account",
    visibleContent: "Account settings",
    pageContent: "Account settings",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function actionButton(tag: number, label: string): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: {
      id: key,
      "aria-label": label,
    },
    rect: { x: 500, y: tag * 20, width: 120, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

function stableActionButton(
  tag: number,
  label: string,
  id: string,
): TaggedElement {
  return {
    ...actionButton(tag, label),
    attributes: {
      id,
      "aria-label": label,
    },
  };
}

function dataStateActionButton(
  tag: number,
  label: string,
  state: string,
  id: string,
): TaggedElement {
  return {
    ...stableActionButton(tag, label, id),
    attributes: {
      id,
      "aria-label": label,
      "data-state": state,
    },
  };
}

describe("completion kernel workflow control-state semantic file-transfer action confirmation", () => {
  for (const scenario of [
    {
      action: "export",
      completion: "exported",
      label: "Export Report Alpha",
      request: "Export Report Alpha.",
      summary: "Exported Report Alpha.",
      target: "Report Alpha",
      id: "report-alpha-export",
      beforeState: "ready",
      afterState: "exported",
    },
    {
      action: "download",
      completion: "downloaded",
      label: "Download File Alpha",
      request: "Download File Alpha.",
      summary: "Downloaded File Alpha.",
      target: "File Alpha",
      id: "file-alpha-download",
      beforeState: "ready",
      afterState: "downloaded",
    },
    {
      action: "upload",
      completion: "uploaded",
      label: "Upload File Alpha",
      request: "Upload File Alpha.",
      summary: "Uploaded File Alpha.",
      target: "File Alpha",
      id: "file-alpha-upload",
      beforeState: "pending",
      afterState: "uploaded",
    },
    {
      action: "import",
      completion: "imported",
      label: "Import File Alpha",
      request: "Import File Alpha.",
      summary: "Imported File Alpha.",
      target: "File Alpha",
      id: "file-alpha-import",
      beforeState: "staged",
      afterState: "imported",
    },
  ] as const) {
    test(`accepts ${scenario.action} confirmation from semantic file-transfer data-state control state change`, () => {
      const pre = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            834,
            scenario.label,
            scenario.beforeState,
            scenario.id,
          ),
        ],
      });
      const current = workflowSnapshot({
        visibleContent: `${scenario.target} ${scenario.label}`,
        pageContent: `${scenario.target} ${scenario.label}`,
        elements: [
          dataStateActionButton(
            835,
            scenario.label,
            scenario.afterState,
            scenario.id,
          ),
        ],
      });
      const generated = generateCompletionContract({
        userRequest: scenario.request,
        snapshot: current,
      });
      const evidence = deriveCompletionEvidenceFromToolOutcome({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 834 },
        result: "Clicked element 834.",
        preActionSnapshot: pre,
        currentSnapshot: current,
        turn: 11,
      });
      const decision = evaluateCompletionContract({
        contract: generated?.contract,
        evidence,
        snapshot: current,
        candidateSource: "model_done",
        summary: scenario.summary,
      });

      expect(generated?.contract).toMatchObject({
        kind: "workflow_confirmation",
        action: scenario.action,
        targetLabel: scenario.target,
      });
      expect(evidence).toEqual([
        expect.objectContaining({
          type: "confirmation_state",
          confidence: "high",
          logicalKey: `workflow:confirmation:${scenario.action}:control-state:${scenario.id}`,
          detail: expect.objectContaining({
            action: scenario.action,
            source: "control_state_change",
            targetText: scenario.target,
            text: `Control state changed to ${scenario.completion}: ${scenario.label}`,
          }),
        }),
      ]);
      expect(decision.status).toBe("accepted");
    });
  }

  test("does not infer export confirmation when semantic data-state was already exported", () => {
    const pre = workflowSnapshot({
      visibleContent: "Report Alpha Export Report Alpha",
      pageContent: "Report Alpha Export Report Alpha",
      elements: [
        dataStateActionButton(
          836,
          "Export Report Alpha",
          "exported",
          "report-alpha-export",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Report Alpha Export Report Alpha",
      pageContent: "Report Alpha Export Report Alpha",
      elements: [
        dataStateActionButton(
          837,
          "Export Report Alpha",
          "exported",
          "report-alpha-export",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 836 },
      result: "Clicked element 836.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer import confirmation when semantic data-state flips staged", () => {
    const pre = workflowSnapshot({
      visibleContent: "File Alpha Import File Alpha",
      pageContent: "File Alpha Import File Alpha",
      elements: [
        dataStateActionButton(
          838,
          "Import File Alpha",
          "imported",
          "file-alpha-import",
        ),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "File Alpha Import File Alpha",
      pageContent: "File Alpha Import File Alpha",
      elements: [
        dataStateActionButton(
          839,
          "Import File Alpha",
          "staged",
          "file-alpha-import",
        ),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 838 },
      result: "Clicked element 838.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 11,
    });

    expect(evidence).toEqual([]);
  });
});
