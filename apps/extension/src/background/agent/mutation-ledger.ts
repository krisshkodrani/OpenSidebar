import type { DomSnapshot, ToolName } from "../../types";
import { MUTATION_SENSITIVE_TOOLS } from "../tools/metadata";
import {
  buildMutationKey,
  type MutationLedgerEntry,
  type SideEffectEntry,
} from "./checkpoint-types";
import { djb2, getSnapshotFingerprint } from "./loop-helpers";

const MAX_LEDGER_ENTRIES = 50;
const MAX_SIDE_EFFECTS = 100;

export type MutationReplaySource = "ledger" | "ephemeral";

export interface MutationReplayHit {
  result: string;
  source: MutationReplaySource;
}

export function getMutationReplayFingerprint(
  snapshot: DomSnapshot | null | undefined,
): string {
  const base = getSnapshotFingerprint(snapshot ?? null);
  if (!snapshot) return base;

  const pageText =
    `${snapshot.pageContent ?? ""}\n${snapshot.visibleContent ?? ""}`.trim();
  const elementSignature = (snapshot.elements ?? [])
    .slice(0, 120)
    .map((element) => {
      const attributes = element.attributes ?? {};
      const attributeText = [
        attributes["aria-label"],
        attributes.placeholder,
        attributes.value,
        attributes.title,
        attributes.href,
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" ");
      return [
        element.tag,
        element.tagName,
        element.role ?? "",
        element.text ?? "",
        attributeText,
        element.isDisabled ? "disabled" : "enabled",
      ]
        .join(":")
        .replace(/\s+/g, " ")
        .slice(0, 180);
    })
    .join("|");

  return pageText || elementSignature
    ? `${base}|elements:${djb2(elementSignature)}`
    : base;
}

export function getMutationReplayScopedKey(
  mutationKey: string,
  snapshot: DomSnapshot | null | undefined,
): string {
  return `${mutationKey}@${getMutationReplayFingerprint(snapshot)}`;
}

export class MutationLedger {
  private executedActions = new Map<string, string>();
  private stepMutationLedger: MutationLedgerEntry[] = [];
  private sideEffectsLog: SideEffectEntry[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  get entries(): MutationLedgerEntry[] {
    return this.stepMutationLedger;
  }

  get sideEffects(): SideEffectEntry[] {
    return this.sideEffectsLog;
  }

  restore(stepMutationLedger: unknown, sideEffectsLog: unknown): void {
    this.stepMutationLedger = Array.isArray(stepMutationLedger)
      ? stepMutationLedger
      : [];
    this.sideEffectsLog = Array.isArray(sideEffectsLog) ? sideEffectsLog : [];
  }

  clearStepLedger(): void {
    this.stepMutationLedger = [];
  }

  clearEphemeral(): void {
    this.executedActions.clear();
  }

  clearReplayState(): void {
    this.clearEphemeral();
    this.clearStepLedger();
  }

  lookup(
    toolName: ToolName,
    args: Record<string, unknown>,
    snapshot: DomSnapshot | null | undefined,
    guardAfterDoneRejection: boolean,
  ): MutationReplayHit | null {
    if (!MUTATION_SENSITIVE_TOOLS.has(toolName)) return null;

    const mutationKey = buildMutationKey(toolName, args);
    const currentFingerprint = getMutationReplayFingerprint(snapshot);
    const ledgerHit = this.stepMutationLedger.find(
      (entry) =>
        entry.key === mutationKey &&
        entry.snapshotFingerprint === currentFingerprint,
    );
    if (ledgerHit) {
      return { result: ledgerHit.result, source: "ledger" };
    }

    const ephemeralHit = guardAfterDoneRejection
      ? this.executedActions.get(
          getMutationReplayScopedKey(mutationKey, snapshot),
        )
      : null;
    if (ephemeralHit) {
      return { result: ephemeralHit, source: "ephemeral" };
    }

    return null;
  }

  record(params: {
    toolName: ToolName;
    args: Record<string, unknown>;
    result: string;
    actionSnapshot?: DomSnapshot | null;
    currentSnapshot?: DomSnapshot | null;
    planIndex: number;
    turn: number;
  }): void {
    const {
      toolName,
      args,
      result,
      actionSnapshot,
      currentSnapshot,
      planIndex,
      turn,
    } = params;
    if (!MUTATION_SENSITIVE_TOOLS.has(toolName)) return;

    const mutationKey = buildMutationKey(toolName, args);
    const snapshotForReplay = actionSnapshot ?? currentSnapshot ?? null;
    const replayFingerprint = getMutationReplayFingerprint(snapshotForReplay);
    this.executedActions.set(
      getMutationReplayScopedKey(mutationKey, snapshotForReplay),
      result,
    );

    const ledgerEntry: MutationLedgerEntry = {
      key: mutationKey,
      toolName,
      args,
      result: result.slice(0, 500),
      recordedAt: this.now(),
      planIndex,
      snapshotFingerprint: replayFingerprint,
    };
    const existingEntryIndex = this.stepMutationLedger.findIndex(
      (entry) => entry.key === mutationKey,
    );
    if (existingEntryIndex >= 0) {
      this.stepMutationLedger[existingEntryIndex] = ledgerEntry;
    } else {
      this.stepMutationLedger.push(ledgerEntry);
      if (this.stepMutationLedger.length > MAX_LEDGER_ENTRIES) {
        this.stepMutationLedger = this.stepMutationLedger.slice(
          -MAX_LEDGER_ENTRIES,
        );
      }
    }

    this.sideEffectsLog.push({
      id: this.createId(),
      turn,
      planIndex,
      toolName,
      args,
      result: result.slice(0, 300),
      timestamp: this.now(),
      snapshotFingerprint: getSnapshotFingerprint(currentSnapshot ?? null),
    });
    if (this.sideEffectsLog.length > MAX_SIDE_EFFECTS) {
      this.sideEffectsLog = this.sideEffectsLog.slice(-MAX_SIDE_EFFECTS);
    }
  }
}
