/**
 * Pending-user-interaction timing helpers (RFC LP-16 Phase 5). Compute the
 * remaining wait and whether a pending interaction has resolved. Pure —
 * verbatim movement of Orchestrator helpers.
 */
import type { PendingUserInteraction } from "../agent/loop-types";

export function getPendingInteractionRemainingMs(
  interaction: PendingUserInteraction,
): number {
  return Math.max(
    0,
    interaction.timeoutMs - (Date.now() - interaction.requestedAt),
  );
}

export function isPendingInteractionResolved(
  interaction: PendingUserInteraction | undefined,
): boolean {
  if (!interaction) return false;
  return interaction.kind === "approval"
    ? typeof interaction.approved === "boolean"
    : typeof interaction.answer === "string";
}
