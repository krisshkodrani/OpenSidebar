/**
 * Fill-checklist policy (LP-17 Phase 1).
 *
 * Live traces showed ~24% of a long form-fill run spent re-reading fields that
 * were already confirmed filled. These tests prove the truthful-feedback
 * mechanics: the "Form status" line, the re-read note appended to read_element
 * results, and the ledger rules — while never blocking a read.
 */
import { describe, expect, test } from "vitest";
import "../setup";
import { ToolName, type DomSnapshot, type TaggedElement } from "../../src/types";
import {
  applyFieldReReadTracking,
  assessFieldReReadNudge,
  computeFillChecklistStatus,
  type FieldReadLedger,
} from "../../src/background/agent/fill-checklist-policy";
import { djb2 } from "../../src/background/agent/loop-helpers";

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
    attributes: { id: key, name: key, type, value, label },
    rect: { x: 0, y: tag * 20, width: 180, height: 24 },
    isVisible: true,
    isDisabled: false,
  };
}

function checkboxField(
  tag: number,
  label: string,
  checked: boolean,
): TaggedElement {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    tag,
    tagName: "input",
    role: "checkbox",
    text: "",
    attributes: {
      id: key,
      control: key,
      name: key,
      type: "checkbox",
      checked: String(checked),
      label,
    },
    rect: { x: 0, y: tag * 20, width: 16, height: 16 },
    isVisible: true,
    isDisabled: false,
  };
}

function buttonElement(tag: number, label: string): TaggedElement {
  return {
    tag,
    tagName: "button",
    role: "button",
    text: label,
    attributes: { label },
    rect: { x: 0, y: tag * 20, width: 140, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

function snapshotWith(elements: TaggedElement[]): DomSnapshot {
  return {
    title: "Application",
    url: "https://example.test/apply",
    visibleContent: "Application form",
    pageContent: "Application form",
    elements,
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
  };
}

const nineFieldForm = () =>
  snapshotWith([
    textField(1, "First name", "Kris"),
    textField(2, "Last name", "Shkodrani"),
    textField(3, "Email", "kris@example.test"),
    textField(4, "Phone"),
    textField(5, "City", "Vienna"),
    textField(6, "Country", "Austria"),
    textField(7, "LinkedIn", "linkedin.com/in/kris"),
    textField(8, "Website", "example.test"),
    textField(9, "Cover note"),
  ]);

describe("computeFillChecklistStatus", () => {
  test("reports filled/empty counts and labels for a form page", () => {
    const status = computeFillChecklistStatus(nineFieldForm());
    expect(status.totalFields).toBe(9);
    expect(status.filledCount).toBe(7);
    expect(status.line).toContain("7/9 fields hold confirmed values");
    expect(status.line).toContain("do not re-read or re-type them");
    expect(status.line).toContain("Still empty: Phone, Cover note");
  });

  test("stays silent on pages with fewer than 3 fields", () => {
    const status = computeFillChecklistStatus(
      snapshotWith([
        textField(1, "Search", "query"),
        buttonElement(2, "Go"),
      ]),
    );
    expect(status.line).toBeNull();
  });

  test("stays silent when nothing is filled yet", () => {
    const status = computeFillChecklistStatus(
      snapshotWith([
        textField(1, "First name"),
        textField(2, "Last name"),
        textField(3, "Email"),
      ]),
    );
    expect(status.filledCount).toBe(0);
    expect(status.line).toBeNull();
  });

  test("an unchecked checkbox does not count as filled; a checked one does", () => {
    const unchecked = computeFillChecklistStatus(
      snapshotWith([
        textField(1, "Name", "A"),
        textField(2, "Email", "a@b.c"),
        checkboxField(3, "Terms", false),
      ]),
    );
    expect(unchecked.filledCount).toBe(2);
    const checked = computeFillChecklistStatus(
      snapshotWith([
        textField(1, "Name", "A"),
        textField(2, "Email", "a@b.c"),
        checkboxField(3, "Terms", true),
      ]),
    );
    expect(checked.filledCount).toBe(3);
    expect(checked.line).toContain("No tracked fields remain empty");
  });

  test("signature changes only when the filled set changes", () => {
    const a = computeFillChecklistStatus(nineFieldForm());
    const b = computeFillChecklistStatus(nineFieldForm());
    expect(a.signature).toBe(b.signature);
    const snapshot = nineFieldForm();
    snapshot.elements[3] = textField(4, "Phone", "+43 123");
    const c = computeFillChecklistStatus(snapshot);
    expect(c.signature).not.toBe(a.signature);
  });

  test("caps the label enumeration", () => {
    const many = snapshotWith(
      Array.from({ length: 12 }, (_, i) =>
        textField(i + 1, `Field number ${i + 1}`, `v${i}`),
      ),
    );
    const status = computeFillChecklistStatus(many);
    expect(status.line).toContain("+4 more");
  });
});

describe("assessFieldReReadNudge", () => {
  test("notes an unchanged re-read of a ledgered field", () => {
    const snapshot = nineFieldForm();
    const ledger: FieldReadLedger = new Map([
      ["email", { turn: 4, valueHash: djb2("kris@example.test") }],
    ]);
    const { note } = assessFieldReReadNudge({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 3 },
      snapshot,
      ledger,
    });
    expect(note).toContain('already read "Email" on turn 4');
    expect(note).toContain("7/9 fields hold confirmed values");
    expect(note).toContain("act on the remaining fields or call done()");
  });

  test("no note when the value changed since the last read", () => {
    const snapshot = nineFieldForm();
    const ledger: FieldReadLedger = new Map([
      ["email", { turn: 4, valueHash: djb2("old@example.test") }],
    ]);
    const { note, recordedKey } = assessFieldReReadNudge({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 3 },
      snapshot,
      ledger,
    });
    expect(note).toBeNull();
    expect(recordedKey).toBe("email");
  });

  test("no note on the first read; the key is still returned for recording", () => {
    const { note, recordedKey } = assessFieldReReadNudge({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 1 },
      snapshot: nineFieldForm(),
      ledger: new Map(),
    });
    expect(note).toBeNull();
    expect(recordedKey).toBe("first-name");
  });

  test("no note for an empty field even when ledgered", () => {
    const snapshot = nineFieldForm();
    const ledger: FieldReadLedger = new Map([
      ["phone", { turn: 2, valueHash: djb2("") }],
    ]);
    const { note } = assessFieldReReadNudge({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 4 },
      snapshot,
      ledger,
    });
    expect(note).toBeNull();
  });

  test("ignores non-read tools and non-form targets", () => {
    const snapshot = snapshotWith([
      buttonElement(99, "Submit"),
      ...nineFieldForm().elements,
    ]);
    expect(
      assessFieldReReadNudge({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 3 },
        snapshot,
        ledger: new Map(),
      }).recordedKey,
    ).toBeNull();
    expect(
      assessFieldReReadNudge({
        toolName: ToolName.READ_ELEMENT,
        args: { id: 99 }, // the button
        snapshot,
        ledger: new Map(),
      }).recordedKey,
    ).toBeNull();
  });
});

