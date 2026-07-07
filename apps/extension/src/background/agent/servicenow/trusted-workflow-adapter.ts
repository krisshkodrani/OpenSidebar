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
 * missing-field summaries, URL inference); the stateful record-form / catalog
 * controllers follow in later passes behind a host interface.
 */

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
