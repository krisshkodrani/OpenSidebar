/**
 * ServiceNow catalog-order controller (quarantined adapter; extracted from
 * loop.ts — the LP-15 "SN behavior in agent/loop.ts" residue).
 *
 * Trusted completion of catalog-order workflows: recognize the order
 * confirmation page against the requested item/quantity/configuration, track
 * the trusted configured-submission handoff, and auto-submit a fully
 * configured catalog item. Extracted verbatim from AgentLoop via the
 * dispatch-host idiom — every host member is a real AgentLoop field/method,
 * so the loop passes `this`; behavior-preserving. Pairs with
 * catalog-order-policy.ts (the pure text policies).
 */

import {
  AgentStep,
  RiskLevel,
  SessionMetrics,
  ToolCall,
  ToolName,
} from "../../../types";
import type { logger, SessionScopedLogger } from "../../../utils";
import type { ContextManager } from "../context";
import { TraceRecorder } from "../trace";
import type { LoopResult } from "../loop-types";
import type {
  CompletionEnvelope,
  TrustedCompletionCandidate,
} from "../completion-kernel";
import type { TrustedCatalogOrderSubmission } from "./trusted-workflow-adapter";

/**
 * The AgentLoop surface the catalog controller drives. Every member is a real
 * AgentLoop field/method; the loop passes `this`.
 */
export interface ServiceNowCatalogHost {
  readonly turnCount: number;
  readonly originalQuery: string;
  readonly selectedSkillId: string | null;
  readonly context: ContextManager;
  readonly traceRecorder: TraceRecorder | null;
  readonly log: typeof logger | SessionScopedLogger;
  readonly completedResult: {
    outcome: "completed";
    summary: string;
    completionEnvelope?: CompletionEnvelope;
  } | null;
  trustedCatalogOrderSubmission: TrustedCatalogOrderSubmission | null;
  stepHandler: (step: AgentStep, update: boolean) => void;
  executeToolCall(toolCall: ToolCall, tabId: number): Promise<string>;
  completeTaskResult(
    summary: string,
    options?: {
      saveCheckpoint?: boolean;
      completionCandidate?: TrustedCompletionCandidate;
    },
  ): void;
  createTrustedCompletionCandidate(params: {
    workflow: string;
    summary: string;
    reason: string;
    evidenceText?: string;
    recordId?: string;
    targetText?: string;
  }): TrustedCompletionCandidate;
  getMetrics(): SessionMetrics;
  refreshSnapshotWithRetry(tabId: number, prevCount: number): Promise<number>;
}

export function maybeCompleteCatalogOrderFromSnapshot(
  host: ServiceNowCatalogHost,
): LoopResult | null {
  if (host.selectedSkillId !== "catalog-order-workflow") return null;
  const snapshot = host.context.getSnapshot();
  if (!snapshot) return null;
  const pageText = [
    snapshot.title,
    snapshot.url,
    snapshot.visibleContent,
    snapshot.pageContent,
  ]
    .filter(Boolean)
    .join("\n");
  const requestNumber = pageText.match(/\bREQ\d+\b/i)?.[0]?.toUpperCase();
  if (
    !requestNumber ||
    !/\border status\b|\brequest number\b/i.test(pageText)
  ) {
    return null;
  }

  const itemName = extractExpectedCatalogItemNameFromQuery(host);
  const trustedSubmission = getFreshTrustedCatalogOrderSubmission(host);
  if (
    itemName &&
    !pageText.toLowerCase().includes(itemName.toLowerCase()) &&
    !trustedCatalogOrderSubmissionCoversRequest(host, trustedSubmission)
  ) {
    return null;
  }

  const quantity = extractExpectedCatalogQuantityFromQuery(host);
  if (
    quantity &&
    /\bquantity\b/i.test(pageText) &&
    !new RegExp(`\\b${quantity}\\b`).test(pageText)
  ) {
    return null;
  }

  const summaryParts = [`Catalog order submitted: ${requestNumber}.`];
  if (itemName) summaryParts.push(`Item: ${itemName}.`);
  if (quantity) summaryParts.push(`Quantity: ${quantity}.`);
  if (trustedSubmission) {
    summaryParts.push("Requested configuration verified before submission.");
  }
  const summary = summaryParts.join(" ");
  host.completeTaskResult(summary, {
    completionCandidate: host.createTrustedCompletionCandidate({
      workflow: "catalog_order",
      summary,
      reason: "Trusted catalog order confirmation page matched the request.",
      evidenceText: pageText,
      recordId: requestNumber,
      targetText: itemName ?? undefined,
    }),
  });
  host.traceRecorder?.recordEvent("catalog_order_snapshot_completed", {
    turn: host.turnCount,
    requestNumber,
    itemName: itemName ?? null,
    quantity,
  });
  return {
    outcome: "completed",
    turnCount: host.turnCount,
    summary,
    failure: { category: "none", code: "none" },
    metrics: host.getMetrics(),
    completionEnvelope: host.completedResult?.completionEnvelope,
  };
}

