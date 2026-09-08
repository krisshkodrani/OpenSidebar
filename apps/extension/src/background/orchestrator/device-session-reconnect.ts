import {
  canonicalBrowserCommandApprovalPayload,
  type BrowserCommandV1,
  type DeliveredBrowserCommandV1,
  type DeviceCommandOutcomeCode,
  type SessionLeaseV1,
} from "@shared-types";
import type { CloudDeviceCoordinationPort } from "../environment/cloud-device-coordination-port";
import type { CloudSessionTransportPort } from "../environment/cloud-session-transport-port";
import type { PersistenceStorageArea } from "../environment/types";
import { createVersionedStore } from "../environment/versioned-store";
import { DeviceAttemptJournal } from "./device-attempt-journal";

export type ObservedCommandOutcome =
  | "succeeded"
  | "failed"
  | "outcome_unknown";

export interface DeviceCommandExecutionPort {
  validateAndGround(
    command: BrowserCommandV1,
    actionDigest: string,
  ): Promise<boolean | "approval_required">;
  dispatch(command: BrowserCommandV1): Promise<ObservedCommandOutcome>;
  observe(command: BrowserCommandV1): Promise<ObservedCommandOutcome | null>;
}

export type CommandReconcileResult =
  | { kind: "processed" }
  | { kind: "deferred" }
  | {
      kind: "approval_required";
      command: BrowserCommandV1;
      actionDigest: string;
    };

export type ReconnectResult =
  | { kind: "disabled" }
  | { kind: "read_only"; connectionId: string }
  | {
      kind: "needs_takeover";
      connectionId: string;
      currentLease: SessionLeaseV1;
    }
  | {
      kind: "restore_required";
      connectionId: string;
      currentLease: SessionLeaseV1;
    }
  | {
      kind: "approval_required";
      connectionId: string;
      lease: SessionLeaseV1;
      command: BrowserCommandV1;
      actionDigest: string;
      lastSequence: number;
      processedCommands: number;
    }
  | {
      kind: "connected";
      connectionId: string;
      lease: SessionLeaseV1;
      lastSequence: number;
      processedCommands: number;
    };

export type TakeoverResult =
  | { kind: "confirmation_required" }
  | { kind: "disabled" }
  | {
      kind: "paused_for_restore";
      connectionId: string;
      lease: SessionLeaseV1;
      requiresFreshApproval: true;
    };

type TakeoverGateState = {
  sessionId: string;
  expectedGeneration: number;
  takeoverGeneration?: number;
  armedAt: number;
};

export class DeviceTakeoverGate {
  private readonly store;
  constructor(area: PersistenceStorageArea, sessionId: string) {
    this.store = createVersionedStore<TakeoverGateState | null>(
      area,
      `opensidebar:device-takeover-gate:v1:${sessionId}`,
      { version: 1 },
    );
  }

  async arm(sessionId: string, expectedGeneration: number): Promise<void> {
    await this.store.save({
      sessionId,
      expectedGeneration,
      armedAt: Date.now(),
    });
  }

  async recordTakeoverGeneration(generation: number): Promise<void> {
    await this.store.update((current) =>
      current ? { ...current, takeoverGeneration: generation } : null,
    );
  }

  async isArmed(sessionId: string): Promise<boolean> {
    return (await this.store.load())?.sessionId === sessionId;
  }

  async clear(sessionId: string, generation: number): Promise<boolean> {
    let cleared = false;
    await this.store.update((current) => {
      if (
        current?.sessionId !== sessionId ||
        current.takeoverGeneration !== generation
      )
        return current ?? null;
      cleared = true;
      return null;
    });
    return cleared;
  }
}

const outcomeCode = (
  outcome: ObservedCommandOutcome,
): DeviceCommandOutcomeCode =>
  outcome === "succeeded"
    ? "verified"
    : outcome === "failed"
      ? "not_achieved"
      : "unknown_after_interruption";

