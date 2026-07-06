/**
 * Completion effect applier (RFC LP-15, Phase 7a).
 *
 * Translates the declarative `CompletionEffect[]` a pipeline decision carries
 * into the concrete loop-side mutations, via a narrow injected host (the
 * RegionZoomHost pattern — a handful of typed members, never the `any`-typed
 * god-host). Built and unit-tested in 7a; it does not become the authority for
 * completion mutations until 7b (in shadow, legacy still mutates directly).
 *
 * Applying effects in array order preserves the exact mutation order of the
 * legacy reject paths.
 */

import type { CompletionEvaluation } from "../completion-kernel";
import type { CompletionEffect } from "./pipeline-types";

/**
 * The narrow surface `applyCompletionEffects` drives. Each method maps 1:1 to an
 * effect variant; the loop supplies concrete implementations that mutate its
 * own state / call its own collaborators.
 */
export interface CompletionEffectHost {
  incrementDoneRejections(): void;
  /** Update lastContractRejectionKind + the same-kind bounce counter. */
  recordContractRejection(kind: string): void;
  setLastCompletionRejection(decision: CompletionEvaluation): void;
  setRecoveryHint(hint: string | null): void;
  postContextMessage(role: "tool" | "user", content: string): void;
  emitTrace(event: string, data: Record<string, unknown>): void;
  setGuardAfterDoneRejection(): void;
  checkDoneRejectionEscalation(): void;
  forceGroundingRefresh(): Promise<void>;
}

/**
 * Apply the effects in order. Async because `force_grounding_refresh` awaits a
 * snapshot refresh; all other effects are synchronous host calls.
 */
export async function applyCompletionEffects(
  effects: readonly CompletionEffect[],
  host: CompletionEffectHost,
): Promise<void> {
  for (const effect of effects) {
    switch (effect.type) {
      case "increment_done_rejections":
        host.incrementDoneRejections();
        break;
      case "record_contract_rejection":
        host.recordContractRejection(effect.kind);
        break;
      case "set_last_completion_rejection":
        host.setLastCompletionRejection(effect.decision);
        break;
      case "set_recovery_hint":
        host.setRecoveryHint(effect.hint);
        break;
      case "post_context_message":
        host.postContextMessage(effect.role, effect.content);
        break;
      case "emit_trace":
        host.emitTrace(effect.event, effect.data);
        break;
      case "set_guard_after_done_rejection":
        host.setGuardAfterDoneRejection();
        break;
      case "check_done_rejection_escalation":
        host.checkDoneRejectionEscalation();
        break;
      case "force_grounding_refresh":
        await host.forceGroundingRefresh();
        break;
      default: {
        // Exhaustiveness guard: adding a CompletionEffect variant without a
        // handler here is a compile error.
        const _exhaustive: never = effect;
        void _exhaustive;
      }
    }
  }
}
