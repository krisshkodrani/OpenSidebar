import type {
  CloudCheckpointIndexV1,
  CloudSessionV1,
} from "@shared-types/cloud-sessions";
import type {
  CloudRestoreContinueResponse,
  CloudRestoreListResponse,
  CloudRestorePrepareResponse,
} from "@shared-types/messages/session";
import type { DomSnapshotResponse } from "@shared-types/messages/content-protocol";
import { MessageSource } from "../../types";
import { computeSnapshotFingerprint } from "../agent/stagnation";
import type { BrowserPagePort, ContentBridgePort } from "../environment/types";
import type { CloudAuthenticatedFetch } from "../../cloud/authenticated-fetch";
import { PortableCheckpointCoordinator, type PreparedPortableRestore } from "./portable-restore";

type PendingRestore = {
  prepared: PreparedPortableRestore;
  tabId: number;
  observation: {
    url?: string;
    title?: string;
    pageFingerprint?: string;
    available: boolean;
    authorized: boolean;
  };
};

type ContinueInput = ReturnType<PreparedPortableRestore["continueAfterUserConfirmation"]>;

export function buildPortableRestoreQuery(input: ContinueInput): string {
  const checkpoint = input.checkpoint;
  const completed = checkpoint.execution.plan
    .filter((step) => step.status === "completed")
    .map((step) => `- ${step.description}`)
    .join("\n") || "- None recorded";
  const remaining = checkpoint.execution.plan
    .filter((step) => step.status !== "completed")
    .map((step) => `- ${step.description}`)
    .join("\n") || "- Verify whether the objective is already complete";
  const safety = input.requiresOutcomeClarification
    ? `The previous browser action has an unknown outcome: ${checkpoint.pending.kind === "browser_result_unknown" ? checkpoint.pending.actionSummary : "unknown action"}. The user reported: ${input.outcomeResolution}. Verify this against the live page before deciding whether any action is still needed; never blindly repeat it.`
    : input.requiresFreshApproval
      ? `The prior checkpoint was waiting for approval. Treat it as unapproved and request fresh approval with current action details before any sensitive action.`
      : "Re-plan from the freshly observed page and do not reuse historical element references.";
  return [
    checkpoint.objective.currentInterpretation,
    "",
    "This task was restored from a portable checkpoint after explicit user confirmation.",
    "Completed before the checkpoint:",
    completed,
    "Remaining work:",
    remaining,
    `Restore safety requirement: ${safety}`,
  ].join("\n");
}

export type CloudRestoreControllerDeps = {
  enabled: boolean;
  cloud: CloudAuthenticatedFetch;
  checkpoints: PortableCheckpointCoordinator;
  pages: BrowserPagePort;
  content: ContentBridgePort;
  isPageAuthorized(url: string): Promise<boolean>;
  continueRestore(input: ContinueInput & { tabId: number }): Promise<{ workspaceId: string }>;
};

const messageFor = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === "cloud_sign_in_required" || code === "cloud_session_expired")
    return "Sign in to OpenSidebar Cloud again before restoring.";
  if (code.includes("not_found")) return "That checkpoint is no longer available.";
  if (code.includes("unauthorized")) return "Open a permitted page before restoring.";
  return "The checkpoint could not be restored.";
};

export class CloudRestoreController {
  private readonly pending = new Map<string, PendingRestore>();

  constructor(private readonly deps: CloudRestoreControllerDeps) {}

  private async observe(tabId: number) {
    const tab = await this.deps.pages.getTab(tabId);
    const authorized = Boolean(
      tab.url && (await this.deps.isPageAuthorized(tab.url)),
    );
    let available = false;
    let pageFingerprint: string | undefined;
    if (authorized) {
      try {
        const response = await this.deps.content.sendMessage<DomSnapshotResponse>(
          tabId,
          {
            type: "DOM_SNAPSHOT_REQUEST",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            payload: { refresh: true, autoDismiss: false },
          },
        );
        if (response?.payload?.snapshot) {
          available = true;
          pageFingerprint = computeSnapshotFingerprint(response.payload.snapshot);
        }
      } catch {
        available = false;
      }
    }
    return {
      tab,
      observation: {
        url: tab.url,
        title: tab.title,
        pageFingerprint,
        available,
        authorized,
      },
    };
  }

