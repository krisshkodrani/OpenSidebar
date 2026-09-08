import { describe, expect, it, vi } from "vitest";
import type {
  BrowserCommandV1,
  CloudDeviceConnectionV1,
  DeliveredBrowserCommandV1,
  DeviceCommandOutcomeCode,
  DeviceCommandRecordV1,
  SessionLeaseV1,
} from "@shared-types/cloud-sessions";
import type { CloudDeviceCoordinationPort } from "../../src/background/environment/cloud-device-coordination-port";
import type {
  CloudSessionTransportPort,
  CommandLeaseProof,
} from "../../src/background/environment/cloud-session-transport-port";
import type {
  PersistenceStorageArea,
  PersistenceStorageChange,
} from "../../src/background/environment/types";
import { DeviceAttemptJournal } from "../../src/background/orchestrator/device-attempt-journal";
import {
  browserCommandActionDigest,
  DeviceCommandReconciler,
  DeviceSessionReconnectController,
  DeviceTakeoverGate,
  type DeviceCommandExecutionPort,
} from "../../src/background/orchestrator/device-session-reconnect";

class ProfileStorage implements PersistenceStorageArea {
  values: Record<string, unknown> = {};
  async get(keys?: string | string[] | Record<string, unknown> | null) {
    if (typeof keys === "string") return { [keys]: this.values[keys] };
    return { ...this.values };
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.values, items);
  }
  async remove(keys: string | string[]) {
    for (const key of typeof keys === "string" ? [keys] : keys)
      delete this.values[key];
  }
  onChanged(
    _listener: (changes: Record<string, PersistenceStorageChange>) => void,
  ) {
    return () => undefined;
  }
}

class FakeCoordination implements CloudDeviceCoordinationPort {
  enabled = true;
  sequence = 0;
  constructor(public current: SessionLeaseV1 | null) {}
  async createConnection(deviceId: string): Promise<CloudDeviceConnectionV1> {
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      connectionId: `connection-${deviceId}-${++this.sequence}`,
      deviceId,
      transport: "long_poll",
      lastAcknowledgedSequence: 0,
      connectedAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  async lease() {
    return this.current;
  }
  async acquireLease(
    sessionId: string,
    _connectionId: string,
    expectedSessionRevision: number,
  ) {
    this.current = lease({
      sessionId,
      checkpointRevision: expectedSessionRevision,
    });
    return this.current;
  }
  async reconnectLease(value: SessionLeaseV1) {
    if (
      !this.current ||
      value.deviceId !== this.current.deviceId ||
      value.generation !== this.current.generation
    )
      return null;
    return this.current;
  }
  async heartbeatLease(value: SessionLeaseV1) {
    return value;
  }
  async takeoverLease(
    current: SessionLeaseV1,
    connectionId: string,
    expectedSessionRevision: number,
  ) {
    const deviceId = /^connection-(.+)-\d+$/.exec(connectionId)?.[1];
    if (!deviceId) return null;
    this.current = lease({
      sessionId: current.sessionId,
      deviceId,
      generation: current.generation + 1,
      checkpointRevision: expectedSessionRevision,
    });
    return this.current;
  }
}

class FakeTransport implements CloudSessionTransportPort {
  enabled = true;
  delivered: DeliveredBrowserCommandV1[] = [];
  transitions: string[] = [];
  results: DeviceCommandOutcomeCode[] = [];
  async poll(_proof: CommandLeaseProof, _after: number) {
    return this.delivered;
  }
  async transition(
    _proof: CommandLeaseProof,
    commandId: string,
    transition: "accept" | "start" | "cancel",
  ) {
    this.transitions.push(`${transition}:${commandId}`);
    return this.delivered[0]?.record ?? null;
  }
  async result(
    _proof: CommandLeaseProof,
    _commandId: string,
    outcome: DeviceCommandOutcomeCode,
  ) {
    this.results.push(outcome);
    return this.delivered[0]?.record ?? null;
  }
}

const lease = (overrides: Partial<SessionLeaseV1> = {}): SessionLeaseV1 => {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    sessionId: crypto.randomUUID(),
    leaseId: crypto.randomUUID(),
    deviceId: "device-a",
    generation: 1,
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    checkpointRevision: 2,
    state: "active",
    ...overrides,
  };
};

async function delivered(value: SessionLeaseV1, sequence = 1) {
  const now = new Date().toISOString();
  const command: BrowserCommandV1 = {
    schemaVersion: 1,
    sessionId: value.sessionId,
    commandId: crypto.randomUUID(),
    leaseId: value.leaseId,
    leaseGeneration: value.generation,
    checkpointRevision: value.checkpointRevision,
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    action: {
      kind: "click",
      target: { description: "Continue button", expectedRole: "button" },
      arguments: {},
    },
    preconditions: [{ kind: "fresh_observation", value: "required" }],
    risk: "reversible_write",
  };
  const actionDigest = await browserCommandActionDigest(command);
  const record: DeviceCommandRecordV1 = {
    schemaVersion: 1,
    sessionId: value.sessionId,
    commandId: command.commandId,
    sequence,
    leaseId: value.leaseId,
    leaseGeneration: value.generation,
    checkpointRevision: value.checkpointRevision,
    commandKind: command.action.kind,
    risk: command.risk,
    actionDigest,
    state: "delivered",
    createdAt: now,
    updatedAt: now,
    expiresAt: command.expiresAt,
  };
  return { schemaVersion: 1 as const, record, command };
}

