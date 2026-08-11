import type {
  CloudDeviceConnectionV1,
  SessionLeaseV1,
} from "@shared-types/cloud-sessions";

type AuthenticatedFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export interface CloudDeviceCoordinationPort {
  readonly enabled: boolean;
  createConnection(deviceId: string): Promise<CloudDeviceConnectionV1 | null>;
  lease(sessionId: string): Promise<SessionLeaseV1 | null>;
  acquireLease(
    sessionId: string,
    connectionId: string,
    expectedSessionRevision: number,
  ): Promise<SessionLeaseV1 | null>;
  reconnectLease(
    lease: SessionLeaseV1,
    connectionId: string,
  ): Promise<SessionLeaseV1 | null>;
  heartbeatLease(
    lease: SessionLeaseV1,
    connectionId: string,
  ): Promise<SessionLeaseV1 | null>;
  takeoverLease(
    current: SessionLeaseV1,
    connectionId: string,
    expectedSessionRevision: number,
  ): Promise<SessionLeaseV1 | null>;
}

export class DisabledCloudDeviceCoordinationPort implements CloudDeviceCoordinationPort {
  readonly enabled = false;
  async createConnection() {
    return null;
  }
  async lease() {
    return null;
  }
  async acquireLease() {
    return null;
  }
  async reconnectLease() {
    return null;
  }
  async heartbeatLease() {
    return null;
  }
  async takeoverLease() {
    return null;
  }
}

export class HttpCloudDeviceCoordinationPort implements CloudDeviceCoordinationPort {
  readonly enabled = true;
  constructor(private readonly fetchCloud: AuthenticatedFetch) {}

  async createConnection(deviceId: string) {
    return this.mutate<CloudDeviceConnectionV1>(
      `/devices/${deviceId}/connections`,
      `connection:${deviceId}:${crypto.randomUUID()}`,
      { schemaVersion: 1, transport: "long_poll" },
    );
  }

  async lease(sessionId: string) {
    const response = await this.fetchCloud(`/sessions/${sessionId}/lease`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("lease_read_failed");
    return response.json() as Promise<SessionLeaseV1>;
  }

  async acquireLease(
    sessionId: string,
    connectionId: string,
    expectedSessionRevision: number,
  ) {
    return this.mutate<SessionLeaseV1>(
      `/sessions/${sessionId}/lease`,
      `lease-acquire:${sessionId}:${connectionId}`,
      { schemaVersion: 1, connectionId, expectedSessionRevision },
    );
  }

  async reconnectLease(lease: SessionLeaseV1, connectionId: string) {
    return this.leaseMutation("reconnect", lease, connectionId);
  }

  async heartbeatLease(lease: SessionLeaseV1, connectionId: string) {
    return this.leaseMutation("heartbeat", lease, connectionId);
  }

  async takeoverLease(
    current: SessionLeaseV1,
    connectionId: string,
    expectedSessionRevision: number,
  ) {
    return this.mutate<SessionLeaseV1>(
      `/sessions/${current.sessionId}/lease/takeover`,
      `lease-takeover:${current.sessionId}:${current.generation}:${connectionId}`,
      {
        schemaVersion: 1,
        connectionId,
        leaseId: current.leaseId,
        generation: current.generation,
        expectedSessionRevision,
      },
    );
  }

  private leaseMutation(
    operation: "reconnect" | "heartbeat",
    lease: SessionLeaseV1,
    connectionId: string,
  ) {
    return this.mutate<SessionLeaseV1>(
      `/sessions/${lease.sessionId}/lease/${operation}`,
      `lease-${operation}:${lease.sessionId}:${lease.generation}:${connectionId}`,
      {
        schemaVersion: 1,
        connectionId,
        leaseId: lease.leaseId,
        generation: lease.generation,
      },
    );
  }

  private async mutate<T>(
    path: string,
    idempotencyKey: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.fetchCloud(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("device_coordination_mutation_failed");
    return response.json() as Promise<T>;
  }
}
