import { describe, expect, test } from "vitest";
import "../setup";
import type { DomSnapshot, TaggedElement } from "../../src/types";
import {
  CompletionEvidenceLedger,
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
} from "../../src/background/agent/completion-kernel";

import {
  recordCompletionToolEvidence,
  refreshCompletionEvidenceFromSnapshot,
  type CompletionEvidenceHost,
} from "../../src/background/agent/completion-evidence";

function element(
  tag: number,
  tagName: string,
  text: string,
  attributes: Record<string, string> = {},
): TaggedElement {
  return {
    tag,
    tagName,
    text,
    attributes,
    role: tagName === "button" ? "button" : "textbox",
    isVisible: true,
    isDisabled: false,
    rect: { x: 0, y: 0, width: 100, height: 30 },
  };
}
function snapshots(
  title: string,
  reference: string,
  action: string,
  visibility: string,
) {
  const value =
    "The staging checks passed and the review is scheduled for Friday.";
  const pre: DomSnapshot = {
    url: "https://app.example/records/42",
    title: "Workspace",
    pageContent: `## ${title}\nRecord\n${reference}\n## Editor`,
    elements: [
      element(1, "textarea", value, { label: "Update text" }),
      element(2, "select", "Public Team only", {
        label: "Visibility",
        selected: visibility,
      }),
      element(3, "button", action),
    ],
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 800 },
  };
  const current: DomSnapshot = {
    ...pre,
    elements: [],
    pageContent: `## ${title}\nRecord\n${reference}\n## Saved update\nVisibility: ${visibility}\n${value}\nSaved successfully`,
  };
  return { pre, current, value };
}
function evidence(pre: DomSnapshot, current: DomSnapshot, overrides = {}) {
  return deriveCompletionEvidenceFromToolOutcome({
    userRequest:
      'Save a team-only internal update for Project Beacon and add an internal note: "The staging checks passed and the review is scheduled for Friday."',
    toolName: "click_element",
    args: { id: 3 },
    result: "Clicked button",
    preActionSnapshot: pre,
    currentSnapshot: current,
    turn: 3,
    ...overrides,
  }).filter(
    (item) =>
      item.type === "confirmation_state" &&
      item.detail.source === "saved_form_readback",
  );
}

