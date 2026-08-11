import type {
  CheckpointCompatibility,
  PortableCheckpointV1,
  RestoreGroundingResult,
} from "@shared-types/cloud-sessions";
import {
  checkpointCompatibility,
  classifyRestoreGrounding,
  migratePortableCheckpoint,
  validatePortableCheckpoint,
} from "@shared-types/portable-checkpoint-policy";
import type { CloudCheckpointPort } from "../environment/cloud-checkpoint-port";
import type { PortableCheckpointLocalPort } from "../environment/portable-checkpoint-local-port";

export type RestoreObservation = {
  url?: string;
  title?: string;
  pageFingerprint?: string;
  available: boolean;
  authorized: boolean;
};

export type PortableRestorePreview = {
  state: "restored_paused";
  localWorkspaceId: string;
  runId: string;
  checkpoint: PortableCheckpointV1;
  compatibility: CheckpointCompatibility;
  grounding: RestoreGroundingResult;
  changedStateWarning: boolean;
  historicalElementReferencesInvalidated: true;
  requiresFreshApproval: boolean;
  requiresOutcomeClarification: boolean;
  completed: string[];
  remaining: string[];
};

export class PreparedPortableRestore {
  private current: "restored_paused" | "running" = "restored_paused";
  constructor(readonly preview: PortableRestorePreview) {}
  get state() { return this.current; }
  continueAfterUserConfirmation(outcomeResolution?: string) {
    if (this.current !== "restored_paused") throw new Error("restore_already_continued");
    const resolution = outcomeResolution?.trim();
    if (this.preview.requiresOutcomeClarification && !resolution)
      throw new Error("restore_outcome_clarification_required");
    this.current = "running";
    return {
      checkpoint: this.preview.checkpoint,
      localWorkspaceId: this.preview.localWorkspaceId,
      runId: this.preview.runId,
      requiresFreshApproval: this.preview.requiresFreshApproval,
      requiresOutcomeClarification: this.preview.requiresOutcomeClarification,
      ...(resolution ? { outcomeResolution: resolution } : {}),
    };
  }
}

export class PortableCheckpointCoordinator {
  constructor(
    private readonly local: PortableCheckpointLocalPort,
    private readonly cloud: CloudCheckpointPort,
    private readonly runtimeVersion: string,
  ) {}

  async saveLocalThenUpload(sessionRevision: number, checkpoint: PortableCheckpointV1) {
    const validation = validatePortableCheckpoint(checkpoint);
    if (!validation.valid) throw new Error(`portable_checkpoint_${validation.code}`);
    await this.local.save(validation.value);
    if (!this.cloud.enabled)
      return { state: "local_only" as const, checkpoint: validation.value };
    try {
      const committed = await this.cloud.upload(sessionRevision, validation.value);
      return committed
        ? { state: "synced" as const, checkpoint: validation.value, committed }
        : { state: "local_only" as const, checkpoint: validation.value };
    } catch (error) {
      return { state: "sync_failed" as const, checkpoint: validation.value, error };
    }
  }

  async prepareRestore(input: {
    sessionId: string;
    checkpointId: string;
    observation: RestoreObservation;
    preferLocal?: boolean;
  }) {
    let checkpoint: PortableCheckpointV1 | null = null;
    if (input.preferLocal !== false)
      checkpoint = await this.local.load(input.sessionId, input.checkpointId);
    if (!checkpoint && this.cloud.enabled)
      checkpoint = await this.cloud.restore(input.sessionId, input.checkpointId);
    if (!checkpoint) throw new Error("portable_checkpoint_not_found");
    const sourceSchemaVersion = Number(
      (checkpoint as unknown as { schemaVersion?: unknown }).schemaVersion,
    );
    const sourceRuntimeVersion = String(
      (checkpoint as unknown as { runtimeVersion?: unknown }).runtimeVersion ?? "",
    );
    const compatibility = checkpointCompatibility(
      sourceSchemaVersion,
      sourceRuntimeVersion,
      this.runtimeVersion,
    );
    if (compatibility !== "compatible" && compatibility !== "migratable_previous")
      throw new Error(`portable_checkpoint_${compatibility}`);
    const validation = migratePortableCheckpoint(checkpoint);
    if (!validation.valid) throw new Error("portable_checkpoint_corrupt");
    const grounding = classifyRestoreGrounding(validation.value, input.observation);
    const pending = validation.value.pending;
    return new PreparedPortableRestore({
      state: "restored_paused",
      localWorkspaceId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      checkpoint: validation.value,
      compatibility,
      grounding,
      changedStateWarning: grounding !== "matched",
      historicalElementReferencesInvalidated: true,
      requiresFreshApproval: pending.kind === "approval_required",
      requiresOutcomeClarification: pending.kind === "browser_result_unknown",
      completed: validation.value.execution.plan.filter((step) => step.status === "completed").map((step) => step.description),
      remaining: validation.value.execution.plan.filter((step) => step.status !== "completed").map((step) => step.description),
    });
  }
}