describe("applyFieldReReadTracking", () => {
  test("records the first read, then annotates the second — never replaces the result", () => {
    const snapshot = nineFieldForm();
    const ledger: FieldReadLedger = new Map();

    const first = applyFieldReReadTracking({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 3 },
      result: '[3] <input> "Email" value="kris@example.test"',
      snapshot,
      ledger,
      turn: 5,
    });
    expect(first).toBe('[3] <input> "Email" value="kris@example.test"');
    expect(ledger.get("email")?.turn).toBe(5);

    const second = applyFieldReReadTracking({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 3 },
      result: '[3] <input> "Email" value="kris@example.test"',
      snapshot,
      ledger,
      turn: 9,
    });
    expect(second).toContain('[3] <input> "Email" value="kris@example.test"');
    expect(second).toContain('[note] You already read "Email" on turn 5');
    // Original read turn preserved while the value is unchanged.
    expect(ledger.get("email")?.turn).toBe(5);
  });

  test("re-stamps the ledger when the value changed (and stays silent)", () => {
    const ledger: FieldReadLedger = new Map([
      ["email", { turn: 2, valueHash: djb2("old@example.test") }],
    ]);
    const result = applyFieldReReadTracking({
      toolName: ToolName.READ_ELEMENT,
      args: { id: 3 },
      result: "fresh read",
      snapshot: nineFieldForm(),
      ledger,
      turn: 8,
    });
    expect(result).toBe("fresh read");
    expect(ledger.get("email")).toEqual({
      turn: 8,
      valueHash: djb2("kris@example.test"),
    });
  });
});
