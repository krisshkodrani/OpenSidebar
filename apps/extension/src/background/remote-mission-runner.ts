import type {
  RemoteMissionPayloadV1,
  RemoteMissionRunResultV1,
} from "@shared-types/remote-missions";
import type {
  AgentRunOutcome,
  AgentRunner,
} from "./browser-bridge/handler";
import { createDefaultBrowserAgentRunner } from "./browser-bridge/orchestrator-driver";

export interface RemoteMissionRunner {
  run(
    payload: RemoteMissionPayloadV1,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteMissionRunResultV1>;
  respondApproval?(
    missionId: string,
    approvalId: string,
    approved: boolean,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteMissionRunResultV1>;
}

const result = (outcome: AgentRunOutcome): RemoteMissionRunResultV1 => {
  if (outcome.status === "completed")
    return { state: "succeeded", ...(outcome.summary ? { summary: outcome.summary } : {}) };
  if (outcome.status === "needs_human" && outcome.approval)
    return {
      state: "approval_required",
      ...(outcome.summary ? { summary: outcome.summary } : {}),
      approval: {
        approvalId: outcome.approval.approvalId,
        question: outcome.approval.context,
        expiresAt: new Date(outcome.approval.expiresAt).toISOString(),
        ...(outcome.approval.dryRun?.diffHash
          ? { actionDigest: outcome.approval.dryRun.diffHash }
          : {}),
      },
    };
  return {
    state: outcome.status === "error" ? "failed" : "outcome_unknown",
    ...(outcome.summary || outcome.reason
      ? { summary: outcome.summary ?? outcome.reason }
      : {}),
  };
};

export function adaptAgentRunner(runner: AgentRunner): RemoteMissionRunner {
  return {
    async run(payload, options) {
      return result(
        await runner.run(
          {
            instruction: payload.instruction,
            ...(payload.initialUrl ? { url: payload.initialUrl } : {}),
            session: payload.missionId,
          },
          options,
        ),
      );
    },
    ...(runner.respondApproval
      ? {
          async respondApproval(
            missionId: string,
            approvalId: string,
            approved: boolean,
            options?: { signal?: AbortSignal },
          ) {
            return result(
              await runner.respondApproval!(
                {
                  tool: "browser_respond_approval",
                  args: { approvalId, approved },
                  session: missionId,
                },
                options,
              ),
            );
          },
        }
      : {}),
  };
}

export const createDefaultRemoteMissionRunner = () =>
  adaptAgentRunner(createDefaultBrowserAgentRunner());