  private disabled<T extends CloudRestoreListResponse | CloudRestorePrepareResponse | CloudRestoreContinueResponse>(): T {
    return {
      ok: false,
      disabled: true,
      detail: "Cloud session restore is not enabled in this build.",
    } as T;
  }

  async list(): Promise<CloudRestoreListResponse> {
    if (!this.deps.enabled) return this.disabled<CloudRestoreListResponse>();
    try {
      const response = await this.deps.cloud.request("/sessions?limit=25");
      if (!response.ok) throw new Error(`session_list_${response.status}`);
      const page = (await response.json()) as { sessions: CloudSessionV1[] };
      const sessions = await Promise.all(
        page.sessions.map(async (session) => {
          if (!session.latestCheckpointId) return { session, checkpoint: null };
          const latest = await this.deps.cloud.request(
            `/sessions/${session.sessionId}/checkpoints/latest`,
          );
          return {
            session,
            checkpoint: latest.ok
              ? ((await latest.json()) as CloudCheckpointIndexV1)
              : null,
          };
        }),
      );
      return { ok: true, sessions };
    } catch (error) {
      return { ok: false, detail: messageFor(error) };
    }
  }

  async prepare(input: {
    sessionId: string;
    checkpointId?: string;
    tabId: number;
  }): Promise<CloudRestorePrepareResponse> {
    if (!this.deps.enabled) return this.disabled<CloudRestorePrepareResponse>();
    try {
      let checkpointId = input.checkpointId;
      if (!checkpointId) {
        const latest = await this.deps.cloud.request(
          `/sessions/${input.sessionId}/checkpoints/latest`,
        );
        if (!latest.ok) throw new Error("portable_checkpoint_not_found");
        checkpointId = ((await latest.json()) as CloudCheckpointIndexV1)
          .checkpointId;
      }
      const { tab, observation } = await this.observe(input.tabId);
      const prepared = await this.deps.checkpoints.prepareRestore({
        sessionId: input.sessionId,
        checkpointId,
        observation,
      });
      const restoreId = crypto.randomUUID();
      this.pending.set(restoreId, {
        prepared,
        tabId: input.tabId,
        observation,
      });
      const preview = prepared.preview;
      return {
        ok: true,
        restoreId,
        preview: {
          state: "restored_paused",
          objective: preview.checkpoint.objective.currentInterpretation,
          completed: preview.completed,
          remaining: preview.remaining,
          grounding: preview.grounding,
          pageTitle: tab.title,
          pageUrl: tab.url,
          changedStateWarning: preview.changedStateWarning,
          requiresFreshApproval: preview.requiresFreshApproval,
          requiresOutcomeClarification: preview.requiresOutcomeClarification,
        },
      };
    } catch (error) {
      return { ok: false, detail: messageFor(error) };
    }
  }

  async continue(
    restoreId: string,
    outcomeResolution?: string,
    beforeStart?: () => Promise<void>,
  ): Promise<CloudRestoreContinueResponse> {
    if (!this.deps.enabled) return this.disabled<CloudRestoreContinueResponse>();
    const pending = this.pending.get(restoreId);
    if (!pending) return { ok: false, detail: "This restore preview has expired." };
    const current = await this.observe(pending.tabId).catch(() => null);
    if (
      !current ||
      JSON.stringify(current.observation) !== JSON.stringify(pending.observation)
    )
      return {
        ok: false,
        detail: "The page changed after the preview. Prepare the restore again.",
      };
    if (
      pending.prepared.preview.grounding === "unavailable" ||
      pending.prepared.preview.grounding === "unauthorized"
    )
      return {
        ok: false,
        detail: "Open a permitted, available page and prepare the restore again.",
      };
    try {
      if (
        pending.prepared.preview.requiresOutcomeClarification &&
        !outcomeResolution?.trim()
      )
        throw new Error("restore_outcome_clarification_required");
      await beforeStart?.();
      const continuation = pending.prepared.continueAfterUserConfirmation(
        outcomeResolution,
      );
      this.pending.delete(restoreId);
      const started = await this.deps.continueRestore({
        ...continuation,
        tabId: pending.tabId,
      });
      return { ok: true, workspaceId: started.workspaceId };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "restore_outcome_clarification_required"
      )
        return {
          ok: false,
          detail: "Explain what happened after the uncertain action before continuing.",
        };
      return { ok: false, detail: messageFor(error) };
    }
  }
}
