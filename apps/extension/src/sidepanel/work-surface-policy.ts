import type {
  ComposerPolicyV1,
  WorkCommandKind,
  WorkItemRecordV1,
} from "@shared-types/work-surface";

const policy = (
  values: Omit<ComposerPolicyV1, "schemaVersion">,
): ComposerPolicyV1 => ({ schemaVersion: 1, ...values });

const allows = (item: WorkItemRecordV1, command: WorkCommandKind) =>
  item.allowedCommands.includes(command);

const newTaskPolicy = () =>
  policy({
    mode: "new_task",
    enabled: true,
    label: "Start a task",
    placeholder: "What can I help with?",
    submitLabel: "Start",
    command: "start_task",
  });

export function deriveComposerPolicy(
  active: WorkItemRecordV1 | null,
): ComposerPolicyV1 {
  if (!active || active.phase === "terminal") return newTaskPolicy();

  if (active.kind === "recording") {
    return policy({
      mode: "hidden",
      enabled: false,
      label: "Task input is paused during recording",
      disabledReason: "Finish or cancel the recording to continue.",
    });
  }

  if (active.origin === "remote") {
    return policy({
      mode: "locked",
      enabled: false,
      label:
        active.phase === "queued"
          ? "Remote task is waiting"
          : "Remote task is supervised from Codex",
      disabledReason:
        active.phase === "queued"
          ? "The task will start when its workspace becomes available."
          : "Local messages are disabled to prevent conflicting instructions.",
    });
  }

  if (active.kind === "monitor") {
    return policy({
      mode: "monitor_instructions",
      enabled: allows(active, "update_monitor"),
      label: "Update watch instructions",
      placeholder: "Change what OpenSidebar should watch for…",
      submitLabel: "Update",
      command: "update_monitor",
      ...(!allows(active, "update_monitor")
        ? { disabledReason: "Watch instructions cannot be changed right now." }
        : {}),
    });
  }

  if (active.phase === "planning") {
    return policy({
      mode: "locked",
      enabled: false,
      label: "Preparing the plan",
      disabledReason:
        "Your draft is safe. Guidance becomes available when execution can consume it.",
    });
  }

  if (
    active.phase === "awaiting_plan" ||
    active.attention === "plan_confirmation"
  ) {
    return policy({
      mode: "plan_feedback",
      enabled: allows(active, "revise_plan"),
      label: "Request a plan change",
      placeholder: "What should change in the plan?",
      submitLabel: "Request changes",
      command: "revise_plan",
    });
  }

  if (active.attention === "clarification") {
    return policy({
      mode: "answer",
      enabled: allows(active, "answer"),
      label: "Answer the question",
      placeholder: "Type your answer…",
      submitLabel: "Answer and continue",
      command: "answer",
    });
  }

  if (active.attention !== "none" || active.phase === "awaiting_user") {
    return policy({
      mode: "locked",
      enabled: false,
      label: "A specific decision is required",
      disabledReason:
        "Use the task controls above so your response cannot be routed incorrectly.",
    });
  }

  if (
    active.phase === "paused" ||
    active.phase === "stalled" ||
    active.phase === "recoverable"
  ) {
    return policy({
      mode: "resume_guidance",
      enabled: allows(active, "resume"),
      label: "Resume with guidance",
      placeholder: "Optional correction or constraint…",
      submitLabel: "Resume safely",
      command: "resume",
    });
  }

  if (active.phase === "running" && allows(active, "guide")) {
    return policy({
      mode: "guidance",
      enabled: true,
      label: "Guide this task",
      placeholder: "Guide the agent...",
      submitLabel: "Guide",
      command: "guide",
    });
  }

  return policy({
    mode: "locked",
    enabled: false,
    label: "Task input is unavailable",
    disabledReason: "The current runtime state does not accept messages.",
  });
}
