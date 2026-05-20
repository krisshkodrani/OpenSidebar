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

function textField(
  tag: number,
  label: string,
  value = "",
  type = "text",
): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "input",
    role: "textbox",
    text: value,
    attributes: {
      id: key,
      name: key,
      type,
      value,
      label,
    },
    rect: { x: 0, y: tag * 20, width: 180, height: 24 },
    isVisible: true,
    isDisabled: false,
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

function rowElement(tag: number, text: string): TaggedElement {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "tr",
    role: "row",
    text,
    attributes: {
      id: `row-${key}`,
    },
    rect: { x: 0, y: tag * 20, width: 600, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel create form and row workflow confirmation", () => {
  test("accepts create confirmation from named form disappearance", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Customers",
      pageContent: "Customers",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Customer Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:form:customer-alpha",
        detail: expect.objectContaining({
          action: "create",
          source: "form_disappearance",
          targetText: "Customer Alpha",
          text: "Create form no longer visible: Customer Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects create form-disappearance evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Beta Create customer",
      pageContent: "New customer Name Customer Beta Create customer",
      elements: [
        textField(575, "Name", "Customer Beta"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Customers",
      pageContent: "Customers",
      elements: [],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Customer Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:form:customer-beta",
        detail: expect.objectContaining({
          action: "create",
          source: "form_disappearance",
          targetText: "Customer Beta",
          text: "Create form no longer visible: Customer Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("accepts create confirmation from visible created-row when form resets", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "New customer Name Create customer Customers Customer Alpha Active",
      pageContent:
        "New customer Name Create customer Customers Customer Alpha Active",
      elements: [
        textField(575, "Name", ""),
        actionButton(576, "Create customer"),
        rowElement(610, "Customer Alpha Active"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "workflow_confirmation",
      action: "create",
      targetLabel: "Customer Alpha",
    });
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:row:customer-alpha",
        detail: expect.objectContaining({
          action: "create",
          source: "created_row",
          targetText: "Customer Alpha",
          text: "Created row visible: Customer Alpha",
        }),
      }),
    ]);
    expect(decision.status).toBe("accepted");
  });

  test("rejects visible created-row evidence for the wrong requested target", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Beta Create customer",
      pageContent: "New customer Name Customer Beta Create customer",
      elements: [
        textField(575, "Name", "Customer Beta"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "New customer Name Create customer Customers Customer Beta Active",
      pageContent:
        "New customer Name Create customer Customers Customer Beta Active",
      elements: [
        textField(575, "Name", ""),
        actionButton(576, "Create customer"),
        rowElement(610, "Customer Beta Active"),
      ],
    });
    const generated = generateCompletionContract({
      userRequest: "Create Customer Alpha.",
      snapshot: current,
    });
    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: current,
      candidateSource: "model_done",
      summary: "Created Customer Alpha.",
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        type: "confirmation_state",
        confidence: "high",
        logicalKey: "workflow:confirmation:create:row:customer-beta",
        detail: expect.objectContaining({
          action: "create",
          source: "created_row",
          targetText: "Customer Beta",
        }),
      }),
    ]);
    expect(decision).toMatchObject({
      status: "rejected",
      reason:
        "Workflow confirmation evidence is for a different target than the requested action.",
    });
  });

  test("does not infer created-row evidence from plain visible text", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "New customer Name Create customer Customer Alpha was mentioned in help text",
      pageContent:
        "New customer Name Create customer Customer Alpha was mentioned in help text",
      elements: [
        textField(575, "Name", ""),
        actionButton(576, "Create customer"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer created-row evidence from a row that already existed", () => {
    const pre = workflowSnapshot({
      visibleContent:
        "Customers Customer Alpha Active New customer Name Customer Alpha Create customer",
      pageContent:
        "Customers Customer Alpha Active New customer Name Customer Alpha Create customer",
      elements: [
        rowElement(610, "Customer Alpha Active"),
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent:
        "Customers Customer Alpha Active New customer Name Create customer",
      pageContent:
        "Customers Customer Alpha Active New customer Name Create customer",
      elements: [
        rowElement(610, "Customer Alpha Active"),
        textField(575, "Name", ""),
        actionButton(576, "Create customer"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer create confirmation while the named form remains visible", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer create confirmation from a generic create control without a target field", () => {
    const pre = workflowSnapshot({
      visibleContent: "Customers Customer Alpha Create customer",
      pageContent: "Customers Customer Alpha Create customer",
      elements: [actionButton(576, "Create customer")],
    });
    const current = workflowSnapshot({
      visibleContent: "Customers",
      pageContent: "Customers",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });

  test("does not infer create confirmation when validation appears after form submission", () => {
    const pre = workflowSnapshot({
      visibleContent: "New customer Name Customer Alpha Create customer",
      pageContent: "New customer Name Customer Alpha Create customer",
      elements: [
        textField(575, "Name", "Customer Alpha"),
        actionButton(576, "Create customer"),
      ],
    });
    const current = workflowSnapshot({
      visibleContent: "Name is required. Please fill the required field.",
      pageContent: "Name is required. Please fill the required field.",
      elements: [],
    });

    const evidence = deriveCompletionEvidenceFromToolOutcome({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 576 },
      result: "Clicked element 576.",
      preActionSnapshot: pre,
      currentSnapshot: current,
      turn: 9,
    });

    expect(evidence).toEqual([]);
  });
});
