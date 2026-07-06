/**
 * CheckpointCoordinator (RFC LP-15, Phase 2).
 *
 * Owns the MutationLedger (dedupe/replay of mutation-sensitive tool calls) and
 * the durable turn-checkpoint storage boundary. The agent loop still maps its
 * own turn state into/out of a TurnCheckpoint — that state is inherently
 * loop-coupled — but the ledger and the persistence I/O live here.
 *
 * Owning the ledger here is deliberate: Phase 8 seals dry-run commits through
 * `recordMutation`. The constructor takes a PersistencePort (chrome impl by
 * default), making this the first consumer of the environment port layer and
 * seeding Phase 3's PersistencePort adoption.
 */

import type { DomSnapshot, ToolName } from "../../types";
import { chromePersistencePort } from "../environment/chrome";
import type { PersistencePort } from "../environment/types";
import { turnCheckpointKey, type TurnCheckpoint } from "./checkpoint-types";
import { MutationLedger, type MutationReplayHit } from "./mutation-ledger";

export class CheckpointCoordinator {
  readonly ledger: MutationLedger;

  constructor(
    private readonly persistence: PersistencePort = chromePersistencePort,
    ledger?: MutationLedger,
  ) {
    this.ledger = ledger ?? new MutationLedger();
  }

  get entries() {
    return this.ledger.entries;
  }

  get sideEffects() {
    return this.ledger.sideEffects;
  }

  /** Replay lookup for a mutation-sensitive tool call (ledger + ephemeral tiers). */
  lookupReplay(
    toolName: ToolName,
    args: Record<string, unknown>,
    snapshot: DomSnapshot | null | undefined,
    guardAfterDoneRejection: boolean,
  ): MutationReplayHit | null {
    return this.ledger.lookup(
      toolName,
      args,
      snapshot,
      guardAfterDoneRejection,
    );
  }

  recordMutation(params: Parameters<MutationLedger["record"]>[0]): void {
    this.ledger.record(params);
  }

  restoreLedger(entries: unknown, sideEffects: unknown): void {
    this.ledger.restore(entries, sideEffects);
  }

  clearReplayState(): void {
    this.ledger.clearReplayState();
  }

  clearStepLedger(): void {
    this.ledger.clearStepLedger();
  }

  clearEphemeral(): void {
    this.ledger.clearEphemeral();
  }

  /** Persist a turn checkpoint for the given node. */
  async persist(
    workspaceId: string,
    nodeId: string,
    checkpoint: TurnCheckpoint,
  ): Promise<void> {
    const key = turnCheckpointKey(workspaceId, nodeId);
    await this.persistence.local.set({ [key]: checkpoint });
  }

  /** Load a persisted turn checkpoint, or null if absent. */
  async load(
    workspaceId: string,
    nodeId: string,
  ): Promise<TurnCheckpoint | null> {
    const key = turnCheckpointKey(workspaceId, nodeId);
    const stored = await this.persistence.local.get(key);
    const value = stored?.[key];
    return value ? (value as TurnCheckpoint) : null;
  }

  /** Delete the turn checkpoint for the given node (terminal states). */
  async clear(workspaceId: string, nodeId: string): Promise<void> {
    const key = turnCheckpointKey(workspaceId, nodeId);
    await this.persistence.local.remove(key);
  }
}