const execution = (): DeviceCommandExecutionPort => ({
  validateAndGround: vi.fn().mockResolvedValue(true),
  dispatch: vi.fn().mockResolvedValue("succeeded"),
  observe: vi.fn().mockResolvedValue("succeeded"),
});

function controller(
  coordination: FakeCoordination,
  transport: FakeTransport,
  storage: ProfileStorage,
  sessionId: string,
  executor: DeviceCommandExecutionPort,
) {
  const journal = new DeviceAttemptJournal(storage, sessionId);
  const reconciler = new DeviceCommandReconciler(
    transport,
    journal,
    executor,
  );
  return {
    journal,
    value: new DeviceSessionReconnectController(
      coordination,
      transport,
      reconciler,
      new DeviceTakeoverGate(storage, sessionId),
    ),
  };
}

describe("device session reconnect", () => {
  it("rebinds the same device and replays a terminal result without a second dispatch", async () => {
    const current = lease();
    const coordination = new FakeCoordination(current);
    const transport = new FakeTransport();
    transport.delivered = [await delivered(current)];
    const profile = new ProfileStorage();
    const firstExecution = execution();
    const first = controller(
      coordination,
      transport,
      profile,
      current.sessionId,
      firstExecution,
    );
    const initial = await first.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(initial.kind).toBe("connected");
    expect(firstExecution.dispatch).toHaveBeenCalledTimes(1);

    const restartedExecution = execution();
    const restarted = controller(
      coordination,
      transport,
      profile,
      current.sessionId,
      restartedExecution,
    );
    await restarted.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(restartedExecution.dispatch).not.toHaveBeenCalled();
    expect(transport.results).toEqual(["verified", "verified"]);
  });

  it("observes a persisted started attempt after restart and never dispatches it again", async () => {
    const current = lease();
    const transport = new FakeTransport();
    const item = await delivered(current);
    transport.delivered = [item];
    const profile = new ProfileStorage();
    const instance = controller(
      new FakeCoordination(current),
      transport,
      profile,
      current.sessionId,
      execution(),
    );
    await instance.journal.accepted(
      item.command,
      crypto.randomUUID(),
      item.record.actionDigest,
    );
    await instance.journal.started(item.command.commandId);
    const restartedExecution = execution();
    const restarted = controller(
      new FakeCoordination(current),
      transport,
      profile,
      current.sessionId,
      restartedExecution,
    );
    await restarted.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(restartedExecution.observe).toHaveBeenCalledTimes(1);
    expect(restartedExecution.dispatch).not.toHaveBeenCalled();
  });

  it("does not acknowledge past a command that cannot be freshly grounded", async () => {
    const current = lease();
    const transport = new FakeTransport();
    transport.delivered = [
      await delivered(current, 4),
      await delivered(current, 5),
    ];
    const blockedExecution = execution();
    vi.mocked(blockedExecution.validateAndGround).mockResolvedValue(false);
    const instance = controller(
      new FakeCoordination(current),
      transport,
      new ProfileStorage(),
      current.sessionId,
      blockedExecution,
    );
    const result = await instance.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 3,
    });
    expect(result).toMatchObject({
      kind: "connected",
      lastSequence: 3,
      processedCommands: 0,
    });
    expect(blockedExecution.validateAndGround).toHaveBeenCalledTimes(1);
    expect(blockedExecution.dispatch).not.toHaveBeenCalled();
  });

  it("rejects an expired sensitive-write approval before local execution", async () => {
    const current = lease();
    const transport = new FakeTransport();
    const item = await delivered(current);
    item.command.risk = "sensitive_write";
    item.command.approval = {
      approvalId: crypto.randomUUID(),
      approvedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      actionDigest: "pending",
    };
    const digest = await browserCommandActionDigest(item.command);
    item.command.approval.actionDigest = digest;
    item.record.actionDigest = digest;
    item.record.risk = "sensitive_write";
    transport.delivered = [item];
    const executor = execution();
    const instance = controller(
      new FakeCoordination(current),
      transport,
      new ProfileStorage(),
      current.sessionId,
      executor,
    );

    const result = await instance.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(result).toMatchObject({ kind: "connected", processedCommands: 0 });
    expect(executor.validateAndGround).not.toHaveBeenCalled();
    expect(executor.dispatch).not.toHaveBeenCalled();
    expect(transport.transitions).toEqual([]);
  });

  it("pauses before acceptance when the current device requires local approval", async () => {
    const current = lease();
    const transport = new FakeTransport();
    const item = await delivered(current);
    transport.delivered = [item];
    const executor = execution();
    vi.mocked(executor.validateAndGround).mockResolvedValue("approval_required");
    const instance = controller(
      new FakeCoordination(current),
      transport,
      new ProfileStorage(),
      current.sessionId,
      executor,
    );

    const result = await instance.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(result).toMatchObject({
      kind: "approval_required",
      command: { commandId: item.command.commandId },
      lastSequence: 0,
      processedCommands: 0,
    });
    expect(executor.dispatch).not.toHaveBeenCalled();
    expect(transport.transitions).toEqual([]);
    expect(await instance.journal.record(item.command.commandId)).toBeNull();
  });

  it("rejects inconsistent delivered metadata before grounding", async () => {
    const current = lease();
    const transport = new FakeTransport();
    const item = await delivered(current);
    item.record.commandKind = "type_text";
    transport.delivered = [item];
    const executor = execution();
    const instance = controller(
      new FakeCoordination(current),
      transport,
      new ProfileStorage(),
      current.sessionId,
      executor,
    );
    const result = await instance.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(result).toMatchObject({ kind: "connected", processedCommands: 0 });
    expect(executor.validateAndGround).not.toHaveBeenCalled();
  });

  it("requires both valid cloud approval and fresh local approval for a sensitive click", async () => {
    const current = lease();
    const transport = new FakeTransport();
    const item = await delivered(current);
    item.command.risk = "sensitive_write";
    const digest = await browserCommandActionDigest(item.command);
    item.command.approval = {
      approvalId: crypto.randomUUID(),
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      actionDigest: digest,
    };
    item.record.risk = "sensitive_write";
    item.record.actionDigest = digest;
    transport.delivered = [item];
    const storage = new ProfileStorage();
    const waiting = execution();
    vi.mocked(waiting.validateAndGround).mockResolvedValue("approval_required");
    const first = controller(
      new FakeCoordination(current),
      transport,
      storage,
      current.sessionId,
      waiting,
    );
    expect((await first.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    })).kind).toBe("approval_required");
    expect(transport.transitions).toEqual([]);

    const approved = execution();
    const resumed = controller(
      new FakeCoordination(current),
      transport,
      storage,
      current.sessionId,
      approved,
    );
    expect(await resumed.value.reconnect({
      deviceId: current.deviceId,
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    })).toMatchObject({ kind: "connected", processedCommands: 1 });
    expect(approved.dispatch).toHaveBeenCalledOnce();
    expect(transport.transitions).toEqual([
      `accept:${item.command.commandId}`,
      `start:${item.command.commandId}`,
    ]);
  });

  it("fences profile A and keeps profile B paused after explicit takeover", async () => {
    const current = lease({ deviceId: "device-a" });
    const coordination = new FakeCoordination(current);
    const transport = new FakeTransport();
    const profileA = controller(
      coordination,
      transport,
      new ProfileStorage(),
      current.sessionId,
      execution(),
    );
    const profileB = controller(
      coordination,
      transport,
      new ProfileStorage(),
      current.sessionId,
      execution(),
    );
    const candidate = await profileB.value.reconnect({
      deviceId: "device-b",
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(candidate.kind).toBe("needs_takeover");
    if (candidate.kind !== "needs_takeover") return;
    expect(
      await profileB.value.takeover({
        confirmed: false,
        connectionId: candidate.connectionId,
        currentLease: candidate.currentLease,
        sessionRevision: 2,
        restoreAndReground: vi.fn(),
      }),
    ).toEqual({ kind: "confirmation_required" });

    const restoreAndReground = vi.fn().mockResolvedValue(undefined);
    const taken = await profileB.value.takeover({
      confirmed: true,
      connectionId: candidate.connectionId,
      currentLease: candidate.currentLease,
      sessionRevision: 2,
      restoreAndReground,
    });
    expect(taken).toMatchObject({
      kind: "paused_for_restore",
      requiresFreshApproval: true,
      lease: { deviceId: "device-b", generation: 2 },
    });
    expect(restoreAndReground).toHaveBeenCalledTimes(1);

    const blockedNewProfile = await profileB.value.reconnect({
      deviceId: "device-b",
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(blockedNewProfile.kind).toBe("restore_required");
    if (taken.kind !== "paused_for_restore") return;
    expect(await profileB.value.continueAfterTakeover(taken.lease)).toBe(true);
    const resumedNewProfile = await profileB.value.reconnect({
      deviceId: "device-b",
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(resumedNewProfile.kind).toBe("connected");

    const oldProfile = await profileA.value.reconnect({
      deviceId: "device-a",
      sessionId: current.sessionId,
      sessionRevision: 2,
      afterSequence: 0,
    });
    expect(oldProfile.kind).toBe("needs_takeover");
  });
});
