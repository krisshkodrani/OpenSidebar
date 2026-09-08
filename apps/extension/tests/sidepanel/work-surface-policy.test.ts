import { describe, expect, test } from "vitest";
import type {
  WorkCommandKind,
  WorkItemRecordV1,
} from "@shared-types/work-surface";
import { deriveComposerPolicy } from "../../src/sidepanel/work-surface-policy";

function item(
  values: Partial<WorkItemRecordV1> & {
    allowedCommands?: WorkCommandKind[];
  } = {},
): WorkItemRecordV1 {
  return {
    schemaVersion: 1,
    workItemId: "work-1",
    workspaceId: "workspace-1",
    kind: "task",
    origin: "local",
    phase: "running",
    attention: "none",
    objective: "Check the page",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    revision: 1,
    allowedCommands: ["guide", "pause", "stop"],
    events: [],
    ...values,
  };
}

describe("work-surface composer policy", () => {
  test("starts a new task only when no controlling item is active", () => {
    expect(deriveComposerPolicy(null)).toMatchObject({
      mode: "new_task",
      enabled: true,
      command: "start_task",
    });
    expect(deriveComposerPolicy(item({ phase: "terminal" }))).toMatchObject({
      mode: "new_task",
      enabled: true,
    });
  });

  test("allows contextual guidance only when the runtime advertises it", () => {
    expect(deriveComposerPolicy(item())).toMatchObject({
      mode: "guidance",
      enabled: true,
      command: "guide",
    });
    expect(
      deriveComposerPolicy(item({ allowedCommands: ["stop"] })),
    ).toMatchObject({ mode: "locked", enabled: false });
  });

  test.each([
    ["planning", "none", "locked"],
    ["awaiting_plan", "plan_confirmation", "plan_feedback"],
    ["awaiting_user", "clarification", "answer"],
    ["awaiting_user", "approval", "locked"],
    ["paused", "none", "resume_guidance"],
    ["stalled", "none", "resume_guidance"],
    ["recoverable", "none", "resume_guidance"],
  ] as const)(
    "maps %s/%s to %s",
    (phase, attention, expectedMode) => {
      const allowedCommands: WorkCommandKind[] = [
        "revise_plan",
        "answer",
        "resume",
      ];
      expect(
        deriveComposerPolicy(item({ phase, attention, allowedCommands })).mode,
      ).toBe(expectedMode);
    },
  );

  test("locks all generic input for remote work", () => {
    for (const phase of ["queued", "running", "awaiting_user"] as const) {
      expect(
        deriveComposerPolicy(
          item({
            origin: "remote",
            phase,
            allowedCommands: ["guide", "cancel_remote"],
          }),
        ),
      ).toMatchObject({ mode: "locked", enabled: false });
    }
  });

  test("uses dedicated monitor input and hides input while recording", () => {
    expect(
      deriveComposerPolicy(
        item({ kind: "monitor", allowedCommands: ["update_monitor"] }),
      ),
    ).toMatchObject({
      mode: "monitor_instructions",
      command: "update_monitor",
    });
    expect(
      deriveComposerPolicy(item({ kind: "recording" })),
    ).toMatchObject({ mode: "hidden", enabled: false });
  });
});
