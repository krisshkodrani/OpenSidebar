import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import type {
  RemoteMissionPayloadV1,
  RemoteMissionApprovalDecisionV1,
  RemoteMissionProgressV1,
  RemoteMissionResultV1,
  RemoteMissionTargetDecisionV1,
  RemoteMissionSupervisorDecisionV1,
} from "@opensidebar/shared-types";
import type { CheckpointObjectPort } from "./checkpoint-vault.js";
import type { KmsPort } from "./credential-vault.js";

const ALGORITHM = "aes-256-gcm-envelope-v1";
const MAX_PAYLOAD_BYTES = 32 * 1024;

export type RemoteMissionIdentity = {
  accountId: string;
  deviceId: string;
  missionId: string;
};

type MissionEnvelopeV1 = {
  version: 1;
  algorithm: typeof ALGORITHM;
  encryptedDataKey: string;
  nonce: string;
  authenticationTag: string;
  ciphertext: string;
};

const context = (
  identity: RemoteMissionIdentity,
  purpose: "payload" | "progress" | "result" | "approval-decision" | "target-decision" | "supervisor-decision",
) => ({
  // Preserve the original payload context so queued envelopes remain
  // decryptable across this rollout; results use a distinct context.
  purpose:
    purpose === "payload"
      ? "opensidebar-remote-mission-v1"
      : `opensidebar-remote-mission-${purpose}-v1`,
  accountId: identity.accountId,
  deviceId: identity.deviceId,
  missionId: identity.missionId,
});
const aad = (value: Record<string, string>) =>
  Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).sort())));

export class RemoteMissionVault {
  private readonly kms: KmsPort;
  constructor(
    private readonly objects: CheckpointObjectPort,
    private readonly keyId: string,
    kms?: KmsPort,
  ) {
    this.kms = kms ?? new KMSClient({});
  }

  objectKey(identity: RemoteMissionIdentity) {
    return `v1/accounts/${identity.accountId}/devices/${identity.deviceId}/missions/${identity.missionId}`;
  }

  resultObjectKey(
    identity: RemoteMissionIdentity,
    outcome?: RemoteMissionResultV1["outcome"],
  ) {
    return `${this.objectKey(identity)}/result${outcome ? `/${outcome}` : ""}`;
  }

  progressObjectKey(
    identity: RemoteMissionIdentity,
    state?: RemoteMissionProgressV1["state"],
  ) {
    return `${this.objectKey(identity)}/progress${state ? `/${state}` : ""}`;
  }

  approvalDecisionObjectKey(identity: RemoteMissionIdentity) {
    return `${this.objectKey(identity)}/approval-decision`;
  }

  targetDecisionObjectKey(identity: RemoteMissionIdentity) {
    return `${this.objectKey(identity)}/target-decision`;
  }

  supervisorDecisionObjectKey(identity: RemoteMissionIdentity) {
    return `${this.objectKey(identity)}/supervisor-decision`;
  }

  async encryptAndPut(
    identity: RemoteMissionIdentity,
    payload: RemoteMissionPayloadV1,
  ) {
    return this.encryptObject(identity, "payload", this.objectKey(identity), payload);
  }

  async encryptResultAndPut(
    identity: RemoteMissionIdentity,
    result: RemoteMissionResultV1,
  ) {
    const objectKey = this.resultObjectKey(identity, result.outcome);
    try {
      return await this.encryptObject(identity, "result", objectKey, result);
    } catch (error) {
      if ((error as Error).message !== "checkpoint_object_exists") throw error;
      const existing = await this.getResultAndDecrypt(identity, result.outcome);
      if (existing.missionId !== result.missionId || existing.outcome !== result.outcome)
        throw new Error("remote_mission_result_conflict");
      return { ciphertextSizeBytes: 0, ciphertextSha256: "" };
    }
  }

  async encryptProgressAndPut(
    identity: RemoteMissionIdentity,
    progress: RemoteMissionProgressV1,
  ) {
    const objectKey = this.progressObjectKey(identity, progress.state);
    try {
      return await this.encryptObject(identity, "progress", objectKey, progress);
    } catch (error) {
      if ((error as Error).message !== "checkpoint_object_exists") throw error;
      const existing = await this.getProgressAndDecrypt(identity, progress.state);
      if (existing.missionId !== progress.missionId || existing.state !== progress.state)
        throw new Error("remote_mission_progress_conflict");
      return { ciphertextSizeBytes: 0, ciphertextSha256: "" };
    }
  }

