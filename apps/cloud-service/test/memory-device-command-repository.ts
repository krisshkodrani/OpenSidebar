import {
  canTransitionBrowserCommand,
  type DeviceCommandRecordV1,
} from "@opensidebar/shared-types";
import type {
  CommandMutation,
  DeviceCommandRepository,
} from "../src/device-command-repository.js";

type OwnedCommand = DeviceCommandRecordV1 & {
  accountId: string;
  deviceId: string;
};

export class MemoryDeviceCommandRepository implements DeviceCommandRepository {
  values = new Map<string, OwnedCommand>();
  idempotency = new Map<string, string>();

  async commandByIdempotency(
    accountId: string,
    sessionId: string,
    idempotencyHash: string,
  ) {
    const id = this.idempotency.get(
      `${accountId}:${sessionId}:${idempotencyHash}`,
    );
    return id ? (this.values.get(id) ?? null) : null;
  }

  async createCommand(
    input: Parameters<DeviceCommandRepository["createCommand"]>[0],
  ): Promise<CommandMutation> {
    const prior = this.values.get(input.commandId);
    if (prior) return { kind: "replayed", value: prior };
    const now = new Date().toISOString();
    const value: OwnedCommand = {
      schemaVersion: 1,
      accountId: input.accountId,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      commandId: input.commandId,
      sequence:
        [...this.values.values()].filter(
          (item) => item.sessionId === input.sessionId,
        ).length + 1,
      leaseId: input.leaseId,
      leaseGeneration: input.leaseGeneration,
      checkpointRevision: input.checkpointRevision,
      commandKind: input.commandKind,
      risk: input.risk,
      actionDigest: input.actionDigest,
      state: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt.toISOString(),
    };
    this.values.set(input.commandId, value);
    this.idempotency.set(
      `${input.accountId}:${input.sessionId}:${input.idempotencyHash}`,
      input.commandId,
    );
    return { kind: "created", value };
  }

  async commands(input: Parameters<DeviceCommandRepository["commands"]>[0]) {
    return [...this.values.values()]
      .filter(
        (value) =>
          value.accountId === input.accountId &&
          value.deviceId === input.deviceId &&
          value.sessionId === input.sessionId &&
          value.leaseId === input.leaseId &&
          value.leaseGeneration === input.leaseGeneration &&
          value.sequence > input.afterSequence,
      )
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, input.limit);
  }

  async transitionCommand(
    input: Parameters<DeviceCommandRepository["transitionCommand"]>[0],
  ): Promise<CommandMutation> {
    const current = this.values.get(input.commandId);
    if (
      !current ||
      current.accountId !== input.accountId ||
      current.deviceId !== input.deviceId ||
      current.sessionId !== input.sessionId
    )
      return { kind: "not_found" };
    if (!canTransitionBrowserCommand(current.state, input.to)) {
      if (current.state === input.to)
        return { kind: "replayed", value: current };
      return { kind: "invalid_transition" };
    }
    const value: OwnedCommand = {
      ...current,
      state: input.to,
      ...(input.outcomeCode ? { outcomeCode: input.outcomeCode } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.values.set(input.commandId, value);
    return { kind: "updated", value };
  }
}