describe("saved form readback", () => {
  test.each([
    ["Add an internal note", "T-4271", "Add an internal note", "Internal"],
    ["Project Beacon", "PRJ-42", "Save update", "Team only"],
  ])(
    "accepts a submitted editor with newly visible values: %s",
    (title, reference, action, visibility) => {
      const { pre, current } = snapshots(title, reference, action, visibility);
      const events = evidence(pre, current);
      expect(events).toHaveLength(1);
      expect(
        evaluateCompletionContract({
          contract: {
            kind: "workflow_confirmation",
            action: "save",
            targetLabel: title,
          },
          evidence: events,
          snapshot: current,
          candidateSource: "model_done",
          summary: `Saved the update for ${title}.`,
        }).status,
      ).toBe("accepted");
      expect(
        evaluateCompletionContract({
          contract: {
            kind: "workflow_confirmation",
            action: "save",
            targetLabel: "Unrelated record R-999",
          },
          evidence: events,
          snapshot: current,
          candidateSource: "model_done",
          summary: "Saved the update.",
        }).status,
      ).toBe("rejected");
    },
  );

  test.each([
    [
      "missing text",
      (s: DomSnapshot) => {
        s.pageContent = s.pageContent!.replace(
          "The staging checks passed and the review is scheduled for Friday.",
          "",
        );
      },
    ],
    [
      "wrong visibility",
      (s: DomSnapshot) => {
        s.pageContent = s.pageContent!.replace("Team only", "Public");
      },
    ],
    [
      "wrong record",
      (s: DomSnapshot) => {
        s.pageContent = s.pageContent!.replace("PRJ-42", "PRJ-43");
      },
    ],
    [
      "record ID prefix collision",
      (s: DomSnapshot) => {
        s.pageContent = s.pageContent!.replace("PRJ-42", "PRJ-420");
      },
    ],
    [
      "different heading",
      (s: DomSnapshot) => {
        s.pageContent = s.pageContent!.replace(
          "Project Beacon",
          "Project Atlas",
        );
      },
    ],
    [
      "different URL",
      (s: DomSnapshot) => {
        s.url = "https://app.example/records/43";
      },
    ],
    [
      "no save confirmation",
      (s: DomSnapshot) => {
        s.pageContent = s.pageContent!.replaceAll("Saved", "Preview");
      },
    ],
    [
      "validation error",
      (s: DomSnapshot) => {
        s.pageContent += "\nA required field is missing";
      },
    ],
  ] as const)("does not accept %s", (_name, modify) => {
    const { pre, current } = snapshots(
      "Project Beacon",
      "PRJ-42",
      "Save update",
      "Team only",
    );
    modify(current);
    expect(evidence(pre, current)).toEqual([]);
  });

  test("uses visible page structure when article extraction omits the record heading", () => {
    const { pre, current } = snapshots(
      "Project Beacon",
      "PRJ-42",
      "Save update",
      "Team only",
    );
    pre.skeleton = [
      {
        tagName: "h1",
        role: "heading",
        level: 1,
        text: "Project Beacon",
        depth: 0,
      },
    ];
    current.pageContent = current.pageContent!.replace(
      "## Project Beacon\nRecord\nPRJ-42\n",
      "",
    );
    current.skeleton = [
      ...pre.skeleton,
      { tagName: "p", role: "p", text: "Project ID: PRJ-42", depth: 0 },
    ];
    expect(evidence(pre, current)).toHaveLength(1);
    current.skeleton[1].text = "Project ID: PRJ-43";
    expect(evidence(pre, current)).toEqual([]);
  });

  test("retains the submitted form title as target evidence after the editor disappears", () => {
    const { pre, current } = snapshots(
      "Project Beacon",
      "PRJ-42",
      "Save update",
      "Team only",
    );
    pre.pageContent = pre.pageContent!.replace(
      "## Editor",
      "## Add project update",
    );
    expect(
      evaluateCompletionContract({
        contract: {
          kind: "workflow_confirmation",
          action: "save",
          targetLabel: "Add project update",
        },
        evidence: evidence(pre, current),
        snapshot: current,
        candidateSource: "model_done",
        summary: "Saved the team-only update for Project Beacon.",
      }).status,
    ).toBe("accepted");
  });

  test("rejects values not requested by the user", () => {
    const { pre, current } = snapshots(
      "Project Beacon",
      "PRJ-42",
      "Save update",
      "Team only",
    );
    expect(
      evidence(pre, current, {
        userRequest: "Save a public update with different text.",
      }),
    ).toEqual([]);
    expect(
      evidence(pre, current, {
        userRequest:
          'Save "The staging checks passed and the review is scheduled for Friday." Not team-only.',
      }),
    ).toEqual([]);
    expect(evidence(pre, current, { userRequest: undefined })).toEqual([]);
  });

  test("rejects a saved result for a record different from the requested record", () => {
    const { pre, current, value } = snapshots(
      "Project Beacon",
      "PRJ-42",
      "Save update",
      "Team only",
    );
    expect(
      evidence(pre, current, {
        userRequest: `Save a team-only update for Project Beacon PRJ-43: "${value}"`,
      }),
    ).toEqual([]);
    expect(
      evidence(pre, current, {
        userRequest: `Save a team-only update for Project Atlas: "${value}"`,
      }),
    ).toEqual([]);
  });

  test("rejects explicitly negated saving", () => {
    const { pre, current } = snapshots(
      "Project Beacon",
      "PRJ-42",
      "Save update",
      "Team only",
    );
    current.pageContent += "\nThe update was not saved.";
    expect(evidence(pre, current)).toEqual([]);
  });

  test("requires a real submit, removed editor, and new readback", () => {
    const { pre, current, value } = snapshots(
      "Project Beacon",
      "PRJ-42",
      "Save update",
      "Team only",
    );
    expect(evidence(pre, current, { toolName: "read_page" })).toEqual([]);
    expect(evidence(pre, current, { result: "Error: timed out" })).toEqual([]);
    expect(evidence(pre, { ...current, elements: pre.elements })).toEqual([]);
    expect(
      evidence(
        { ...pre, pageContent: pre.pageContent + "\n" + value },
        current,
      ),
    ).toEqual([]);
    pre.elements[2].role = "link";
    pre.elements[2].tagName = "a";
    expect(evidence(pre, current)).toEqual([]);
    pre.elements[2].role = "button";
    pre.elements[2].tagName = "button";
    pre.elements[2].text = "Cancel";
    expect(evidence(pre, current)).toEqual([]);
  });
});

