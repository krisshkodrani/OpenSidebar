import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import {
  type SyntheticSignalV1,
  type SyntheticWorkflowInputV1,
  type SyntheticWorkflowSnapshotV1,
  validateSyntheticWorkflowInput,
  validateShadowEvent,
  type ShadowEventV1,
} from "./contracts";

const eventSignal = defineSignal<[SyntheticSignalV1]>("synthetic_event");
const stateQuery = defineQuery<SyntheticWorkflowSnapshotV1>("state");
const activity = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 3 },
});

export async function syntheticSessionWorkflow(
  input: SyntheticWorkflowInputV1,
): Promise<SyntheticWorkflowSnapshotV1> {
  validateSyntheticWorkflowInput(input);
  const signals: SyntheticSignalV1[] = [];
  let snapshot: SyntheticWorkflowSnapshotV1 = {
    schemaVersion: 1,
    sessionId: input.sessionId,
    revision: input.revision,
    leaseGeneration: input.leaseGeneration,
    iteration: input.iteration,
    state: "waiting_device",
  };
  setHandler(stateQuery, () => snapshot);
  setHandler(eventSignal, (value) => {
    signals.push(value);
  });
  const takeSignal = async (...types: SyntheticSignalV1["type"][]) => {
    await condition(() => signals.some((item) => types.includes(item.type)));
    const index = signals.findIndex((item) => types.includes(item.type));
    return signals.splice(index, 1)[0];
  };
  const takeMatchingSignal = async (
    predicate: (item: SyntheticSignalV1) => boolean,
  ) => {
    await condition(() => signals.some(predicate));
    const index = signals.findIndex(predicate);
    return signals.splice(index, 1)[0];
  };

  if (input.fixture === "account_delete") {
    await takeSignal("account_delete");
    await activity.deleteSyntheticSession({
      sessionId: input.sessionId,
      revision: input.revision,
      operationId: `delete:${input.sessionId}`,
    });
    return { ...snapshot, state: "deleted", errorCode: "deleted" };
  }

  if (input.fixture === "stuck_operation") {
    snapshot = { ...snapshot, state: "checkpointing" };
    await activity.waitForOperatorRecovery({
      sessionId: input.sessionId,
      revision: input.revision,
      operationId: `stuck:${input.sessionId}`,
    });
    return { ...snapshot, state: "completed" };
  }

  const connectionSignal = await takeSignal("device_connected", "takeover");
  if (connectionSignal?.type === "takeover")
    snapshot = {
      ...snapshot,
      leaseGeneration: connectionSignal.leaseGeneration,
    };
  const commandId = input.commandId;
  snapshot = { ...snapshot, state: "command_issued", commandId };
  const acknowledgement = await takeMatchingSignal(
    (item) =>
      item.type === "cancel" ||
      item.type === "account_delete" ||
      (item.type === "command_acknowledged" &&
        item.commandId === commandId &&
        item.leaseGeneration === snapshot.leaseGeneration),
  );
  if (acknowledgement.type === "cancel")
    return { ...snapshot, state: "cancelled", errorCode: "cancelled" };
  if (acknowledgement.type === "account_delete") {
    await activity.deleteSyntheticSession({
      sessionId: input.sessionId,
      revision: snapshot.revision,
      operationId: `delete:${input.sessionId}`,
    });
    return { ...snapshot, state: "deleted", errorCode: "deleted" };
  }
  snapshot = { ...snapshot, state: "waiting_result" };

  if (input.fixture === "approval_timeout") {
    snapshot = { ...snapshot, state: "waiting_approval" };
    await Promise.race([
      condition(() =>
        signals.some((item) => item.type === "approval_received"),
      ),
      sleep(Math.max(1, input.deadlineEpochMs - Date.now())),
    ]);
    const approvalIndex = signals.findIndex(
      (item) => item.type === "approval_received",
    );
    const approvalSignal =
      approvalIndex >= 0 ? signals.splice(approvalIndex, 1)[0] : undefined;
    if (
      approvalSignal?.type !== "approval_received" ||
      !approvalSignal.approved
    )
      return {
        ...snapshot,
        state: "cancelled",
        errorCode: "approval_timeout",
      };
  } else {
    await takeMatchingSignal(
      (item) =>
        item.type === "command_result" &&
        item.commandId === commandId &&
        item.leaseGeneration === snapshot.leaseGeneration,
    );
  }

  snapshot = { ...snapshot, state: "checkpointing" };
  const committed = await activity.commitSyntheticCheckpoint({
    sessionId: input.sessionId,
    revision: snapshot.revision,
    operationId: `checkpoint:${input.sessionId}:${input.iteration}`,
    fault:
      input.fixture === "lost_commit_response"
        ? "lose_first_response"
        : undefined,
  });
  snapshot = { ...snapshot, revision: committed.committedRevision };
  if (input.fixture === "continue_as_new" && input.iteration < 2)
    return continueAsNew<typeof syntheticSessionWorkflow>({
      ...input,
      revision: snapshot.revision,
      iteration: input.iteration + 1,
    });
  return { ...snapshot, state: "completed" };
}

export { eventSignal, stateQuery };

export const shadowEventSignal = defineSignal<[ShadowEventV1]>("shadow_event");
export const shadowStateQuery = defineQuery<{
  revision: number;
  eventCount: number;
}>("shadow_state");

export async function shadowSessionWorkflow(
  initial: ShadowEventV1,
): Promise<void> {
  validateShadowEvent(initial);
  let revision = initial.revision;
  let eventCount = 1;
  const seen = new Set([initial.eventId]);
  setHandler(shadowStateQuery, () => ({ revision, eventCount }));
  setHandler(shadowEventSignal, (event) => {
    validateShadowEvent(event);
    if (event.sessionId !== initial.sessionId || seen.has(event.eventId))
      return;
    seen.add(event.eventId);
    revision = Math.max(revision, event.revision);
    eventCount += 1;
  });
  await condition(() => eventCount >= 500);
  return continueAsNew<typeof shadowSessionWorkflow>({
    ...initial,
    eventId: [...seen].at(-1)!,
    revision,
  });
}
