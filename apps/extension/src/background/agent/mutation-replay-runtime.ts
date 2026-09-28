import { type DomSnapshot, ToolName } from "../../types";
import type { ContextManager } from "./context";
import type { CheckpointCoordinator } from "./checkpoint-coordinator";
import { isListDetailReturnControlRepeatExempt } from "./list-detail-policy";
import { isPaginationNavigationClick } from "./action-exemption-policy";
import { assessRepeatedAddItemClick } from "./repeated-add-item-policy";
import { lookupMutationReplay } from "./loop-queries";

export interface MutationReplayHost {
  readonly selectedSkillId: string | null;
  readonly context: Pick<ContextManager, "getSnapshot" | "addMessage">;
  readonly originalQuery: string;
  readonly turnCount: number;
  readonly checkpoints: Pick<
    CheckpointCoordinator,
    "lookupReplay" | "recordMutation"
  >;
  readonly guardAfterDoneRejection: boolean;
  readonly lastPlanIndex: number;
  logWarn(
    component: "agent",
    message: string,
    data: Record<string, unknown>,
  ): void;
  logInfo(
    component: "agent",
    message: string,
    data: Record<string, unknown>,
  ): void;
  recordVerifiedProgress(turn: number, source: "mutation"): void;
}

/** Guard repeated mutations and persist verified actions for later replay. */
export class MutationReplayRuntime {
  constructor(private readonly host: MutationReplayHost) {}

  replayMutationSensitiveAction(
    toolCallId: string,
    toolName: ToolName,
    args: Record<string, unknown>,
  ): boolean {
    if (
      isListDetailReturnControlRepeatExempt({
        selectedSkillId: this.host.selectedSkillId,
        toolName,
        args,
        snapshot: this.host.context.getSnapshot(),
      })
    ) {
      return false;
    }
    if (
      isPaginationNavigationClick({
        selectedSkillId: this.host.selectedSkillId,
        toolName,
        args,
        snapshot: this.host.context.getSnapshot(),
      })
    ) {
      return false;
    }

    const repeatedAddItemBlock = assessRepeatedAddItemClick({
      toolName,
      args,
      snapshot: this.host.context.getSnapshot(),
      userRequest: this.host.originalQuery,
    });
    if (repeatedAddItemBlock) {
      this.host.logWarn(
        "agent",
        "Idempotency guard: blocked repeated add-item click",
        {
          turn: this.host.turnCount,
          tool: toolName,
          args: JSON.stringify(args).slice(0, 100),
        },
      );
      this.host.context.addMessage({
        role: "tool",
        tool_call_id: toolCallId,
        content: repeatedAddItemBlock,
      });
      return true;
    }

    const replay = lookupMutationReplay(this.host, toolName, args);
    if (!replay) return false;

    this.host.logInfo("agent", "Idempotency guard: returning cached result", {
      turn: this.host.turnCount,
      tool: toolName,
      source: replay.source,
      args: JSON.stringify(args).slice(0, 100),
    });
    this.host.context.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content:
        replay.result +
        "\n[Note: This action was already executed earlier in this step. " +
        "The result above is from the previous execution. The page state already reflects this action — do NOT repeat it.]",
    });
    return true;
  }

  recordMutationSensitiveAction(
    toolName: ToolName,
    args: Record<string, unknown>,
    result: string,
    actionSnapshot?: DomSnapshot | null,
  ): void {
    this.host.checkpoints.recordMutation({
      toolName,
      args,
      result,
      actionSnapshot,
      currentSnapshot: this.host.context.getSnapshot?.() ?? null,
      planIndex: this.host.lastPlanIndex,
      turn: this.host.turnCount,
    });
    if (!/^\s*(error|failed)\b/i.test(result)) {
      this.host.recordVerifiedProgress(this.host.turnCount, "mutation");
    }
  }
}
