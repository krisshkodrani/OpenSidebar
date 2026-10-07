import type { RuntimeMessagingPort } from "../environment/types";
import type { PlanConfirmationRequestMessage } from "../../types";
import type { TaskPausedPayload } from "../runtime";

/** Bridges plan review through the same workspace-bound approval channel as actions. */
export class PlanApprovalBridge {
  private pending = new Map<string, { workspaceId: string; expiresAt: number }>();
  constructor(
    private readonly messaging: RuntimeMessagingPort,
    private readonly respond: (payload: { confirmationId: string; decision: "approve" | "cancel" }) => boolean,
    private readonly now = Date.now,
  ) {}

  observe(listener: (workspaceId: string, payload: TaskPausedPayload) => void): () => void {
    return this.messaging.onMessage((value) => {
      const message = value as Partial<PlanConfirmationRequestMessage>;
      if (message.type !== "PLAN_CONFIRMATION_REQUEST" || !message.workspaceId || !message.payload) return;
      const { confirmationId, nodes } = message.payload;
      const requestedAt = this.now();
      const expiresAt = requestedAt + 10 * 60_000;
      this.pending.set(confirmationId, { workspaceId: message.workspaceId, expiresAt });
      listener(message.workspaceId, {
        taskId: confirmationId,
        interaction: {
          kind: "approval", approvalId: confirmationId, toolName: "review_plan",
          args: { steps: nodes.map((node) => node.description) },
          context: `Review the browser plan before starting:\n${nodes.map((node, index) => `${index + 1}. ${node.description}`).join("\n")}`,
          requestedAt, expiresAt, timeoutMs: expiresAt - requestedAt,
        },
      });
    });
  }

  resolve(workspaceId: string, approvalId: string, approved: boolean): boolean | undefined {
    const entry = this.pending.get(approvalId);
    if (!entry) return undefined;
    if (entry.workspaceId !== workspaceId) return false;
    this.pending.delete(approvalId);
    if (this.now() >= entry.expiresAt) {
      this.respond({ confirmationId: approvalId, decision: "cancel" });
      return false;
    }
    return this.respond({ confirmationId: approvalId, decision: approved ? "approve" : "cancel" });
  }
}