function extractExpectedCatalogItemNameFromQuery(
  host: ServiceNowCatalogHost,
): string | null {
  const quotedOrderItem =
    host.originalQuery.match(
      /\b(?:order|request|purchase|buy)\s+\d+\s+"([^"]{3,120})"/i,
    )?.[1] ??
    host.originalQuery.match(
      /\b(?:order|request|purchase|buy|configure)\s+"([^"]{3,120})"/i,
    )?.[1] ??
    host.originalQuery.match(
      /"([^"]{3,120})"\s+(?:from|in)\s+(?:the\s+)?(?:service\s+)?catalog\b/i,
    )?.[1] ??
    null;
  if (quotedOrderItem) return quotedOrderItem.trim();

  const namedItem =
    host.originalQuery.match(
      /\b(?:catalog item|item|product)\s+(?:named|called)\s+(.{3,120}?)(?=\s+(?:with|and|from|in)\b|[.,;\n]|$)/i,
    )?.[1] ?? null;
  return namedItem ? namedItem.replace(/^["']|["']$/g, "").trim() : null;
}

function extractExpectedCatalogQuantityFromQuery(
  host: ServiceNowCatalogHost,
): string | null {
  return (
    host.originalQuery.match(/\border\s+(\d+)\b/i)?.[1] ??
    host.originalQuery.match(/\bquantity\s*(?:of|=|:)?\s*(\d+)\b/i)?.[1] ??
    null
  );
}

function extractExpectedCatalogConfigurationFieldsFromQuery(
  host: ServiceNowCatalogHost,
): string[] {
  const fields = new Set<string>();
  for (const match of host.originalQuery.matchAll(
    /['"]([^'"]{2,160})['"]\s*:/g,
  )) {
    const field = match[1]?.replace(/\s+/g, " ").trim();
    if (field) fields.add(field);
  }
  return [...fields];
}

function catalogConfigurationEvidenceCoversRequest(
  host: ServiceNowCatalogHost,
  toolResult: string,
): boolean {
  const expectedFields =
    extractExpectedCatalogConfigurationFieldsFromQuery(host);
  if (expectedFields.length === 0) return true;
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const evidence = normalize(toolResult);
  return expectedFields.every((field) => evidence.includes(normalize(field)));
}

function getFreshTrustedCatalogOrderSubmission(
  host: ServiceNowCatalogHost,
): TrustedCatalogOrderSubmission | null {
  if (!host.trustedCatalogOrderSubmission) return null;
  return host.turnCount -
    host.trustedCatalogOrderSubmission.submittedAtTurn <=
    6
    ? host.trustedCatalogOrderSubmission
    : null;
}

function trustedCatalogOrderSubmissionCoversRequest(
  host: ServiceNowCatalogHost,
  submission: TrustedCatalogOrderSubmission | null,
): boolean {
  if (!submission) return false;
  if (extractExpectedCatalogConfigurationFieldsFromQuery(host).length === 0) {
    return false;
  }
  const itemName = extractExpectedCatalogItemNameFromQuery(host);
  if (itemName && submission.itemName !== itemName) return false;
  const quantity = extractExpectedCatalogQuantityFromQuery(host);
  if (quantity && submission.quantity !== quantity) return false;
  return catalogConfigurationEvidenceCoversRequest(
    host,
    submission.configuredResult,
  );
}

export function shouldAutoSubmitConfiguredCatalogItem(
  host: ServiceNowCatalogHost,
  params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
  },
): boolean {
  if (host.selectedSkillId !== "catalog-order-workflow") return false;
  if (params.toolName !== ToolName.CONFIGURE_CATALOG_ITEM) return false;
  if (params.toolArgs?.submit === true) return false;
  if (!/\b(order|request|cart|checkout)\b/i.test(host.originalQuery)) {
    return false;
  }
  if (!/^Configured catalog item\./i.test(params.toolResult)) return false;
  if (
    /\b(?:Error:|incomplete|Missing|Mismatches|could not|not found)\b/i.test(
      params.toolResult,
    )
  ) {
    return false;
  }
  if (!catalogConfigurationEvidenceCoversRequest(host, params.toolResult)) {
    return false;
  }
  return true;
}

