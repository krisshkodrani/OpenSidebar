import { describe, expect, it, vi } from "vitest";
import {
  DisabledCloudSessionTransportPort,
  HttpCloudSessionTransportPort,
} from "../../src/background/environment/cloud-session-transport-port";
import {
  DisabledCloudDeviceCoordinationPort,
  HttpCloudDeviceCoordinationPort,
} from "../../src/background/environment/cloud-device-coordination-port";

const proof = {
  sessionId: "1bd0c891-8ddb-468f-8f02-e47a0e430176",
  leaseId: "f0341e58-3989-41ac-bd85-99aca119dd86",
  leaseGeneration: 2,
};

describe("cloud session transport port", () => {
  it("is inert when disabled", async () => {
    const port = new DisabledCloudSessionTransportPort();
    expect(await port.poll(proof, 0)).toEqual([]);
    expect(
      await port.transition(proof, crypto.randomUUID(), "accept"),
    ).toBeNull();
  });

  it("uses sequence polling and lease-bound mutations", async () => {
    const fetchCloud = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ commands: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "accepted" })),
      );
    const port = new HttpCloudSessionTransportPort(fetchCloud);
    await port.poll(proof, 7);
    expect(fetchCloud.mock.calls[0]?.[0]).toContain("after=7");
    expect(fetchCloud.mock.calls[0]?.[0]).toContain("wait=25");
    expect(fetchCloud.mock.calls[0]?.[0]).toContain(`leaseId=${proof.leaseId}`);
    const commandId = crypto.randomUUID();
    await port.transition(proof, commandId, "accept");
    const mutation = fetchCloud.mock.calls[1];
    expect(mutation?.[0]).toContain(`/${commandId}/accept`);
    expect(JSON.parse(String(mutation?.[1]?.body))).toMatchObject({
      leaseId: proof.leaseId,
      leaseGeneration: 2,
    });
  });
});

describe("cloud device coordination port", () => {
  it("is inert when disabled", async () => {
    const port = new DisabledCloudDeviceCoordinationPort();
    expect(await port.lease(proof.sessionId)).toBeNull();
    expect(await port.createConnection("device-a")).toBeNull();
  });

  it("rebinds a same-device lease through the reconnect mutation", async () => {
    const now = new Date().toISOString();
    const lease = {
      schemaVersion: 1 as const,
      sessionId: proof.sessionId,
      leaseId: proof.leaseId,
      deviceId: "device-a",
      generation: proof.leaseGeneration,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: now,
      checkpointRevision: 2,
      state: "grace" as const,
    };
    const fetchCloud = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(lease), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const port = new HttpCloudDeviceCoordinationPort(fetchCloud);
    await port.reconnectLease(lease, "connection-new");
    expect(fetchCloud.mock.calls[0]?.[0]).toContain("/lease/reconnect");
    expect(JSON.parse(String(fetchCloud.mock.calls[0]?.[1]?.body))).toEqual({
      schemaVersion: 1,
      connectionId: "connection-new",
      leaseId: proof.leaseId,
      generation: proof.leaseGeneration,
    });
  });
});
