import { describe, expect, test } from "vitest";
import "../setup";

import {
  getMutationReplayFingerprint,
  MutationLedger,
} from "../../src/background/agent/mutation-ledger";
import type { DomSnapshot } from "../../src/types";
import { ToolName } from "../../src/types";
import { CheckpointCoordinator } from "../../src/background/agent/checkpoint-coordinator";
import { getMutationDocumentId, lookupMutationReplay, type LoopQueriesHost } from "../../src/background/agent/loop-queries";

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    url: "https://example.com",
    title: "Example",
    text: "",
    pageContent: "",
    visibleContent: "",
    elements: [],
    timestamp: 1,
    ...overrides,
  } as DomSnapshot;
}

describe("MutationLedger", () => {
  test("loop replay forwards the identity of its actual observed snapshot", () => {
    const ledger = new MutationLedger();
    const snap = snapshot();
    let documentInstanceId = "original-document";
    const host = {
      context: { getSnapshot: () => snap },
      perception: { getCurrentObservation: () => ({ basis: { documentInstanceId }, dom: { snapshot: snap } }) },
      guardAfterDoneRejection: true,
      checkpoints: new CheckpointCoordinator(undefined, ledger),
    } as unknown as LoopQueriesHost;
    ledger.record({ toolName: ToolName.SELECT_OPTION, args: { id: 1, value: "Open" }, result: "Selected",
      actionSnapshot: snap, documentInstanceId: getMutationDocumentId(host, snap), planIndex: 0, turn: 1 });
    expect(lookupMutationReplay(host, ToolName.SELECT_OPTION, { id: 1, value: "Open" })).not.toBeNull();
    documentInstanceId = "returned-document";
    expect(lookupMutationReplay(host, ToolName.SELECT_OPTION, { id: 1, value: "Open" })).toBeNull();
    expect(getMutationDocumentId(host, snapshot())).toBeUndefined();
    documentInstanceId = "legacy:https://example.com";
    expect(getMutationDocumentId(host, snap)).toBeUndefined();
  });

  test("select readback participates in the action fingerprint", () => {
    const withSelection = (selected: string) => snapshot({ elements: [{
      tag: 1, tagName: "select", role: "combobox", text: "AllOpenClosed",
      attributes: { selected },
    }] });
    expect(getMutationReplayFingerprint(withSelection("All")))
      .not.toBe(getMutationReplayFingerprint(withSelection("Open")));
  });

  test.each([ToolName.SELECT_OPTION, ToolName.CLICK_ELEMENT])(
    "does not replay %s when navigation returns to an identical page in a new document",
    (toolName) => {
      const ledger = new MutationLedger();
      const snap = snapshot({ pageContent: "Search results. Filters: All" });
      const args = toolName === ToolName.SELECT_OPTION ? { id: 1, value: "Open" } : { id: 8 };
      ledger.record({ toolName, args, result: "Executed", actionSnapshot: snap,
        documentInstanceId: "document-before-navigation", planIndex: 0, turn: 1 });
      expect(ledger.lookup(toolName, args, snap, true, "document-before-navigation")).not.toBeNull();
      expect(ledger.lookup(toolName, args, snap, true, "document-after-navigation")).toBeNull();
      ledger.clearStepLedger();
      expect(ledger.lookup(toolName, args, snap, true, "document-after-navigation")).toBeNull();
    },
  );

  test("restored submission replay stays protected in the same document or when identity is unavailable", () => {
    const ledger = new MutationLedger();
    const snap = snapshot({ pageContent: "Submit application" });
    ledger.record({ toolName: ToolName.CLICK_ELEMENT, args: { id: 5 }, result: "Submitted",
      actionSnapshot: snap, documentInstanceId: "submission-document", planIndex: 0, turn: 1 });
    const restored = new MutationLedger();
    restored.restore(JSON.parse(JSON.stringify(ledger.entries)), []);
    expect(restored.lookup(ToolName.CLICK_ELEMENT, { id: 5 }, snap, true, "submission-document")?.result).toBe("Submitted");
    expect(restored.lookup(ToolName.CLICK_ELEMENT, { id: 5 }, snap, true)?.result).toBe("Submitted");
  });

  test("ignores read-only tools", () => {
    const ledger = new MutationLedger(() => 1, () => "id-1");
    const snap = snapshot();

    ledger.record({
      toolName: ToolName.READ_PAGE,
      args: {},
      result: "read",
      currentSnapshot: snap,
      planIndex: 0,
      turn: 1,
    });

    expect(ledger.entries).toHaveLength(0);
    expect(ledger.sideEffects).toHaveLength(0);
    expect(ledger.lookup(ToolName.READ_PAGE, {}, snap, true)).toBeNull();
  });

  test("stamps the form + diff digest onto a sealed submit (LP-15 Phase 8)", () => {
    const ledger = new MutationLedger(() => 5, () => "id-2");
    const snap = snapshot();
    ledger.record({
      toolName: ToolName.CLICK_ELEMENT, // a submit CLICK — already sensitive
      args: { id: 7 },
      result: "form_dry_run:clean",
      currentSnapshot: snap,
      planIndex: 0,
      turn: 1,
      formSubmitSeal: { formKey: "/apply", diffHash: "abc123" },
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({
      toolName: ToolName.CLICK_ELEMENT,
      formKey: "/apply",
      diffHash: "abc123",
    });
  });

  test("a formSubmitSeal records even a non-sensitive tool (bypasses the gate)", () => {
    const ledger = new MutationLedger(() => 5, () => "id-3");
    const snap = snapshot();
    // Without a seal, a read-only tool is ignored.
    ledger.record({
      toolName: ToolName.READ_PAGE,
      args: {},
      result: "x",
      currentSnapshot: snap,
      planIndex: 0,
      turn: 1,
    });
    expect(ledger.entries).toHaveLength(0);
    // With a seal, it records.
    ledger.record({
      toolName: ToolName.READ_PAGE,
      args: {},
      result: "form_dry_run:unexpected",
      currentSnapshot: snap,
      planIndex: 0,
      turn: 1,
      formSubmitSeal: { formKey: "/f", diffHash: "h" },
    });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].diffHash).toBe("h");
  });

  test("records mutation-sensitive actions and replays from ledger first", () => {
    const ledger = new MutationLedger(() => 10, () => "effect-1");
    const snap = snapshot();

    ledger.record({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 5 },
      result: "clicked",
      actionSnapshot: snap,
      currentSnapshot: snap,
      planIndex: 2,
      turn: 7,
    });

    expect(
      ledger.lookup(ToolName.CLICK_ELEMENT, { id: 5 }, snap, false),
    ).toEqual({
      result: "clicked",
      source: "ledger",
    });
    expect(ledger.sideEffects[0]).toMatchObject({
      id: "effect-1",
      turn: 7,
      planIndex: 2,
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 5 },
      result: "clicked",
      timestamp: 10,
    });
  });

  test("consumes coordinator receipts as observed mutation evidence", () => {
    const ledger = new MutationLedger();
    ledger.recordReceipt({
      actionId: "call-1",
      status: "executed",
      before: {
        observationRevision: 1,
        documentInstanceId: "doc-1",
        mutationEpoch: 2,
        snapshotFingerprint: "before",
        url: "https://example.com",
        viewport: { width: 1000, height: 700 },
        scroll: { x: 0, y: 0 },
      },
      effect: {
        documentChanged: false,
        urlChanged: false,
        domChanged: true,
        visualChanged: "not_observed",
      },
      evidenceRefs: ["observation:2"],
    });

    expect(ledger.receipts).toEqual([
      expect.objectContaining({
        actionId: "call-1",
        effect: expect.objectContaining({ domChanged: true }),
        evidenceRefs: ["observation:2"],
      }),
    ]);
  });

  test("uses ephemeral replay only when done-rejection guard is enabled", () => {
    const ledger = new MutationLedger(() => 10, () => "effect-1");
    const snap = snapshot();

    ledger.record({
      toolName: ToolName.TYPE_TEXT,
      args: { id: 1, text: "hello" },
      result: "typed",
      actionSnapshot: snap,
      currentSnapshot: snap,
      planIndex: 0,
      turn: 1,
    });
    ledger.clearStepLedger();

    expect(
      ledger.lookup(ToolName.TYPE_TEXT, { id: 1, text: "hello" }, snap, false),
    ).toBeNull();
    expect(
      ledger.lookup(ToolName.TYPE_TEXT, { id: 1, text: "hello" }, snap, true),
    ).toEqual({ result: "typed", source: "ephemeral" });
  });

  test("truncates stored results and caps retained entries", () => {
    let now = 0;
    const ledger = new MutationLedger(() => ++now, () => `effect-${now}`);
    const snap = snapshot();
    const longResult = "x".repeat(600);

    for (let i = 0; i < 55; i++) {
      ledger.record({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: i },
        result: longResult,
        actionSnapshot: snap,
        currentSnapshot: snap,
        planIndex: 0,
        turn: i,
      });
    }

    expect(ledger.entries).toHaveLength(50);
    expect(ledger.entries[0].args).toEqual({ id: 5 });
    expect(ledger.entries[0].result).toHaveLength(500);
    expect(ledger.sideEffects).toHaveLength(55);
    expect(ledger.sideEffects[0].result).toHaveLength(300);

    for (let i = 55; i < 105; i++) {
      ledger.record({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: i },
        result: "clicked",
        actionSnapshot: snap,
        currentSnapshot: snap,
        planIndex: 0,
        turn: i,
      });
    }

    expect(ledger.sideEffects).toHaveLength(100);
    expect(ledger.sideEffects[0].turn).toBe(5);
  });

  test("includes element signature when page text is empty", () => {
    const first = getMutationReplayFingerprint(
      snapshot({
        elements: [
          {
            tag: 1,
            tagName: "button",
            text: "Save",
            role: "button",
            attributes: {},
          },
        ],
      }),
    );
    const second = getMutationReplayFingerprint(
      snapshot({
        elements: [
          {
            tag: 1,
            tagName: "button",
            text: "Delete",
            role: "button",
            attributes: {},
          },
        ],
      }),
    );

    expect(first).not.toBe(second);
    expect(first).toContain("|elements:");
  });

  test("includes form element value changes even when page text is unchanged", () => {
    const first = getMutationReplayFingerprint(
      snapshot({
        pageContent: "Partner portal Register a partner contact.",
        elements: [
          {
            tag: 10,
            tagName: "button",
            text: "Submit registration",
            role: "button",
            attributes: { type: "submit" },
          },
          {
            tag: 4,
            tagName: "input",
            text: "415-555-0134",
            role: "tel",
            attributes: { name: "phone", value: "415-555-0134" },
          },
        ],
      }),
    );
    const second = getMutationReplayFingerprint(
      snapshot({
        pageContent: "Partner portal Register a partner contact.",
        elements: [
          {
            tag: 10,
            tagName: "button",
            text: "Submit registration",
            role: "button",
            attributes: { type: "submit" },
          },
          {
            tag: 4,
            tagName: "input",
            text: "+1 415-555-0134",
            role: "tel",
            attributes: { name: "phone", value: "+1 415-555-0134" },
          },
        ],
      }),
    );

    expect(first).not.toBe(second);
    expect(first).toContain("|elements:");
  });

  test("does not replay a repeated submit click after form values change", () => {
    const ledger = new MutationLedger(() => 10, () => "effect-1");
    const beforeValidation = snapshot({
      pageContent: "Partner portal Register a partner contact.",
      elements: [
        {
          tag: 10,
          tagName: "button",
          text: "Submit registration",
          role: "button",
          attributes: { type: "submit" },
        },
        {
          tag: 4,
          tagName: "input",
          text: "415-555-0134",
          role: "tel",
          attributes: { name: "phone", value: "415-555-0134" },
        },
      ],
    });
    const afterRepair = snapshot({
      pageContent: "Partner portal Register a partner contact.",
      elements: [
        {
          tag: 10,
          tagName: "button",
          text: "Submit registration",
          role: "button",
          attributes: { type: "submit" },
        },
        {
          tag: 4,
          tagName: "input",
          text: "+1 415-555-0134",
          role: "tel",
          attributes: { name: "phone", value: "+1 415-555-0134" },
        },
      ],
    });

    ledger.record({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 10 },
      result: 'Clicked [10] button "Submit registration"',
      actionSnapshot: beforeValidation,
      currentSnapshot: beforeValidation,
      planIndex: 0,
      turn: 1,
    });

    expect(
      ledger.lookup(ToolName.CLICK_ELEMENT, { id: 10 }, afterRepair, false),
    ).toBeNull();
  });
});