const journalState = (outcome: ObservedCommandOutcome) =>
  outcome === "succeeded"
    ? ("observed_succeeded" as const)
    : outcome === "failed"
      ? ("observed_failed" as const)
      : ("unknown" as const);

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function browserCommandActionDigest(
  command: BrowserCommandV1,
): Promise<string> {
  return sha256(
    canonicalBrowserCommandApprovalPayload({
      action: command.action,
      preconditions: command.preconditions,
      risk: command.risk,
      checkpointRevision: command.checkpointRevision,
    }),
  );
}

export class DeviceCommandReconciler {
  constructor(
    private readonly transport: CloudSessionTransportPort,
    private readonly journal: DeviceAttemptJournal,
    private readonly execution: DeviceCommandExecutionPort,
  ) {}

  async reconcile(
    delivered: DeliveredBrowserCommandV1,
    lease: SessionLeaseV1,
  ): Promise<CommandReconcileResult> {
    const { command, record } = delivered;
    const digest = await browserCommandActionDigest(command);
    const now = Date.now();
    const createdAt = new Date(command.createdAt).getTime();
    const expiresAt = new Date(command.expiresAt).getTime();
    const approvedAt = command.approval
      ? new Date(command.approval.approvedAt).getTime()
      : Number.NaN;
    const approvalExpiresAt = command.approval
      ? new Date(command.approval.expiresAt).getTime()
      : Number.NaN;
    if (
      command.schemaVersion !== 1 ||
      record.schemaVersion !== 1 ||
      record.commandId !== command.commandId ||
      record.sessionId !== command.sessionId ||
      record.leaseId !== command.leaseId ||
      record.leaseGeneration !== command.leaseGeneration ||
      record.checkpointRevision !== command.checkpointRevision ||
      record.commandKind !== command.action.kind ||
      record.risk !== command.risk ||
      command.sessionId !== lease.sessionId ||
      command.leaseId !== lease.leaseId ||
      command.leaseGeneration !== lease.generation ||
      command.checkpointRevision !== lease.checkpointRevision ||
      record.actionDigest !== digest ||
      !Number.isFinite(createdAt) ||
      !Number.isFinite(expiresAt) ||
      createdAt > now ||
      expiresAt <= now ||
      expiresAt <= createdAt
    )
      return { kind: "deferred" };
    if (
      command.risk === "sensitive_write" &&
      (!command.approval ||
        !command.approval.approvalId ||
        command.approval.actionDigest !== digest ||
        !Number.isFinite(approvedAt) ||
        !Number.isFinite(approvalExpiresAt) ||
        approvedAt > now ||
        approvalExpiresAt <= now)
    )
      return { kind: "deferred" };

    const reconciliation = await this.journal.reconcile(command, digest);
    if (reconciliation === "conflict") return { kind: "deferred" };
    if (reconciliation === "replay_terminal") {
      const prior = await this.journal.record(command.commandId);
      if (!prior) return { kind: "deferred" };
      const code =
        prior.state === "observed_succeeded"
          ? "verified"
          : prior.state === "observed_failed"
            ? "not_achieved"
            : "unknown_after_interruption";
      await this.transport.result(leaseProof(lease), command.commandId, code);
      return { kind: "processed" };
    }
    if (reconciliation === "observe_only") {
      const observed =
        (await this.execution.observe(command)) ?? "outcome_unknown";
      await this.complete(command.commandId, lease, observed);
      return { kind: "processed" };
    }

    const validation = await this.execution.validateAndGround(command, digest);
    if (validation === "approval_required")
      return {
        kind: "approval_required",
        command,
        actionDigest: digest,
      };
    if (!validation) return { kind: "deferred" };
    if (reconciliation === "accept_new")
      await this.journal.accepted(command, crypto.randomUUID(), digest);
    await this.transport.transition(
      leaseProof(lease),
      command.commandId,
      "accept",
    );
    await this.journal.started(command.commandId);
    await this.transport.transition(
      leaseProof(lease),
      command.commandId,
      "start",
    );
    const outcome = await this.execution.dispatch(command);
    await this.complete(command.commandId, lease, outcome);
    return { kind: "processed" };
  }

