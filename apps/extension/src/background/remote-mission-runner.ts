import type {
  RemoteMissionPayloadV1,
  RemoteMissionRunResultV1,
  RemoteMissionTargetDecisionV1,
} from "@shared-types/remote-missions";
import type {
  AgentRunOptions,
  AgentRunOutcome,
  AgentRunner,
} from "./browser-bridge/handler";
import { createDefaultBrowserAgentRunner } from "./browser-bridge/orchestrator-driver";

export interface RemoteMissionRunner {
  run(
    payload: RemoteMissionPayloadV1,
    options?: {
      signal?: AbortSignal;
      onTargetBound?: AgentRunOptions["onTargetBound"];
      onProgress?: AgentRunOptions["onProgress"];
    },
  ): Promise<RemoteMissionRunResultV1>;
  respondApproval?(
    missionId: string,
    approvalId: string,
    approved: boolean,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteMissionRunResultV1>;
  selectTarget?(
    payload: RemoteMissionPayloadV1,
    decision: RemoteMissionTargetDecisionV1,
    options?: { signal?: AbortSignal },
  ): Promise<RemoteMissionRunResultV1>;
}

const result = (outcome: AgentRunOutcome): RemoteMissionRunResultV1 => {
  const target = outcome.target ? { target: outcome.target } : {};
  if (outcome.status === "completed")
    return { state: "succeeded", ...(outcome.summary ? { summary: outcome.summary } : {}), ...target };
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
      ...target,
    };
  if (outcome.status === "needs_human" && outcome.targetSelection)
    return {
      state: "target_selection_required",
      targetSelection: outcome.targetSelection,
    };
  return {
    state: outcome.status === "error" ? "failed" : "outcome_unknown",
    ...(outcome.summary || outcome.reason
      ? { summary: outcome.summary ?? outcome.reason }
      : {}),
    ...target,
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
            executionToolProfile: payload.executionClass,
            targetContext: payload.targetContext ?? "isolated_tab",
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
    ...(runner.selectTarget
      ? {
          async selectTarget(
            payload: RemoteMissionPayloadV1,
            decision: RemoteMissionTargetDecisionV1,
            options?: { signal?: AbortSignal },
          ) {
            return result(await runner.selectTarget!({
              instruction: payload.instruction,
              ...(payload.initialUrl ? { url: payload.initialUrl } : {}),
              session: payload.missionId,
              executionToolProfile: payload.executionClass,
              targetContext: payload.targetContext ?? "isolated_tab",
              targetHandle: decision.targetHandle,
            }, options));
          },
        }
      : {}),
  };
}

export const createDefaultRemoteMissionRunner = () =>
  adaptAgentRunner(createDefaultBrowserAgentRunner());
