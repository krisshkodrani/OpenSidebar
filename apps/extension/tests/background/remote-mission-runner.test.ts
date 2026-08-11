import { describe, expect, test, vi } from "vitest";
import type { AgentRunner } from "../../src/background/browser-bridge/handler";
import { adaptAgentRunner } from "../../src/background/remote-mission-runner";

const payload = {
  schemaVersion: 1 as const,
  missionId: "123e4567-e89b-42d3-a456-426614174001",
  instruction: "Summarize the current dashboard",
  initialUrl: "https://example.test/dashboard",
};

describe("RemoteMissionRunner", () => {
  test("maps a remote mission onto the existing session-aware agent runtime", async () => {
    const run = vi.fn().mockResolvedValue({
      status: "completed",
      summary: "Three alerts are active.",
    });
    const runner = adaptAgentRunner({ run } as AgentRunner);

    await expect(runner.run(payload)).resolves.toEqual({
      state: "succeeded",
      summary: "Three alerts are active.",
    });
    expect(run).toHaveBeenCalledWith(
      {
        instruction: payload.instruction,
        url: payload.initialUrl,
        session: payload.missionId,
      },
      undefined,
    );
  });

  test("preserves bounded approval evidence and resumes the same mission", async () => {
    const respondApproval = vi
      .fn()
      .mockResolvedValue({ status: "completed", summary: "Submitted." });
    const runner = adaptAgentRunner({
      run: vi.fn().mockResolvedValue({
        status: "needs_human",
        approval: {
          approvalId: "approval-1",
          toolName: "click_element",
          args: { id: 7 },
          context: "Submit this form?",
          requestedAt: Date.parse("2026-08-11T19:58:00.000Z"),
          timeoutMs: 120_000,
          expiresAt: Date.parse("2026-08-11T20:00:00.000Z"),
          dryRun: { kind: "clean", formKey: "form", diffHash: "abc", entries: [] },
        },
      }),
      respondApproval,
    } as AgentRunner);

    await expect(runner.run(payload)).resolves.toMatchObject({
      state: "approval_required",
      approval: { approvalId: "approval-1", actionDigest: "abc" },
    });
    await expect(
      runner.respondApproval!(payload.missionId, "approval-1", true),
    ).resolves.toEqual({ state: "succeeded", summary: "Submitted." });
    expect(respondApproval).toHaveBeenCalledWith(
      {
        tool: "browser_respond_approval",
        args: { approvalId: "approval-1", approved: true },
        session: payload.missionId,
      },
      undefined,
    );
  });

  test("does not claim uncertain human-blocked work failed", async () => {
    const runner = adaptAgentRunner({
      run: vi.fn().mockResolvedValue({
        status: "needs_human",
        reason: "The effect could not be verified.",
      }),
    });
    await expect(runner.run(payload)).resolves.toEqual({
      state: "outcome_unknown",
      summary: "The effect could not be verified.",
    });
  });
});