  async replaceSupervisionProgressAndPut(
    identity: RemoteMissionIdentity,
    progress: RemoteMissionProgressV1,
  ) {
    if (progress.state !== "supervision_required" || !progress.evidence)
      throw new Error("remote_mission_supervision_progress_invalid");
    const objectKey = this.progressObjectKey(identity, progress.state);
    const existing = await this.getProgressAndDecrypt(identity, progress.state).catch(() => null);
    if (existing?.evidence?.attemptId === progress.evidence?.attemptId)
      return { ciphertextSizeBytes: 0, ciphertextSha256: "" };
    await this.objects.delete(this.supervisorDecisionObjectKey(identity)).catch(() => undefined);
    return this.encryptObject(identity, "progress", objectKey, progress, true);
  }

  async encryptApprovalDecisionAndPut(
    identity: RemoteMissionIdentity,
    decision: RemoteMissionApprovalDecisionV1,
  ) {
    const objectKey = this.approvalDecisionObjectKey(identity);
    try {
      return await this.encryptObject(
        identity,
        "approval-decision",
        objectKey,
        decision,
      );
    } catch (error) {
      if ((error as Error).message !== "checkpoint_object_exists") throw error;
      const existing = await this.getApprovalDecisionAndDecrypt(identity);
      if (
        existing.missionId !== decision.missionId ||
        existing.approvalId !== decision.approvalId ||
        existing.actionDigest !== decision.actionDigest ||
        existing.approved !== decision.approved
      ) throw new Error("remote_mission_approval_decision_conflict");
      return { ciphertextSizeBytes: 0, ciphertextSha256: "" };
    }
  }

  async encryptTargetDecisionAndPut(
    identity: RemoteMissionIdentity,
    decision: RemoteMissionTargetDecisionV1,
  ) {
    const objectKey = this.targetDecisionObjectKey(identity);
    try {
      return await this.encryptObject(identity, "target-decision", objectKey, decision);
    } catch (error) {
      if ((error as Error).message !== "checkpoint_object_exists") throw error;
      const existing = await this.getTargetDecisionAndDecrypt(identity);
      if (
        existing.missionId !== decision.missionId ||
        existing.targetHandle !== decision.targetHandle
      ) throw new Error("remote_mission_target_decision_conflict");
      return { ciphertextSizeBytes: 0, ciphertextSha256: "" };
    }
  }

  async encryptSupervisorDecisionAndPut(
    identity: RemoteMissionIdentity,
    decision: RemoteMissionSupervisorDecisionV1,
  ) {
    const objectKey = this.supervisorDecisionObjectKey(identity);
    try {
      return await this.encryptObject(identity, "supervisor-decision", objectKey, decision);
    } catch (error) {
      if ((error as Error).message !== "checkpoint_object_exists") throw error;
      const existing = await this.getSupervisorDecisionAndDecrypt(identity);
      if (existing.decisionId !== decision.decisionId || existing.kind !== decision.kind)
        throw new Error("remote_mission_supervisor_decision_conflict");
      return { ciphertextSizeBytes: 0, ciphertextSha256: "" };
    }
  }

