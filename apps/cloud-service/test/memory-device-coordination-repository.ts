import type {
  CloudDeviceConnectionV1,
  SessionLeaseV1,
} from "@opensidebar/shared-types";
import type { DeviceCoordinationRepository } from "../src/device-coordination-repository.js";

export class MemoryDeviceCoordinationRepository implements DeviceCoordinationRepository {
  connections = new Map<
    string,
    CloudDeviceConnectionV1 & { accountId: string }
  >();
  leases = new Map<
    string,
    SessionLeaseV1 & { accountId: string; connectionId: string }
  >();

  async createConnection(
    accountId: string,
    deviceId: string,
    connectionId: string,
    transport: "sse" | "long_poll",
    expiresAt: Date,
    _idempotencyHash: string,
  ) {
    const now = new Date().toISOString();
    const stored = {
      schemaVersion: 1 as const,
      accountId,
      connectionId,
      deviceId,
      transport,
      lastAcknowledgedSequence: 0,
      connectedAt: now,
      lastSeenAt: now,
      expiresAt: expiresAt.toISOString(),
    };
    this.connections.set(connectionId, stored);
    const { accountId: _accountId, ...value } = stored;
    return { kind: "created" as const, value };
  }

  async connection(accountId: string, deviceId: string, connectionId: string) {
    const stored = this.connections.get(connectionId);
    if (stored?.accountId !== accountId || stored.deviceId !== deviceId)
      return null;
    const { accountId: _accountId, ...value } = stored;
    return value;
  }

  async acquireLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    expectedSessionRevision: number;
    idempotencyHash: string;
  }) {
    if (
      !(await this.connection(
        input.accountId,
        input.deviceId,
        input.connectionId,
      ))
    )
      return { kind: "device_mismatch" as const };
    const prior = this.leases.get(input.sessionId);
    if (prior && ["active", "grace"].includes(prior.state))
      return { kind: "lease_conflict" as const };
    const now = new Date();
    const stored = {
      schemaVersion: 1 as const,
      accountId: input.accountId,
      connectionId: input.connectionId,
      sessionId: input.sessionId,
      leaseId: input.leaseId,
      deviceId: input.deviceId,
      generation: (prior?.generation ?? 0) + 1,
      acquiredAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 90_000).toISOString(),
      checkpointRevision: 0,
      state: "active" as const,
    };
    this.leases.set(input.sessionId, stored);
    const {
      accountId: _accountId,
      connectionId: _connectionId,
      ...value
    } = stored;
    return { kind: "created" as const, value };
  }

  async heartbeatLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }) {
    const stored = this.leases.get(input.sessionId);
    if (
      !stored ||
      stored.accountId !== input.accountId ||
      stored.deviceId !== input.deviceId ||
      stored.leaseId !== input.leaseId ||
      stored.generation !== input.generation ||
      stored.connectionId !== input.connectionId
    )
      return { kind: "generation_conflict" as const };
    const {
      accountId: _accountId,
      connectionId: _connectionId,
      ...value
    } = stored;
    return { kind: "updated" as const, value };
  }

  async reconnectLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }) {
    const stored = this.leases.get(input.sessionId);
    if (
      !stored ||
      stored.accountId !== input.accountId ||
      stored.deviceId !== input.deviceId ||
      stored.leaseId !== input.leaseId ||
      stored.generation !== input.generation ||
      !(await this.connection(
        input.accountId,
        input.deviceId,
        input.connectionId,
      ))
    )
      return { kind: "generation_conflict" as const };
    const now = new Date();
    Object.assign(stored, {
      connectionId: input.connectionId,
      state: "active" as const,
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 90_000).toISOString(),
    });
    const {
      accountId: _accountId,
      connectionId: _connectionId,
      ...value
    } = stored;
    return { kind: "updated" as const, value };
  }

  async takeoverLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    connectionId: string;
    leaseId: string;
    expectedSessionRevision: number;
    expectedGeneration: number;
    idempotencyHash: string;
  }) {
    const prior = this.leases.get(input.sessionId);
    if (!prior || prior.generation !== input.expectedGeneration)
      return { kind: "generation_conflict" as const };
    const acquired = await this.acquireLease({
      ...input,
      expectedSessionRevision: input.expectedSessionRevision,
    });
    if (acquired.kind === "lease_conflict") {
      prior.state = "revoked";
      return this.acquireLease(input);
    }
    return acquired;
  }

  async releaseLease(input: {
    accountId: string;
    sessionId: string;
    deviceId: string;
    leaseId: string;
    generation: number;
    idempotencyHash: string;
  }) {
    const prior = this.leases.get(input.sessionId);
    if (
      !prior ||
      prior.accountId !== input.accountId ||
      prior.deviceId !== input.deviceId ||
      prior.leaseId !== input.leaseId ||
      prior.generation !== input.generation
    )
      return { kind: "generation_conflict" as const };
    prior.state = "revoked";
    const {
      accountId: _accountId,
      connectionId: _connectionId,
      ...value
    } = prior;
    return { kind: "updated" as const, value };
  }

  async lease(accountId: string, sessionId: string) {
    const stored = this.leases.get(sessionId);
    if (stored?.accountId !== accountId) return null;
    const {
      accountId: _accountId,
      connectionId: _connectionId,
      ...value
    } = stored;
    return value;
  }
}
