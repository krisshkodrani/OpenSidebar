import type {
  AttemptRecordV1,
  BrowserCommandV1,
} from "@shared-types/cloud-sessions";
import type { PersistenceStorageArea } from "../environment/types";
import { createVersionedStore } from "../environment/versioned-store";

export type CommandReconciliation =
  | "accept_new"
  | "resume_before_start"
  | "observe_only"
  | "replay_terminal"
  | "conflict";

type AttemptJournalState = Record<string, AttemptRecordV1>;

const terminalStates = new Set([
  "observed_succeeded",
  "observed_failed",
  "unknown",
]);

export class DeviceAttemptJournal {
  private readonly store;
  private tail: Promise<void> = Promise.resolve();
  constructor(area: PersistenceStorageArea, sessionId: string) {
    this.store = createVersionedStore<AttemptJournalState>(
      area,
      `opensidebar:device-attempts:v1:${sessionId}`,
      { version: 1 },
    );
  }

  async reconcile(
    command: BrowserCommandV1,
    actionDigest: string,
  ): Promise<CommandReconciliation> {
    const record = (await this.store.load())?.[command.commandId];
    if (!record) return "accept_new";
    if (
      record.actionDigest !== actionDigest ||
      record.leaseGeneration !== command.leaseGeneration ||
      record.checkpointRevision !== command.checkpointRevision
    )
      return "conflict";
    if (record.state === "accepted") return "resume_before_start";
    if (record.state === "started") return "observe_only";
    return terminalStates.has(record.state) ? "replay_terminal" : "conflict";
  }

  async record(commandId: string): Promise<AttemptRecordV1 | null> {
    return (await this.store.load())?.[commandId] ?? null;
  }

  async accepted(
    command: BrowserCommandV1,
    attemptId: string,
    actionDigest: string,
  ) {
    return this.exclusive(() =>
      this.write(command, attemptId, actionDigest, "accepted"),
    );
  }

  async started(commandId: string) {
    return this.exclusive(() =>
      this.transition(commandId, ["accepted"], "started"),
    );
  }

  async terminal(
    commandId: string,
    state: "observed_succeeded" | "observed_failed" | "unknown",
  ) {
    return this.exclusive(() => this.transition(commandId, ["started"], state));
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const prior = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await action();
    } finally {
      release();
    }
  }

  private async write(
    command: BrowserCommandV1,
    attemptId: string,
    actionDigest: string,
    state: AttemptRecordV1["state"],
  ) {
    let result: AttemptRecordV1 | undefined;
    await this.store.update((current) => {
      const existing = current?.[command.commandId];
      if (existing) {
        result = existing;
        return current ?? {};
      }
      result = {
        commandId: command.commandId,
        attemptId,
        actionDigest,
        leaseGeneration: command.leaseGeneration,
        checkpointRevision: command.checkpointRevision,
        state,
        updatedAt: Date.now(),
      };
      return { ...(current ?? {}), [command.commandId]: result };
    });
    return result!;
  }

  private async transition(
    commandId: string,
    allowed: AttemptRecordV1["state"][],
    state: AttemptRecordV1["state"],
  ) {
    let result: AttemptRecordV1 | null = null;
    await this.store.update((current) => {
      const existing = current?.[commandId];
      if (!existing || !allowed.includes(existing.state)) return current ?? {};
      result = { ...existing, state, updatedAt: Date.now() };
      return { ...(current ?? {}), [commandId]: result };
    });
    return result;
  }
}
