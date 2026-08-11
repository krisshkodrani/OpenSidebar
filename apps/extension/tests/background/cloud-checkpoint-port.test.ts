import { describe, expect, it, vi } from "vitest";
import type { PortableCheckpointV1 } from "@shared-types/cloud-sessions";
import {
  DisabledCloudCheckpointPort,
  HttpCloudCheckpointPort,
} from "../../src/background/environment/cloud-checkpoint-port";

const checkpoint = {
  schemaVersion: 1,
  sessionId: "1bd0c891-8ddb-468f-8f02-e47a0e430176",
  checkpointId: "f0341e58-3989-41ac-bd85-99aca119dd86",
  revision: 1,
} as PortableCheckpointV1;

describe("cloud checkpoint port", () => {
  it("is inert when disabled", async () => {
    const port = new DisabledCloudCheckpointPort();
    expect(port.enabled).toBe(false);
    expect(await port.upload(1, checkpoint)).toBeNull();
    expect(
      await port.restore(checkpoint.sessionId, checkpoint.checkpointId),
    ).toBeNull();
  });

  it("commits exactly the encrypted intent metadata", async () => {
    const fetchCloud = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            checkpointId: checkpoint.checkpointId,
            ciphertextSizeBytes: 4321,
            ciphertextSha256: "a".repeat(64),
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            session: { revision: 2 },
            checkpoint: { checkpointId: checkpoint.checkpointId },
          }),
        ),
      );
    const result = await new HttpCloudCheckpointPort(fetchCloud).upload(
      1,
      checkpoint,
    );
    expect(result?.sessionRevision).toBe(2);
    const commit = fetchCloud.mock.calls[1];
    expect(commit?.[0]).toContain(`/${checkpoint.checkpointId}/commit`);
    expect(JSON.parse(String(commit?.[1]?.body))).toMatchObject({
      ciphertextSizeBytes: 4321,
      ciphertextSha256: "a".repeat(64),
    });
    expect(commit?.[1]?.headers).toMatchObject({ "if-match": "1" });
  });

  it("rejects malformed or identity-confused restore payloads", async () => {
    const malformed = new HttpCloudCheckpointPort(
      vi.fn().mockResolvedValue(new Response(JSON.stringify(checkpoint))),
    );
    await expect(
      malformed.restore(checkpoint.sessionId, checkpoint.checkpointId),
    ).rejects.toThrow("checkpoint_restore_invalid");
  });
});
