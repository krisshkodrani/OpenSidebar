/**
 * ServiceNow adapter — generic tool hooks.
 *
 * These are the ONLY ServiceNow entry points tools/index.ts is allowed to
 * call. They encapsulate the ServiceNow reference-resolution orchestration
 * that used to live inline inside the generic type_text and list-action tool
 * handlers, so the generic tools layer holds no ServiceNow logic. Each hook
 * no-ops (returns the input unchanged / an empty override set) off ServiceNow.
 *
 * Import-direction rule: servicenow/* must never import "../index" or the
 * "../tools" barrel — only ../helpers and concrete siblings.
 */

import { normalizeServiceNowReferenceKey } from "./common";
import {
  parseServiceNowReferenceCandidate,
  inferServiceNowListTableFromUrl,
  commonServiceNowReferenceTableForField,
  resolveServiceNowReferenceFromBackground,
  resolveServiceNowReferenceFromPage,
  commitServiceNowReferenceInMainWorld,
  selectServiceNowReferenceAutocompleteInMainWorld,
} from "./references";

export interface ServiceNowListReferenceOverride {
  index: number;
  field: string;
  referenceTable: string;
  displayValue: string;
  sysId: string;
}

/**
 * Post-process a type_text result: when the main-world mirror reports a
 * ServiceNow reference candidate (or a committed/failed reference/field
 * status), resolve the display value to a sys_id and commit it, returning the
 * result string annotated with the outcome. Returns `result` unchanged when
 * there is nothing ServiceNow-specific to do.
 */
export async function finalizeServiceNowReferenceOnType(input: {
  tabId: number;
  args: Record<string, unknown>;
  result: string;
  bridgeStatus: string | undefined;
}): Promise<string> {
  const { tabId, args, result, bridgeStatus } = input;
  const serviceNowCandidate = parseServiceNowReferenceCandidate(bridgeStatus);
  if (serviceNowCandidate && typeof args.text === "string") {
    let resolved = await resolveServiceNowReferenceFromBackground(
      tabId,
      serviceNowCandidate.referenceTable,
      args.text,
    );
    let autocompleteReason: string | null = null;
    let shouldTryAutocomplete =
      !resolved.ok &&
      (resolved.reason === "lookup_http_401" ||
        resolved.reason === "lookup_failed" ||
        resolved.reason === "lookup_timeout");
    if (!resolved.ok && resolved.reason === "lookup_http_401") {
      const pageResolved = await resolveServiceNowReferenceFromPage(
        tabId,
        args,
        serviceNowCandidate,
        args.text,
      );
      resolved = pageResolved;
      shouldTryAutocomplete = !resolved.ok;
    }
    if (!resolved.ok && shouldTryAutocomplete) {
      const selected = await selectServiceNowReferenceAutocompleteInMainWorld(
        tabId,
        args,
        serviceNowCandidate,
        args.text,
      );
      if (selected.ok) {
        return `${String(result)} (ServiceNow reference value committed)`;
      }
      autocompleteReason = selected.reason;
    }
    if (resolved.ok) {
      const committed = await commitServiceNowReferenceInMainWorld(
        tabId,
        args,
        serviceNowCandidate,
        resolved.sysId,
        args.text,
      );
      return committed
        ? `${String(result)} (ServiceNow reference value committed)`
        : `${String(result)} (ServiceNow reference commit failed: no_commit_target)`;
    }
    const suffix = autocompleteReason
      ? `${resolved.reason}; autocomplete_${autocompleteReason}`
      : resolved.reason;
    return `${String(result)} (ServiceNow reference commit failed: ${suffix})`;
  }
  if (bridgeStatus === "servicenow_reference_committed") {
    return `${String(result)} (ServiceNow reference value committed)`;
  }
  if (bridgeStatus === "servicenow_field_committed") {
    return `${String(result)} (ServiceNow field value committed)`;
  }
  if (bridgeStatus === "servicenow_field_commit_attempted") {
    return `${String(result)} (ServiceNow field value commit attempted)`;
  }
  if (bridgeStatus?.startsWith("servicenow_reference_failed:")) {
    return `${String(result)} (ServiceNow reference commit failed: ${bridgeStatus.slice(
      "servicenow_reference_failed:".length,
    )})`;
  }
  return result;
}

/**
 * Resolve the ServiceNow list table (from an explicit `table` or inferred from
 * the current `*_list.do` URL). Returns "" when neither is available. Safe to
 * call off ServiceNow — inference simply yields "".
 */
export function resolveServiceNowListTable(
  table: string,
  currentTabUrl: string,
): string {
  return table || inferServiceNowListTableFromUrl(currentTabUrl);
}

/**
 * On a ServiceNow list, resolve any reference-field filter conditions
 * (display value -> sys_id) so list filtering matches on the encoded value.
 * Returns the effective table plus resolved overrides; off ServiceNow the
 * override set is empty.
 */
export async function resolveServiceNowListReferenceOverrides(input: {
  tabId: number;
  conditions: Array<{ field: string; operator: string; value: string }>;
  table: string;
}): Promise<{
  effectiveTable: string;
  overrides: ServiceNowListReferenceOverride[];
}> {
  const { tabId, conditions, table } = input;
  let currentTabUrl = "";
  try {
    currentTabUrl = (await chrome.tabs.get(tabId)).url || "";
  } catch {
    currentTabUrl = "";
  }
  const currentHost = (() => {
    try {
      return new URL(currentTabUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const effectiveTable = table || inferServiceNowListTableFromUrl(currentTabUrl);
  const overrides: ServiceNowListReferenceOverride[] = [];
  if (
    currentHost.endsWith(".service-now.com") ||
    currentHost === "service-now.com"
  ) {
    for (let index = 0; index < conditions.length; index += 1) {
      const condition = conditions[index];
      const displayValue = condition.value.trim();
      const operator = condition.operator.trim().toLowerCase();
      if (!displayValue || operator.includes("empty")) continue;
      const referenceTable =
        commonServiceNowReferenceTableForField(condition.field) ||
        commonServiceNowReferenceTableForField(
          normalizeServiceNowReferenceKey(condition.field),
        );
      if (!referenceTable) continue;
      const resolved = await resolveServiceNowReferenceFromBackground(
        tabId,
        referenceTable,
        displayValue,
      );
      if (resolved.ok) {
        overrides.push({
          index,
          field: condition.field,
          referenceTable,
          displayValue,
          sysId: resolved.sysId,
        });
      }
    }
  }
  return { effectiveTable, overrides };
}