  private async complete(
    commandId: string,
    lease: SessionLeaseV1,
    outcome: ObservedCommandOutcome,
  ) {
    await this.journal.terminal(commandId, journalState(outcome));
    await this.transport.result(
      leaseProof(lease),
      commandId,
      outcomeCode(outcome),
    );
  }
}

const leaseProof = (lease: SessionLeaseV1) => ({
  sessionId: lease.sessionId,
  leaseId: lease.leaseId,
  leaseGeneration: lease.generation,
});

export class DeviceSessionReconnectController {
  constructor(
    private readonly coordination: CloudDeviceCoordinationPort,
    private readonly transport: CloudSessionTransportPort,
    private readonly commands: DeviceCommandReconciler,
    private readonly takeoverGate: DeviceTakeoverGate,
  ) {}

  async reconnect(input: {
    deviceId: string;
    sessionId: string;
    sessionRevision: number;
    afterSequence: number;
  }): Promise<ReconnectResult> {
    if (!this.coordination.enabled || !this.transport.enabled)
      return { kind: "disabled" };
    const connection = await this.coordination.createConnection(input.deviceId);
    if (!connection) return { kind: "read_only", connectionId: "" };
    const current = await this.coordination.lease(input.sessionId);
    const liveCurrent =
      current && (current.state === "active" || current.state === "grace")
        ? current
        : null;
    if (liveCurrent && liveCurrent.deviceId !== input.deviceId)
      return {
        kind: "needs_takeover",
        connectionId: connection.connectionId,
        currentLease: liveCurrent,
      };
    if (
      liveCurrent &&
      liveCurrent.deviceId === input.deviceId &&
      (await this.takeoverGate.isArmed(input.sessionId))
    )
      return {
        kind: "restore_required",
        connectionId: connection.connectionId,
        currentLease: liveCurrent,
      };

    const lease = liveCurrent
      ? await this.coordination.reconnectLease(
          liveCurrent,
          connection.connectionId,
        )
      : await this.coordination.acquireLease(
          input.sessionId,
          connection.connectionId,
          input.sessionRevision,
        );
    if (!lease)
      return { kind: "read_only", connectionId: connection.connectionId };

    const delivered = await this.transport.poll(
      leaseProof(lease),
      input.afterSequence,
    );
    let lastSequence = input.afterSequence;
    let processedCommands = 0;
    for (const command of delivered.sort(
      (left, right) => left.record.sequence - right.record.sequence,
    )) {
      if (command.record.sequence <= lastSequence) continue;
      const reconciled = await this.commands.reconcile(command, lease);
      if (reconciled.kind === "deferred") break;
      if (reconciled.kind === "approval_required")
        return {
          kind: "approval_required",
          connectionId: connection.connectionId,
          lease,
          command: reconciled.command,
          actionDigest: reconciled.actionDigest,
          lastSequence,
          processedCommands,
        };
      lastSequence = command.record.sequence;
      processedCommands += 1;
    }
    return {
      kind: "connected",
      connectionId: connection.connectionId,
      lease,
      lastSequence,
      processedCommands,
    };
  }

  async takeover(input: {
    confirmed: boolean;
    connectionId: string;
    currentLease: SessionLeaseV1;
    sessionRevision: number;
    restoreAndReground: (lease: SessionLeaseV1) => Promise<void>;
  }): Promise<TakeoverResult> {
    if (!input.confirmed) return { kind: "confirmation_required" };
    if (!this.coordination.enabled) return { kind: "disabled" };
    await this.takeoverGate.arm(
      input.currentLease.sessionId,
      input.currentLease.generation,
    );
    const lease = await this.coordination.takeoverLease(
      input.currentLease,
      input.connectionId,
      input.sessionRevision,
    );
    if (!lease) return { kind: "disabled" };
    await this.takeoverGate.recordTakeoverGeneration(lease.generation);
    await input.restoreAndReground(lease);
    return {
      kind: "paused_for_restore",
      connectionId: input.connectionId,
      lease,
      requiresFreshApproval: true,
    };
  }

  async continueAfterTakeover(lease: SessionLeaseV1): Promise<boolean> {
    return this.takeoverGate.clear(lease.sessionId, lease.generation);
  }
}
