import type {
  DeliveredBrowserCommandV1,
  DeviceCommandOutcomeCode,
  DeviceCommandRecordV1,
} from "@shared-types/cloud-sessions";

export type CommandLeaseProof = {
  sessionId: string;
  leaseId: string;
  leaseGeneration: number;
};

export interface CloudSessionTransportPort {
  readonly enabled: boolean;
  poll(
    proof: CommandLeaseProof,
    afterSequence: number,
  ): Promise<DeliveredBrowserCommandV1[]>;
  transition(
    proof: CommandLeaseProof,
    commandId: string,
    transition: "accept" | "start" | "cancel",
  ): Promise<DeviceCommandRecordV1 | null>;
  result(
    proof: CommandLeaseProof,
    commandId: string,
    outcomeCode: DeviceCommandOutcomeCode,
  ): Promise<DeviceCommandRecordV1 | null>;
}

export class DisabledCloudSessionTransportPort implements CloudSessionTransportPort {
  readonly enabled = false;
  async poll() {
    return [];
  }
  async transition() {
    return null;
  }
  async result() {
    return null;
  }
}

type AuthenticatedFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

export class HttpCloudSessionTransportPort implements CloudSessionTransportPort {
  readonly enabled = true;
  constructor(private readonly fetchCloud: AuthenticatedFetch) {}

  async poll(proof: CommandLeaseProof, afterSequence: number) {
    const query = new URLSearchParams({
      leaseId: proof.leaseId,
      generation: String(proof.leaseGeneration),
      after: String(afterSequence),
      limit: "25",
      wait: "25",
    });
    const response = await this.fetchCloud(
      `/sessions/${proof.sessionId}/commands?${query}`,
    );
    if (!response.ok) throw new Error("command_poll_failed");
    return (
      (await response.json()) as { commands: DeliveredBrowserCommandV1[] }
    ).commands;
  }

  async transition(
    proof: CommandLeaseProof,
    commandId: string,
    transition: "accept" | "start" | "cancel",
  ) {
    return this.mutate(proof, commandId, transition);
  }

  async result(
    proof: CommandLeaseProof,
    commandId: string,
    outcomeCode: DeviceCommandOutcomeCode,
  ) {
    return this.mutate(proof, commandId, "result", outcomeCode);
  }

  private async mutate(
    proof: CommandLeaseProof,
    commandId: string,
    transition: "accept" | "start" | "result" | "cancel",
    outcomeCode?: DeviceCommandOutcomeCode,
  ) {
    const response = await this.fetchCloud(
      `/sessions/${proof.sessionId}/commands/${commandId}/${transition}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `command-${transition}:${commandId}`,
        },
        body: JSON.stringify({
          schemaVersion: 1,
          leaseId: proof.leaseId,
          leaseGeneration: proof.leaseGeneration,
          ...(outcomeCode ? { outcomeCode } : {}),
        }),
      },
    );
    if (!response.ok) throw new Error(`command_${transition}_failed`);
    return response.json() as Promise<DeviceCommandRecordV1>;
  }
}