function isTrustedCatalogConfigurationResult(
  host: ServiceNowCatalogHost,
  params: {
    toolName: string;
    toolResult: string;
  },
): boolean {
  if (host.selectedSkillId !== "catalog-order-workflow") return false;
  if (params.toolName !== ToolName.CONFIGURE_CATALOG_ITEM) return false;
  if (!/\b(order|request|cart|checkout)\b/i.test(host.originalQuery)) {
    return false;
  }
  if (!/^Configured catalog item\./i.test(params.toolResult)) return false;
  if (
    /\b(?:Error:|incomplete|Missing|Mismatches|could not|not found)\b/i.test(
      params.toolResult,
    )
  ) {
    return false;
  }
  return catalogConfigurationEvidenceCoversRequest(host, params.toolResult);
}

function markTrustedCatalogOrderSubmission(
  host: ServiceNowCatalogHost,
  configuredResult: string,
): void {
  host.trustedCatalogOrderSubmission = {
    itemName: extractExpectedCatalogItemNameFromQuery(host),
    quantity: extractExpectedCatalogQuantityFromQuery(host),
    configuredResult,
    submittedAtTurn: host.turnCount,
  };
}

export async function maybeCompleteTrustedCatalogOrderSubmit(
  host: ServiceNowCatalogHost,
  params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    tabId: number;
    mode: "parallel" | "sequential";
  },
): Promise<{ finalSummary: string } | null> {
  if (params.toolArgs?.submit !== true) return null;
  if (!isTrustedCatalogConfigurationResult(host, params)) return null;

  markTrustedCatalogOrderSubmission(host, params.toolResult);
  const previousElementCount = host.context.getSnapshot()?.elements.length;
  await host.refreshSnapshotWithRetry(
    params.tabId,
    previousElementCount ?? -1,
  );
  const completion = maybeCompleteCatalogOrderFromSnapshot(host);
  if (!completion) return null;
  host.traceRecorder?.recordEvent("trusted_catalog_order_submit_completed", {
    turn: host.turnCount,
    mode: params.mode,
    trustedTool: params.toolName,
  });
  return { finalSummary: completion.summary };
}

export async function maybeAutoSubmitConfiguredCatalogItem(
  host: ServiceNowCatalogHost,
  params: {
    toolName: string;
    toolArgs?: Record<string, unknown>;
    toolResult: string;
    tabId: number;
    mode: "parallel" | "sequential";
  },
): Promise<void> {
  if (!shouldAutoSubmitConfiguredCatalogItem(host, params)) return;

  const submitArgs = {
    ...(params.toolArgs ?? {}),
    submit: true,
    continueToCheckout: true,
  };
  const submitToolCall: ToolCall = {
    id: `auto_${crypto.randomUUID()}`,
    type: "function",
    function: {
      name: ToolName.CONFIGURE_CATALOG_ITEM,
      arguments: JSON.stringify(submitArgs),
    },
  } as ToolCall;
  const toolStep: AgentStep = {
    id: crypto.randomUUID(),
    type: "tool",
    label: "Submit configured catalog item",
    detail: JSON.stringify(submitArgs),
    toolName: ToolName.CONFIGURE_CATALOG_ITEM,
    status: "running",
    timestamp: Date.now(),
  };
  host.stepHandler(toolStep, false);
  host.log.info("agent", "Auto-submitting configured catalog item", {
    turn: host.turnCount,
    mode: params.mode,
  });
  host.traceRecorder?.recordEvent("catalog_config_auto_submit_started", {
    turn: host.turnCount,
    mode: params.mode,
    trustedTool: ToolName.CONFIGURE_CATALOG_ITEM,
  });

  const startedAt = Date.now();
  const result = await host.executeToolCall(submitToolCall, params.tabId);
  const durationMs = Date.now() - startedAt;
  host.stepHandler(
    {
      ...toolStep,
      status: /^Error:/i.test(result) ? "error" : "done",
      durationMs,
      ...(/^Error:/i.test(result) ? { errorMessage: result } : {}),
    },
    true,
  );
  host.traceRecorder?.recordToolExecution(
    submitToolCall.id,
    ToolName.CONFIGURE_CATALOG_ITEM,
    submitArgs,
    result,
    !/^Error:/i.test(result),
    durationMs,
    RiskLevel.MEDIUM,
    /^Error:/i.test(result) ? result : undefined,
  );
  host.context.addMessage({
    role: "tool",
    content: result,
    tool_call_id: submitToolCall.id,
  });
  if (
    !/^Error:/i.test(result) &&
    !/\b(?:incomplete|Missing|Mismatches|could not|not found)\b/i.test(
      result,
    ) &&
    isTrustedCatalogConfigurationResult(host, params)
  ) {
    markTrustedCatalogOrderSubmission(host, params.toolResult);
    const previousElementCount = host.context.getSnapshot()?.elements.length;
    await host.refreshSnapshotWithRetry(
      params.tabId,
      previousElementCount ?? -1,
    );
  }
}
