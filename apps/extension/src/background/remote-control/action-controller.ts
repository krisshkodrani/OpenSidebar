import {
  parseRemoteBrowserAction,
  type RemoteBrowserAction,
  type RemoteBrowserActionRequest,
  type RemoteBrowserActionResult,
  type RemoteBrowserObservation,
} from "@shared-types/remote-browser-control";

export interface DirectControlSession {
  sessionId: string;
  generation: number;
  expiresAt: string;
  mode: "direct" | "task" | "paused" | "closed";
  stopped: boolean;
}
export interface DirectActionAttempt {
  requestId: string;
  digest: string;
  state: "prepared" | "started" | "terminal";
  result?: RemoteBrowserActionResult;
}
export interface DirectControlJournal {
  session(id: string): Promise<DirectControlSession | null>;
  stop(id: string): Promise<void>;
  attempt(
    sessionId: string,
    requestId: string,
  ): Promise<DirectActionAttempt | null>;
  writeAttempt(sessionId: string, value: DirectActionAttempt): Promise<void>;
}
export type DirectActionPermission =
  | { kind: "allowed" }
  | { kind: "denied"; code: string }
  | {
      kind: "approval";
      approvalId: string;
      expiresAt: string;
      description: string;
    };
export interface DirectControlExecution {
  /** Must validate origin, observation identity, element identity and local site policy. */
  ground(
    sessionId: string,
    revision: string,
    action: RemoteBrowserAction,
  ): Promise<boolean>;
  /** Derived locally from current evidence. A caller cannot supply risk or override a denial. */
  authorize(
    sessionId: string,
    action: RemoteBrowserAction,
    digest: string,
  ): Promise<DirectActionPermission>;
  /** Executes through existing browser tools, checking cancellation at the action boundary. */
  dispatch(
    sessionId: string,
    action: RemoteBrowserAction,
    signal: AbortSignal,
  ): Promise<void>;
  observe(sessionId: string): Promise<RemoteBrowserObservation>;
}

async function digestFor(
  request: RemoteBrowserActionRequest,
  action: RemoteBrowserAction,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      sessionId: request.sessionId,
      expectedRevision: request.expectedRevision,
      action,
    }),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}

/** Serializes direct actions. Task/direct target ownership is acquired before opening a session. */
export class RemoteActionController {
  private readonly running = new Map<string, AbortController>();
  private readonly stopped = new Set<string>();
  constructor(
    private readonly journal: DirectControlJournal,
    private readonly execution: DirectControlExecution,
  ) {}

  async stop(sessionId: string) {
    this.stopped.add(sessionId);
    this.running.get(sessionId)?.abort();
    await this.journal.stop(sessionId);
  }

  private async eligible(id: string, generation?: number) {
    const session = await this.journal.session(id);
    if (
      !session ||
      session.stopped ||
      this.stopped.has(id) ||
      session.mode !== "direct" ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      Date.parse(session.expiresAt) <= Date.now() ||
      (generation !== undefined && session.generation !== generation)
    )
      throw new Error("session_not_active");
    return session;
  }

  async act(
    request: RemoteBrowserActionRequest,
  ): Promise<RemoteBrowserActionResult> {
    if (
      !request.requestId?.trim() ||
      request.requestId.length > 200 ||
      !request.expectedRevision?.trim() ||
      request.expectedRevision.length > 200
    )
      throw new Error("invalid_request");
    const action = parseRemoteBrowserAction(request.action);
    if (this.running.has(request.sessionId)) throw new Error("session_busy");
    // Claim synchronously before any asynchronous read to prevent concurrent dispatch.
    const controller = new AbortController();
    this.running.set(request.sessionId, controller);
    try {
      const session = await this.eligible(request.sessionId);
      const digest = await digestFor(request, action);
      const previous = await this.journal.attempt(
        request.sessionId,
        request.requestId,
      );
      if (previous && previous.digest !== digest)
        throw new Error("idempotency_conflict");
      if (previous?.state === "terminal" && previous.result)
        return previous.result;
      if (previous?.state === "started")
        return {
          state: "outcome_unknown",
          code: "interrupted_action_not_retried",
        };
      if (
        !(await this.execution.ground(
          request.sessionId,
          request.expectedRevision,
          action,
        ))
      )
        throw new Error("stale_observation");
      await this.journal.writeAttempt(request.sessionId, {
        requestId: request.requestId,
        digest,
        state: "prepared",
      });
      const permission = await this.execution.authorize(
        request.sessionId,
        action,
        digest,
      );
      if (permission.kind === "denied")
        return { state: "failed", code: permission.code };
      if (permission.kind === "approval")
        return {
          state: "approval_required",
          actionDigest: digest,
          approvalId: permission.approvalId,
          expiresAt: permission.expiresAt,
          description: permission.description,
        };
      await this.journal.writeAttempt(request.sessionId, {
        requestId: request.requestId,
        digest,
        state: "prepared",
      });
      await this.eligible(request.sessionId, session.generation);
      // Permission and grounding may have waited for I/O. Never use stale approval grounding.
      if (controller.signal.aborted)
        return { state: "cancelled", code: "stopped_before_dispatch" };
      if (
        !(await this.execution.ground(
          request.sessionId,
          request.expectedRevision,
          action,
        ))
      )
        throw new Error("stale_observation");
      await this.journal.writeAttempt(request.sessionId, {
        requestId: request.requestId,
        digest,
        state: "started",
      });
      let result: RemoteBrowserActionResult;
      try {
        await this.eligible(request.sessionId, session.generation);
        if (controller.signal.aborted) throw new Error("stopped");
        await this.execution.dispatch(
          request.sessionId,
          action,
          controller.signal,
        );
        // Acknowledgement means the action ran, not that the user's overall task succeeded.
        if (controller.signal.aborted) throw new Error("stopped");
        result = {
          state: "succeeded",
          observation: await this.execution.observe(request.sessionId),
        };
      } catch {
        result = {
          state: "outcome_unknown",
          code: "action_effect_not_verified",
        };
      }
      await this.journal.writeAttempt(request.sessionId, {
        requestId: request.requestId,
        digest,
        state: "terminal",
        result,
      });
      return result;
    } finally {
      this.running.delete(request.sessionId);
    }
  }
}
