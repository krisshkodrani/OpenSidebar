/**
 * Form-submit dry-run orchestration (RFC LP-15 Phase 8; relocated from
 * AgentLoop in pi-backend Phase 4 as a loop.ts ratchet extraction).
 *
 * Before a consequential form submit, capture the live form state and diff it
 * against the approved draft (the `form_fill` contract derived from the
 * objective). The classification enriches the human approval — it never
 * bypasses it. Dispatch-host idiom: callers pass the AgentLoop as host;
 * behavior-preserving move of the original method body.
 */

import { ToolName } from "../../types";
import type { DomSnapshot, FormStateCapture } from "../../types";
import { executeContentTool } from "../tools/bridge";
import {
  buildFormStateCapturedEvidence,
  classifyFormSubmitDryRun,
  type DryRunClassification,
} from "./mutation-dry-run-policy";
import { generateCompletionContract } from "./completion-kernel";

export interface FormSubmitDryRunHost {
  readonly originalQuery: string;
  readonly turnCount: number;
  readonly lastPlanIndex: number;
  readonly context: { getSnapshot(): DomSnapshot | null };
  readonly log: {
    warn(scope: string, message: string, data?: Record<string, unknown>): void;
  };
  readonly completionEvidence: {
    add(evidence: ReturnType<typeof buildFormStateCapturedEvidence>): void;
  };
  readonly traceRecorder?: {
    recordEvent(type: string, data: Record<string, unknown>): void;
  } | null;
  readonly checkpoints: {
    recordMutation(entry: {
      toolName: ToolName;
      args: Record<string, unknown>;
      result: string;
      planIndex: number;
      turn: number;
      formSubmitSeal?: { formKey: string; diffHash: string };
    }): void;
  };
}

export async function runFormSubmitDryRun(
  host: FormSubmitDryRunHost,
  toolName: ToolName,
  args: Record<string, unknown>,
  tabId: number,
): Promise<DryRunClassification> {
  const generated = generateCompletionContract({
    userRequest: host.originalQuery,
    snapshot: host.context.getSnapshot(),
  });
  const draft =
    generated?.contract.kind === "form_fill"
      ? generated.contract.requiredFields
      : null;
  if (!draft || draft.length === 0) return { kind: "no_draft" };

  const submitId =
    typeof (args as { id?: unknown }).id === "number"
      ? (args as { id: number }).id
      : undefined;
  let capture: FormStateCapture | null = null;
  try {
    const result = await executeContentTool(
      ToolName.EXTRACT_FORM_STATE,
      submitId != null ? { id: submitId } : {},
      tabId,
    );
    capture = JSON.parse(result) as FormStateCapture;
  } catch (err) {
    host.log.warn("agent", "form dry-run capture failed", {
      turn: host.turnCount,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const classification = classifyFormSubmitDryRun(capture, draft);
  if (capture) {
    host.completionEvidence.add(
      buildFormStateCapturedEvidence(capture, host.turnCount),
    );
  }
  host.traceRecorder?.recordEvent("form_submit_dry_run", {
    turn: host.turnCount,
    tool: toolName,
    kind: classification.kind,
    formKey: capture?.formKey,
    diffHash:
      classification.kind === "no_draft"
        ? undefined
        : classification.diff.diffHash,
  });

  // Seal the dry-run (RFC LP-15 Phase 8: commit → seal): record the form +
  // approved-diff digest so a replay recognizes this submit was dry-run
  // verified and does not re-run it blindly.
  if (capture && classification.kind !== "no_draft") {
    host.checkpoints.recordMutation({
      toolName,
      args,
      result: `form_dry_run:${classification.kind}`,
      planIndex: host.lastPlanIndex,
      turn: host.turnCount,
      formSubmitSeal: {
        formKey: capture.formKey,
        diffHash: classification.diff.diffHash,
      },
    });
  }
  return classification;
}
