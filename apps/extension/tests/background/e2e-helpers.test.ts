import { describe, expect, it, vi } from "vitest";
import { __testOnly as e2eUtilsTestOnly } from "../e2e/helpers/utils";
import { closeExtension } from "../e2e/helpers/browser";
import {
  collectFormTraceMetrics,
  extractDoneSummary,
  filterTraceFilesByWorkspace,
} from "../e2e/helpers/diagnostics";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("e2e helper semantics", () => {
  it("treats partial task completion as distinct from completed", () => {
    expect(
      e2eUtilsTestOnly.getLatestTaskCompletionState([
        { type: "TASK_COMPLETION", status: "partial" },
      ]),
    ).toBe("partial");

    expect(
      e2eUtilsTestOnly.getLatestTaskCompletionState([
        { type: "TASK_COMPLETION", status: "completed" },
      ]),
    ).toBe("completed");

    expect(e2eUtilsTestOnly.getLatestTaskCompletionState([])).toBe("none");
  });

  it("treats failed task completion as terminal", () => {
    const events = [
      { type: "TASK_COMPLETION", status: "failed", timestamp: 100 },
      { type: "AGENT_STATUS", status: "IDLE", timestamp: 120 },
    ];

    expect(e2eUtilsTestOnly.isTerminalTaskCompletionStatus("failed")).toBe(true);
    expect(e2eUtilsTestOnly.getLatestTaskCompletionState(events)).toBe("failed");
    expect(e2eUtilsTestOnly.hasIdleAfterTerminalCompletion(events)).toBe(true);
  });

  it("requires idle after terminal completion for turn handoff", () => {
    const idleBeforeCompletion = [
      { type: "AGENT_STATUS", status: "IDLE", timestamp: 100 },
      { type: "TASK_COMPLETION", status: "completed", timestamp: 200 },
    ];
    const idleAfterCompletion = [
      { type: "TASK_COMPLETION", status: "completed", timestamp: 200 },
      { type: "AGENT_STATUS", status: "IDLE", timestamp: 250 },
    ];

    expect(e2eUtilsTestOnly.hasIdleAfterTerminalCompletion(idleBeforeCompletion)).toBe(false);
    expect(e2eUtilsTestOnly.hasIdleAfterTerminalCompletion(idleAfterCompletion)).toBe(true);
  });

  it("filters trace files by workspace id", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-e2e-"));
    try {
      const match = join(dir, "match.jsonl");
      const miss = join(dir, "miss.jsonl");

      writeFileSync(
        match,
        `${JSON.stringify({ workspaceId: "ws-1", turnNumber: 1 })}\n`,
        "utf-8",
      );
      writeFileSync(
        miss,
        `${JSON.stringify({ workspaceId: "ws-2", turnNumber: 1 })}\n`,
        "utf-8",
      );

      expect(filterTraceFilesByWorkspace([match, miss], "ws-1")).toEqual([match]);
      expect(filterTraceFilesByWorkspace([match, miss], null)).toEqual([match, miss]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts the latest accepted done summary after a rejected done attempt", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-e2e-"));
    try {
      const trace = join(dir, "trace.jsonl");
      writeFileSync(
        trace,
        [
          JSON.stringify({
            recordedAt: "2026-04-30T07:43:02.000Z",
            llmResponse: {
              toolCalls: [
                {
                  function: {
                    name: "done",
                    arguments: JSON.stringify({
                      summary:
                        "The answer is 0, with supporting counts 0 and 4499.91.",
                    }),
                  },
                },
              ],
            },
            events: [{ type: "done_rejected_workflow_contract" }],
          }),
          JSON.stringify({
            recordedAt: "2026-04-30T07:43:03.000Z",
            llmResponse: {
              toolCalls: [
                {
                  function: {
                    name: "done",
                    arguments: JSON.stringify({ summary: "0" }),
                  },
                },
              ],
            },
            events: [],
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      expect(extractDoneSummary([trace])).toBe("0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collects form trace outcome and efficiency metrics", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-e2e-"));
    try {
      const trace = join(dir, "form.jsonl");
      writeFileSync(
        trace,
        [
          JSON.stringify({
            turnNumber: 1,
            llmRequest: {
              messages: [
                {
                  role: "user",
                  content:
                    "Page Interpretation\nStep 1. Full name, email, and phone fields are visible. Skill contract says post-submit success or validation state is possible.",
                },
              ],
            },
            llmResponse: {
              toolCalls: [
                { function: { name: "type_text", arguments: "{}" } },
                { function: { name: "type_text", arguments: "{}" } },
                { function: { name: "type_text", arguments: "{}" } },
              ],
            },
            progressState: { stagnantTurns: 0, signal: null },
          }),
          JSON.stringify({
            turnNumber: 2,
            llmRequest: {
              messages: [
                {
                  role: "user",
                  content:
                    "Page Interpretation\nPhone must include a country code. Invite code must match PN-4821 exactly. Access reason and Data processing agreement remain visible.",
                },
              ],
            },
            llmResponse: {
              toolCalls: [
                {
                  function: {
                    name: "click_element",
                    arguments: JSON.stringify({ label: "Submit registration" }),
                  },
                },
                { function: { name: "select_option", arguments: "{}" } },
                { function: { name: "set_checkbox", arguments: "{}" } },
              ],
            },
            elements: [
              { text: "Phone must include a country code." },
              { text: "Invite code must match PN-4821 exactly." },
            ],
            progressState: { stagnantTurns: 1, signal: "same_action" },
          }),
          JSON.stringify({
            turnNumber: 3,
            llmRequest: {
              messages: [
                {
                  role: "user",
                  content:
                    "Page Interpretation\nReview summary is visible. Request submitted confirmation appears.",
                },
              ],
            },
            llmResponse: {
              toolCalls: [
                {
                  function: {
                    name: "click_element",
                    arguments: JSON.stringify({ label: "Submit request" }),
                  },
                },
                {
                  function: {
                    name: "done",
                    arguments: JSON.stringify({ summary: "Submitted" }),
                  },
                },
              ],
            },
            progressState: { stagnantTurns: 0, signal: null },
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      const metrics = collectFormTraceMetrics([trace], {
        requiredFieldCount: 5,
        expectedStepTransitions: 2,
        conditionalFieldLabels: ["Access reason", "Data processing agreement"],
        validationErrorLabels: [
          "Phone must include a country code",
          "Invite code must match PN-4821",
        ],
        reviewText: "Review summary",
        confirmationText: "Request submitted",
      });

      expect(metrics).toMatchObject({
        turns: 3,
        perceptionReads: 3,
        fieldWriteCount: 5,
        stepTransitionCount: 2,
        validationErrorCount: 2,
        correctedFieldCount: 2,
        failedSubmitCount: 1,
        reworkStagnationCount: 1,
        finalSubmitConfidence: 1,
        recoverySuccess: true,
        outcome: {
          filledRequiredFields: true,
          handledConditionalFields: true,
          advancedAllSteps: true,
          verifiedReview: true,
          submitted: true,
          detectedConfirmation: true,
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not treat a visible submit button as a completed submit", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-e2e-"));
    try {
      const trace = join(dir, "form-open.jsonl");
      writeFileSync(
        trace,
        `${JSON.stringify({
          turnNumber: 1,
          llmRequest: {
            messages: [
              {
                role: "user",
                content:
                  "Page Interpretation\nA Submit request button is visible on the form.",
              },
            ],
          },
          llmResponse: {
            toolCalls: [{ function: { name: "read_page", arguments: "{}" } }],
          },
          toolExecutions: [
            {
              toolName: "read_page",
              result: "Page has a Submit request button.",
              success: true,
            },
          ],
          progressState: { stagnantTurns: 0, signal: null },
        })}\n`,
        "utf-8",
      );

      const metrics = collectFormTraceMetrics([trace]);

      expect(metrics.outcome.submitted).toBe(false);
      expect(metrics.finalSubmitConfidence).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bounds a stuck browser close and kills the browser process", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kill = vi.fn(() => true);
    const close = vi.fn(() => new Promise<void>(() => {}));
    const ctx = {
      browser: {
        close,
        process: () => ({ killed: false, kill }),
      },
    };

    try {
      await closeExtension(ctx as any, 5);
    } finally {
      warn.mockRestore();
    }

    expect(close).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith("SIGKILL");
  });
});
