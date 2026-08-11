import type {
  CloudCheckpointIndexV1,
  PortableCheckpointV1,
} from "@shared-types/cloud-sessions";
import { migratePortableCheckpoint } from "@shared-types/portable-checkpoint-policy";

export type CloudCheckpointCommitResult = {
  checkpoint: CloudCheckpointIndexV1;
  sessionRevision: number;
};

export interface CloudCheckpointPort {
  readonly enabled: boolean;
  upload(
    sessionRevision: number,
    checkpoint: PortableCheckpointV1,
  ): Promise<CloudCheckpointCommitResult | null>;
  restore(
    sessionId: string,
    checkpointId: string,
  ): Promise<PortableCheckpointV1 | null>;
}

export class DisabledCloudCheckpointPort implements CloudCheckpointPort {
  readonly enabled = false;
  async upload() {
    return null;
  }
  async restore() {
    return null;
  }
}

type AuthenticatedFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

const requestKey = (operation: string, checkpointId: string) =>
  `${operation}:${checkpointId}`;

export class HttpCloudCheckpointPort implements CloudCheckpointPort {
  readonly enabled = true;
  constructor(private readonly fetchCloud: AuthenticatedFetch) {}

  async upload(sessionRevision: number, checkpoint: PortableCheckpointV1) {
    const base = `/sessions/${checkpoint.sessionId}/checkpoints`;
    const intentResponse = await this.fetchCloud(`${base}/intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": requestKey(
          "checkpoint-intent",
          checkpoint.checkpointId,
        ),
      },
      body: JSON.stringify({ schemaVersion: 1, sessionRevision, checkpoint }),
    });
    if (!intentResponse.ok) throw new Error("checkpoint_intent_failed");
    const intent = (await intentResponse.json()) as CloudCheckpointIndexV1;
    const commitResponse = await this.fetchCloud(
      `${base}/${checkpoint.checkpointId}/commit`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": requestKey(
            "checkpoint-commit",
            checkpoint.checkpointId,
          ),
          "if-match": String(sessionRevision),
        },
        body: JSON.stringify({
          schemaVersion: 1,
          checkpointId: checkpoint.checkpointId,
          ciphertextSizeBytes: intent.ciphertextSizeBytes,
          ciphertextSha256: intent.ciphertextSha256,
        }),
      },
    );
    if (!commitResponse.ok) throw new Error("checkpoint_commit_failed");
    const committed = (await commitResponse.json()) as {
      session: { revision: number };
      checkpoint: CloudCheckpointIndexV1;
    };
    return {
      checkpoint: committed.checkpoint,
      sessionRevision: committed.session.revision,
    };
  }

  async restore(sessionId: string, checkpointId: string) {
    const response = await this.fetchCloud(
      `/sessions/${sessionId}/checkpoints/${checkpointId}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("checkpoint_restore_failed");
    const validation = migratePortableCheckpoint(await response.json());
    if (!validation.valid) throw new Error("checkpoint_restore_invalid");
    if (
      validation.value.sessionId !== sessionId ||
      validation.value.checkpointId !== checkpointId
    )
      throw new Error("checkpoint_restore_identity_mismatch");
    return validation.value;
  }
}
