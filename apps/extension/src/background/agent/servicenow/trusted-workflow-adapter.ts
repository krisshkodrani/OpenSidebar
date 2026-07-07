/**
 * ServiceNow trusted-workflow adapter (RFC LP-15, Phase 12).
 *
 * The agent-side ServiceNow quarantine: the trusted-workflow logic that used to
 * live scattered through the generic agent loop moves here, behind a clearly
 * labelled domain boundary. Like the tool-side `tools/servicenow/` adapter, this
 * module obeys a one-way rule — it never imports the generic runtime it serves
 * (`loop.ts`, the tools barrel, `tools/index.ts`); the loop imports from the
 * adapter, not the reverse. Deleting this directory removes ServiceNow from the
 * agent runtime without touching generic completion/turn logic.
 *
 * This first pass relocates the pure module-level helpers (request parsing,
 * missing-field summaries, URL inference) and the module-navigation evidence
 * inference (behind a narrow host); the stateful record-form / catalog
 * controllers follow in later passes.
 */

import { ToolName } from "../../../types";
import type { DomSnapshot } from "../../../types";
import type { EvidenceAccumulator } from "../evidence";

/** A trusted catalog-order submission the agent has already committed this run. */
export type TrustedCatalogOrderSubmission = {
  itemName: string | null;
  quantity: string | null;
  configuredResult: string;
  submittedAtTurn: number;
};

/** A parsed "navigate to X module of Y application" request. */
export type ParsedServiceNowModuleRequest = {
  application: string;
  path: string[];
};

/** Accumulated evidence that a requested form field could not be found. */
export type ServiceNowMissingFieldSearchEvidence = {
  findMisses: number;
  hiddenFullLabelMiss: boolean;
  hiddenMissTokens: Set<string>;
  configureFieldMissing: boolean;
};

export function cleanServiceNowModuleLabel(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^["'\s]+|["'.\s]+$/g, "")
    .replace(/^the\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeServiceNowModuleEvidenceText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function serviceNowModuleLabelTokens(value: string): string[] {
  return normalizeServiceNowModuleEvidenceText(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

export function extractServiceNowModuleRequest(
  text: string,
): ParsedServiceNowModuleRequest | null {
  const normalized = text.replace(/\s+/g, " ");
  const patterns = [
    /\b(?:navigate to|open)\s+(?:the\s+)?["“]([^"”]+)["”]\s+module\s+(?:of|in)\s+(?:the\s+)?["“]([^"”]+)["”]\s+application\b/i,
    /\b(?:navigate to|open)\s+(?:the\s+)?(.+?)\s+module\s+(?:of|in)\s+(?:the\s+)?(.+?)\s+application\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const rawPath = cleanServiceNowModuleLabel(match[1] ?? "");
    const application = cleanServiceNowModuleLabel(match[2] ?? "");
    const path = rawPath
      .split(/\s*>\s*|\s*\/\s*/)
      .map(cleanServiceNowModuleLabel)
      .filter(Boolean);
    if (application && path.length > 0) {
      return { application, path };
    }
  }
  return null;
}

export function extractServiceNowFormMissingFieldLabels(
  toolResult: string,
): string[] {
  const labels = new Set<string>();
  for (const match of toolResult.matchAll(
    /^\s*-\s*(.+?): field not found\b/gim,
  )) {
    const label = match[1]?.replace(/\s+/g, " ").trim();
    if (label) labels.add(label);
  }
  return [...labels];
}

export function buildServiceNowMissingFieldInfeasibleSummary(
  labels: string[],
): string {
  const cleanLabels = labels
    .map((label) => label.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (cleanLabels.length === 1) {
    return `I cannot complete this because the requested field "${cleanLabels[0]}" is not available on this ServiceNow form.`;
  }
  return `I cannot complete this because the requested fields ${cleanLabels
    .map((label) => `"${label}"`)
    .join(", ")} are not available on this ServiceNow form.`;
}

export function serviceNowFieldSearchTokens(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

/** Narrow host for the module-navigation evidence inference — all real AgentLoop fields. */
export interface ModuleNavEvidenceHost {
  readonly selectedSkillId: string | null;
  readonly originalQuery: string;
  readonly context: { getSnapshot(): DomSnapshot | null };
  readonly evidenceAccumulator: Pick<EvidenceAccumulator, "addMany">;
  readonly traceRecorder: {
    recordEvent(name: string, data: Record<string, unknown>): void;
  } | null;
}

/**
 * At done() time, when the servicenow-module-navigation skill drove the run,
 * infer navigation_reached / goal_state_verified evidence if the current page is
 * a ServiceNow page whose content matches the requested module leaf. Returns
 * whether any evidence was added. Behaviour-identical to the former
 * AgentLoop.maybeInferServiceNowModuleNavigationEvidence.
 */
export function maybeInferServiceNowModuleNavigationEvidence(
  host: ModuleNavEvidenceHost,
  summary: string,
): boolean {
  if (host.selectedSkillId !== "servicenow-module-navigation") return false;
  const request = extractServiceNowModuleRequest(host.originalQuery);
  if (!request) return false;
  const snapshot = host.context.getSnapshot();
  if (!snapshot) return false;

  const pageText = normalizeServiceNowModuleEvidenceText(
    [
      snapshot.title,
      snapshot.url,
      snapshot.visibleContent,
      snapshot.pageContent,
      summary,
    ].join("\n"),
  );
  const serviceNowPage =
    /servicenow/i.test(snapshot.title) ||
    /service-now|servicenow|nowplatform/i.test(snapshot.url) ||
    /\.do(?:\?|$)|_list\.do\b/i.test(snapshot.url);
  if (!serviceNowPage) return false;

  const leaf = request.path.at(-1);
  if (!leaf) return false;
  const leafTokens = serviceNowModuleLabelTokens(leaf);
  if (
    leafTokens.length === 0 ||
    !leafTokens.every((token) => pageText.includes(token))
  ) {
    return false;
  }

  const now = new Date().toISOString();
  const detail = {
    application: request.application,
    path: request.path,
    inferredFrom: "current_page_on_done",
    title: snapshot.title,
    url: snapshot.url,
  };
  const added = host.evidenceAccumulator.addMany([
    {
      type: "navigation_reached",
      source: ToolName.DONE,
      confidence: "medium",
      observedAt: now,
      supportsTaskGoal: true,
      detail,
    },
    {
      type: "goal_state_verified",
      source: ToolName.DONE,
      confidence: "medium",
      observedAt: now,
      supportsTaskGoal: true,
      detail,
    },
  ]);
  if (added === 0) return false;

  host.traceRecorder?.recordEvent(
    "module_navigation_evidence_inferred_from_done",
    {
      selectedSkillId: host.selectedSkillId,
      application: request.application,
      path: request.path,
      title: snapshot.title,
      url: snapshot.url,
    },
  );
  return true;
}

export function inferServiceNowCreateRecordUrlFromListUrl(
  rawUrl: string,
): string | null {
  if (!rawUrl.trim()) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const targetMatch = url.pathname.match(/\/target\/([^/]+)/i);
  const decodedTarget = targetMatch
    ? decodeURIComponent(targetMatch[1] ?? "")
    : `${url.pathname.replace(/^\//, "")}${url.search}`;
  const listMatch = decodedTarget.match(
    /(?:^|\/)([a-z][a-z0-9_]*?)_list\.do\b/i,
  );
  const table = listMatch?.[1];
  if (!table) return null;
  return `${url.origin}/${table}.do?sys_id=-1`;
}