  private async encryptObject(
    identity: RemoteMissionIdentity,
    purpose: "payload" | "progress" | "result" | "approval-decision" | "target-decision" | "supervisor-decision",
    objectKey: string,
    value:
      | RemoteMissionPayloadV1
      | RemoteMissionProgressV1
      | RemoteMissionResultV1
      | RemoteMissionApprovalDecisionV1
      | RemoteMissionTargetDecisionV1
      | RemoteMissionSupervisorDecisionV1,
    replace = false,
  ) {
    const plaintext = Buffer.from(JSON.stringify(value));
    if (plaintext.byteLength < 1 || plaintext.byteLength > MAX_PAYLOAD_BYTES)
      throw new Error("remote_mission_size_invalid");
    const encryptionContext = context(identity, purpose);
    const generated = await this.kms.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: "AES_256",
        EncryptionContext: encryptionContext,
      }),
    );
    if (!generated.Plaintext || !generated.CiphertextBlob)
      throw new Error("kms_data_key_unavailable");
    const key = Buffer.from(generated.Plaintext);
    try {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad(encryptionContext));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const envelope: MissionEnvelopeV1 = {
        version: 1,
        algorithm: ALGORITHM,
        encryptedDataKey: Buffer.from(generated.CiphertextBlob).toString("base64"),
        nonce: nonce.toString("base64"),
        authenticationTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      };
      const body = Buffer.from(JSON.stringify(envelope));
      if (replace && this.objects.replace) await this.objects.replace(objectKey, body);
      else {
        if (replace) await this.objects.delete(objectKey).catch(() => undefined);
        await this.objects.put(objectKey, body);
      }
      return {
        ciphertextSizeBytes: body.byteLength,
        ciphertextSha256: createHash("sha256").update(body).digest("hex"),
      };
    } finally {
      key.fill(0);
      Buffer.from(generated.Plaintext).fill(0);
    }
  }

  async getAndDecrypt(
    identity: RemoteMissionIdentity,
  ): Promise<RemoteMissionPayloadV1> {
    return this.decryptObject<RemoteMissionPayloadV1>(
      identity,
      "payload",
      this.objectKey(identity),
    );
  }

  async getResultAndDecrypt(
    identity: RemoteMissionIdentity,
    outcome?: RemoteMissionResultV1["outcome"],
  ): Promise<RemoteMissionResultV1> {
    if (outcome) {
      try {
        return await this.decryptObject<RemoteMissionResultV1>(
          identity,
          "result",
          this.resultObjectKey(identity, outcome),
        );
      } catch {
        // Compatibility for terminal artifacts written before outcome-addressed
        // keys were introduced.
      }
    }
    return this.decryptObject<RemoteMissionResultV1>(
      identity,
      "result",
      this.resultObjectKey(identity),
    );
  }

  async getProgressAndDecrypt(
    identity: RemoteMissionIdentity,
    state?: RemoteMissionProgressV1["state"],
  ): Promise<RemoteMissionProgressV1> {
    if (state) {
      try {
        return await this.decryptObject<RemoteMissionProgressV1>(
          identity,
          "progress",
          this.progressObjectKey(identity, state),
        );
      } catch {
        // Compatibility for the brief pre-state-addressed progress format.
      }
    }
    return this.decryptObject<RemoteMissionProgressV1>(
      identity,
      "progress",
      this.progressObjectKey(identity),
    );
  }

  async getApprovalDecisionAndDecrypt(
    identity: RemoteMissionIdentity,
  ): Promise<RemoteMissionApprovalDecisionV1> {
    return this.decryptObject<RemoteMissionApprovalDecisionV1>(
      identity,
      "approval-decision",
      this.approvalDecisionObjectKey(identity),
    );
  }

  async getTargetDecisionAndDecrypt(
    identity: RemoteMissionIdentity,
  ): Promise<RemoteMissionTargetDecisionV1> {
    return this.decryptObject<RemoteMissionTargetDecisionV1>(
      identity,
      "target-decision",
      this.targetDecisionObjectKey(identity),
    );
  }

  async getSupervisorDecisionAndDecrypt(
    identity: RemoteMissionIdentity,
  ): Promise<RemoteMissionSupervisorDecisionV1> {
    return this.decryptObject<RemoteMissionSupervisorDecisionV1>(
      identity,
      "supervisor-decision",
      this.supervisorDecisionObjectKey(identity),
    );
  }

  private async decryptObject<T>(
    identity: RemoteMissionIdentity,
    purpose: "payload" | "progress" | "result" | "approval-decision" | "target-decision" | "supervisor-decision",
    objectKey: string,
  ): Promise<T> {
    const body = await this.objects.get(objectKey);
    let envelope: MissionEnvelopeV1;
    try {
      envelope = JSON.parse(Buffer.from(body).toString("utf8")) as MissionEnvelopeV1;
    } catch {
      throw new Error("remote_mission_envelope_invalid");
    }
    if (envelope.version !== 1 || envelope.algorithm !== ALGORITHM)
      throw new Error("remote_mission_envelope_invalid");
    const encryptionContext = context(identity, purpose);
    const decrypted = await this.kms.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: Buffer.from(envelope.encryptedDataKey, "base64"),
        EncryptionContext: encryptionContext,
      }),
    );
    if (!decrypted.Plaintext) throw new Error("kms_decrypt_unavailable");
    const key = Buffer.from(decrypted.Plaintext);
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.nonce, "base64"),
      );
      decipher.setAAD(aad(encryptionContext));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8")) as T;
    } finally {
      key.fill(0);
      Buffer.from(decrypted.Plaintext).fill(0);
    }
  }

  async delete(identity: RemoteMissionIdentity) {
    const keys = [
      this.objectKey(identity),
      this.progressObjectKey(identity),
      ...(["accepted", "running", "target_selection_required", "supervision_required", "approval_required"] as const).map(
        (state) => this.progressObjectKey(identity, state),
      ),
      this.resultObjectKey(identity),
      this.approvalDecisionObjectKey(identity),
      this.targetDecisionObjectKey(identity),
      this.supervisorDecisionObjectKey(identity),
      ...(["completed", "not_achieved", "cancelled", "unknown"] as const).map(
        (outcome) => this.resultObjectKey(identity, outcome),
      ),
    ];
    for (const key of keys) {
      if (this.objects.deleteAllVersions) await this.objects.deleteAllVersions(key);
      else await this.objects.delete(key);
    }
  }
}