describe("post-action completion evidence timing", () => {
  test("waits for the refreshed observation and consumes a pending click once", () => {
    const { pre, current, value } = snapshots(
      "Project Beacon",
      "PRJ-42",
      "Save update",
      "Team only",
    );
    let snapshot = pre;
    const ledger = new CompletionEvidenceLedger();
    const host = {
      turnCount: 3,
      originalQuery: `Save a team-only update for Project Beacon: "${value}"`,
      completionEvidence: ledger,
      traceRecorder: null,
      context: { getSnapshot: () => snapshot },
      planSubtasks: [],
      planSteps: [],
    } as unknown as CompletionEvidenceHost;
    recordCompletionToolEvidence(
      host,
      "click_element" as never,
      { id: 3 },
      "Clicked",
      pre,
    );
    refreshCompletionEvidenceFromSnapshot(host, "before_refresh");
    expect(
      ledger
        .toArray()
        .some(
          (event) =>
            event.type === "confirmation_state" &&
            event.detail.source === "saved_form_readback",
        ),
    ).toBe(false);
    snapshot = current;
    refreshCompletionEvidenceFromSnapshot(host, "after_refresh");
    const readbacks = () =>
      ledger
        .toArray()
        .filter(
          (event) =>
            event.type === "confirmation_state" &&
            event.detail.source === "saved_form_readback",
        );
    expect(readbacks()).toHaveLength(1);
    Object.assign(host, { turnCount: 4 });
    refreshCompletionEvidenceFromSnapshot(host, "next_turn");
    expect(readbacks()).toHaveLength(1);
    expect(readbacks()[0].observedAtTurn).toBe(3);
  });

  test("does not attribute a later page change to a failed or superseded click", () => {
    for (const superseded of [false, true]) {
      const { pre, current, value } = snapshots(
        "Project Beacon",
        "PRJ-42",
        "Save update",
        "Team only",
      );
      let snapshot = pre;
      const ledger = new CompletionEvidenceLedger();
      const host = {
        turnCount: 3,
        originalQuery: `Save a team-only update for Project Beacon: "${value}"`,
        completionEvidence: ledger,
        traceRecorder: null,
        context: { getSnapshot: () => snapshot },
        planSubtasks: [],
        planSteps: [],
      } as unknown as CompletionEvidenceHost;
      recordCompletionToolEvidence(
        host,
        "click_element" as never,
        { id: 3 },
        superseded ? "Clicked" : "Error: unavailable",
        pre,
      );
      if (superseded)
        recordCompletionToolEvidence(
          host,
          "click_element" as never,
          { id: 99 },
          "Clicked",
          pre,
        );
      snapshot = current;
      refreshCompletionEvidenceFromSnapshot(host, "later_page");
      expect(
        ledger
          .toArray()
          .some(
            (event) =>
              event.type === "confirmation_state" &&
              event.detail.source === "saved_form_readback",
          ),
      ).toBe(false);
    }
  });
});
