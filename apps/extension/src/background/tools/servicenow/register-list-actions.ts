/**
 * ServiceNow adapter — list filter / sort / action tools (RFC LP-16 Phase 4).
 *
 * Relocated verbatim from tools/index.ts, then split by tool concern so no
 * single adapter file is itself a landmine. Registered at its original ordinal
 * position in registerTools() to keep LLM-facing definition order unchanged.
 * Import-direction rule: never imports "../index" or the tools barrel.
 */

import type { ToolRegistry } from "../registry";
import { ToolName } from "../../../types";
import { waitForNavigation } from "../bridge";
import { withTimeout } from "../helpers";
import {
  APPLY_LIST_FILTER_DEF,
  APPLY_LIST_SORT_DEF,
  APPLY_LIST_ACTION_DEF,
} from "../definitions";
import {
  resolveServiceNowListReferenceOverrides,
  resolveServiceNowListTable,
} from "./tool-hooks";

import {
  normalizeOrigin,
  navigationBoundaryError,
} from "../tab-navigation-helpers";

const APPLY_LIST_FILTER_SCRIPT_TIMEOUT_MS = 25_000;

export function registerServiceNowListActionTools(
  toolRegistry: ToolRegistry,
): void {
  toolRegistry.register(
    ToolName.APPLY_LIST_FILTER,
    APPLY_LIST_FILTER_DEF,
    async (args, tabId) => {
      const rawConditions = Array.isArray(args.conditions)
        ? args.conditions
        : [];
      const conditions = rawConditions
        .map((condition) => {
          const obj =
            condition && typeof condition === "object"
              ? (condition as Record<string, unknown>)
              : {};
          const field = typeof obj.field === "string" ? obj.field.trim() : "";
          const operator =
            typeof obj.operator === "string" ? obj.operator.trim() : "is";
          const value =
            typeof obj.value === "string"
              ? obj.value
              : obj.value == null
                ? ""
                : String(obj.value);
          return field ? { field, operator, value } : null;
        })
        .filter(
          (
            condition,
          ): condition is { field: string; operator: string; value: string } =>
            Boolean(condition),
        );

      if (conditions.length === 0) {
        return "Error: apply_list_filter requires at least one condition with a field.";
      }

      const join =
        typeof args.join === "string" && args.join.toUpperCase() === "AND"
          ? "AND"
          : "OR";
      const table = typeof args.table === "string" ? args.table.trim() : "";
      const shouldRun = args.run !== false;

      try {
        const { effectiveTable, overrides: referenceValueOverrides } =
          await resolveServiceNowListReferenceOverrides({
            tabId,
            conditions,
            table,
          });

        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "MAIN" as any,
            func: async (payload: {
              conditions: { field: string; operator: string; value: string }[];
              join: "AND" | "OR";
              table: string;
              referenceValueOverrides: {
                index: number;
                field: string;
                referenceTable: string;
                displayValue: string;
                sysId: string;
              }[];
            }) => {
              type FieldMeta = {
                name: string;
                label: string;
                type: string;
                reference: string;
              };
              type AppliedCondition = {
                field: string;
                label: string;
                operator: string;
                displayValue: string;
                encodedValue: string;
                predicate: string;
                type: string;
              };

              const normalize = (value: unknown): string =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
              const keyFor = (value: unknown): string =>
                normalize(value).replace(/[^a-z0-9]+/g, "");
              const unwrap = (value: unknown): string => {
                if (typeof value === "string") return value;
                if (value && typeof value === "object") {
                  const obj = value as Record<string, unknown>;
                  if (typeof obj.value === "string") return obj.value;
                  if (typeof obj.display_value === "string") {
                    return obj.display_value;
                  }
                }
                return "";
              };
              const displayOf = (value: unknown): string => {
                if (typeof value === "string") return value;
                if (value && typeof value === "object") {
                  const obj = value as Record<string, unknown>;
                  if (typeof obj.display_value === "string") {
                    return obj.display_value;
                  }
                  if (typeof obj.value === "string") return obj.value;
                }
                return "";
              };
              const cleanQueryValue = (value: string): string =>
                value.replace(/\^/g, "").trim();
              const serviceNowListMatch = /\/([^/?#]+)_list\.do\b/i.exec(
                location.pathname,
              );
              const listApi = (() => {
                const win = window as any;
                const glide = win.GlideList2;
                if (!glide || typeof glide.get !== "function") return null;
                const candidates = [
                  ...(document.querySelectorAll("[data-list_id]") as any),
                ]
                  .map((element: Element) =>
                    element.getAttribute("data-list_id"),
                  )
                  .filter(Boolean);
                for (const id of candidates) {
                  try {
                    const list = glide.get(id);
                    if (list) return list;
                  } catch {
                    // Try the next list candidate.
                  }
                }
                try {
                  if (win.g_list) return win.g_list;
                } catch {
                  return null;
                }
                return null;
              })();

              const tableFromList =
                listApi && typeof listApi.getTableName === "function"
                  ? String(listApi.getTableName() || "")
                  : "";
              const tableFromUrl = serviceNowListMatch?.[1] || "";
              const tableName = tableFromList || tableFromUrl;
              if (!tableName || !serviceNowListMatch) {
                return {
                  ok: false,
                  reason: "not_servicenow_list_frame",
                  url: location.href,
                  title: document.title,
                };
              }
              if (payload.table) {
                const requested = keyFor(payload.table).replace(/list$/, "");
                const title = keyFor(document.title);
                const actual = keyFor(tableName);
                if (
                  requested &&
                  requested !== actual &&
                  !actual.endsWith(requested) &&
                  !title.includes(requested)
                ) {
                  return {
                    ok: false,
                    reason: "table_mismatch",
                    table: tableName,
                    url: location.href,
                    title: document.title,
                  };
                }
              }

              const fetchJson = async (
                path: string,
                params: Record<string, string>,
              ): Promise<Record<string, unknown>[]> => {
                const search = new URLSearchParams(params);
                const controller = new AbortController();
                const timer = window.setTimeout(() => controller.abort(), 3000);
                try {
                  const headers: Record<string, string> = {
                    Accept: "application/json",
                  };
                  const token = String((window as any).g_ck || "");
                  if (token) headers["X-UserToken"] = token;
                  const response = await fetch(`${path}?${search.toString()}`, {
                    credentials: "same-origin",
                    headers,
                    signal: controller.signal,
                  });
                  if (!response.ok) return [];
                  const payload = await response.json().catch(() => null);
                  return Array.isArray(payload?.result) ? payload.result : [];
                } catch {
                  return [];
                } finally {
                  window.clearTimeout(timer);
                }
              };

              const fields = new Map<string, FieldMeta>();
              const addField = (
                name: string,
                label = name,
                type = "",
                reference = "",
              ) => {
                const fieldName = name.trim();
                if (!fieldName) return;
                const existing = fields.get(fieldName);
                fields.set(fieldName, {
                  name: fieldName,
                  label: label.trim() || existing?.label || fieldName,
                  type: type || existing?.type || "",
                  reference: reference || existing?.reference || "",
                });
              };
              const dictionaryTablesFor = (table: string): string[] => {
                const normalized = table.trim();
                const inherited: Record<string, string[]> = {
                  alm_hardware: [
                    "alm_hardware",
                    "alm_asset",
                    "cmdb_ci",
                    "cmdb",
                  ],
                  alm_asset: ["alm_asset", "cmdb_ci", "cmdb"],
                  change_request: ["change_request", "task"],
                  incident: ["incident", "task"],
                  problem: ["problem", "task"],
                };
                return inherited[normalized] || [normalized];
              };
              const addCommonListFields = (table: string) => {
                if (table === "alm_hardware" || table === "alm_asset") {
                  addField("asset_function", "Asset function", "choice", "");
                  addField(
                    "model_category",
                    "Model category",
                    "reference",
                    "cmdb_model_category",
                  );
                  addField("assigned_to", "Assigned to", "reference", "sys_user");
                  addField("substatus", "Substate", "choice", "");
                  addField("vendor", "Vendor", "reference", "core_company");
                  addField("cost", "Cost", "decimal", "");
                }
                if (table === "sc_cat_item") {
                  addField("type", "Type", "choice", "");
                  addField("category", "Category", "reference", "sc_category");
                  addField("active", "Active", "boolean", "");
                }
                if (
                  table === "change_request" ||
                  table === "incident" ||
                  table === "problem"
                ) {
                  addField("assigned_to", "Assigned to", "reference", "sys_user");
                  addField(
                    "short_description",
                    table === "problem"
                      ? "Problem statement"
                      : "Short description",
                    "string",
                    "",
                  );
                  addField("state", "State", "choice", "");
                }
                if (table === "change_request") {
                  addField("chg_model", "Model", "reference", "chg_model");
                }
                if (table === "incident") {
                  addField("caller_id", "Caller", "reference", "sys_user");
                  addField("category", "Category", "choice", "");
                  addField("priority", "Priority", "choice", "");
                  addField("impact", "Impact", "choice", "");
                  addField("urgency", "Urgency", "choice", "");
                  addField(
                    "assignment_group",
                    "Assignment group",
                    "reference",
                    "sys_user_group",
                  );
                }
              };

              for (const th of [
                ...document.querySelectorAll(
                  `[id^="hdr_"] th[name], table.data_list_table th[name], th[name]`,
                ),
              ]) {
                const name = th.getAttribute("name") || "";
                const label =
                  th.getAttribute("glide_label") ||
                  th.getAttribute("aria-label") ||
                  th.querySelector("a")?.textContent ||
                  th.textContent ||
                  name;
                addField(name, label);
              }

              if (tableName === "incident") {
                addField("caller_id", "Caller", "reference", "sys_user");
                addField("category", "Category", "choice", "");
                addField("priority", "Priority", "choice", "");
                addField("impact", "Impact", "choice", "");
                addField("urgency", "Urgency", "choice", "");
                addField("state", "State", "choice", "");
                addField("assigned_to", "Assigned to", "reference", "sys_user");
                addField(
                  "assignment_group",
                  "Assignment group",
                  "reference",
                  "sys_user_group",
                );
              }

              addCommonListFields(tableName);

              {
                const dictRecords = await fetchJson(
                  "/api/now/table/sys_dictionary",
                  {
                    sysparm_query: `nameIN${dictionaryTablesFor(tableName).join(",")}^internal_type!=collection`,
                    sysparm_fields:
                      "element,column_label,internal_type,reference",
                    sysparm_limit: "1000",
                    sysparm_display_value: "all",
                  },
                );
                for (const record of dictRecords) {
                  const name = unwrap(record.element);
                  addField(
                    name,
                    unwrap(record.column_label) || name,
                    unwrap(record.internal_type),
                    unwrap(record.reference),
                  );
                }
                addCommonListFields(tableName);
              }

              const byKey = new Map<string, FieldMeta>();
              for (const field of fields.values()) {
                byKey.set(keyFor(field.name), field);
                byKey.set(keyFor(field.label), field);
              }

              const resolveField = (
                requestedField: string,
              ): FieldMeta | null => {
                const normalized = keyFor(requestedField);
                const snake = normalize(requestedField).replace(
                  /[^a-z0-9]+/g,
                  "_",
                );
                if (fields.has(snake)) return fields.get(snake) || null;
                if (fields.has(`${snake}_id`))
                  return fields.get(`${snake}_id`) || null;
                const direct = byKey.get(normalized);
                if (direct) return direct;
                for (const field of fields.values()) {
                  const labelKey = keyFor(field.label);
                  if (
                    labelKey.includes(normalized) ||
                    (labelKey.length >= 8 && normalized.includes(labelKey))
                  ) {
                    return field;
                  }
                }
                return null;
              };

              const resolveValueFromCurrentTable = async (
                field: FieldMeta,
                displayValue: string,
                conditionIndex: number,
              ): Promise<string> => {
                if (!displayValue.trim()) return "";
                const predicates: string[] = [];
                for (
                  let index = 0;
                  index < payload.conditions.length;
                  index += 1
                ) {
                  if (index === conditionIndex) continue;
                  const condition = payload.conditions[index];
                  const otherField = resolveField(condition.field);
                  if (!otherField) continue;
                  const operator = normalize(condition.operator || "is");
                  const value = condition.value ?? "";
                  const rawType = normalize(otherField.type);
                  if (
                    operator.includes("not") ||
                    operator.includes("start") ||
                    operator.includes("empty") ||
                    !value.trim() ||
                    rawType.includes("reference") ||
                    rawType.includes("choice") ||
                    rawType === "boolean" ||
                    rawType === "integer"
                  ) {
                    continue;
                  }
                  predicates.push(
                    `${otherField.name}=${cleanQueryValue(value)}`,
                  );
                  if (predicates.length >= 3) break;
                }
                if (predicates.length === 0) return "";
                const records = await fetchJson(
                  `/api/now/table/${encodeURIComponent(tableName)}`,
                  {
                    sysparm_query: predicates.join("^"),
                    sysparm_fields: field.name,
                    sysparm_limit: "5",
                    sysparm_display_value: "all",
                  },
                );
                const wanted = normalize(displayValue);
                for (const record of records) {
                  const cell = record[field.name];
                  const rawValue = unwrap(cell);
                  const display = displayOf(cell);
                  if (
                    normalize(display) === wanted ||
                    normalize(rawValue) === wanted
                  ) {
                    return rawValue || display;
                  }
                }
                return "";
              };

              const resolveChoiceValue = async (
                field: FieldMeta,
                displayValue: string,
                conditionIndex: number,
              ): Promise<string> => {
                const incidentChoiceFallbacks: Record<
                  string,
                  Record<string, string>
                > = {
                  category: {
                    inquiryhelp: "inquiry",
                    inquiry: "inquiry",
                    software: "software",
                    hardware: "hardware",
                    network: "network",
                    database: "database",
                  },
                  state: {
                    new: "1",
                    inprogress: "2",
                    onhold: "3",
                    resolved: "6",
                    closed: "7",
                    canceled: "8",
                  },
                  priority: {
                    critical: "1",
                    "1critical": "1",
                    high: "2",
                    "2high": "2",
                    moderate: "3",
                    "3moderate": "3",
                    low: "4",
                    "4low": "4",
                    planning: "5",
                    "5planning": "5",
                  },
                  impact: {
                    high: "1",
                    "1high": "1",
                    medium: "2",
                    "2medium": "2",
                    low: "3",
                    "3low": "3",
                  },
                  urgency: {
                    high: "1",
                    "1high": "1",
                    medium: "2",
                    "2medium": "2",
                    low: "3",
                    "3low": "3",
                  },
                };
                const fallback =
                  tableName === "incident"
                    ? incidentChoiceFallbacks[field.name]?.[
                        keyFor(displayValue)
                      ]
                    : undefined;
                if (fallback) return fallback;

                const choices = await fetchJson("/api/now/table/sys_choice", {
                  sysparm_query: `nameIN${dictionaryTablesFor(tableName).join(",")}^element=${field.name}`,
                  sysparm_fields: "value,label",
                  sysparm_limit: "500",
                  sysparm_display_value: "all",
                });
                const wanted = keyFor(displayValue);
                const choice = choices.find((record) => {
                  const value = unwrap(record.value);
                  const label = unwrap(record.label);
                  return keyFor(value) === wanted || keyFor(label) === wanted;
                });
                if (choice) return unwrap(choice.value);
                const recordValue = await resolveValueFromCurrentTable(
                  field,
                  displayValue,
                  conditionIndex,
                );
                if (recordValue) return recordValue;
                if (field.name === "asset_function") {
                  const assetFunctionFallbacks: Record<string, string> = {
                    primary: "primary",
                    secondary: "secondary",
                  };
                  const fallback = assetFunctionFallbacks[wanted];
                  if (fallback) return fallback;
                }
                if (/^--\s*none\s*--$/i.test(displayValue.trim())) return "";
                if (/^[a-z][a-z0-9 _-]*$/i.test(displayValue.trim())) {
                  return displayValue.trim().toLowerCase().replace(/\s+/g, "_");
                }
                return displayValue;
              };

              const resolveReferenceValue = async (
                field: FieldMeta,
                displayValue: string,
                conditionIndex: number,
              ): Promise<string> => {
                if (!field.reference || !displayValue.trim())
                  return displayValue;
                const override = payload.referenceValueOverrides.find(
                  (candidate) =>
                    candidate.index === conditionIndex &&
                    candidate.referenceTable === field.reference &&
                    normalize(candidate.displayValue) ===
                      normalize(displayValue),
                );
                if (override?.sysId) return override.sysId;
                const recordValue = await resolveValueFromCurrentTable(
                  field,
                  displayValue,
                  conditionIndex,
                );
                if (recordValue) return recordValue;
                const safe = cleanQueryValue(displayValue);
                const queryFields = [
                  "name",
                  "title",
                  "label",
                  "display_name",
                  "number",
                  "user_name",
                  "email",
                  "first_name",
                  "last_name",
                ];
                const referencePath = `/api/now/table/${encodeURIComponent(field.reference)}`;
                const fetchReferenceRecords = (query: string) =>
                  fetchJson(referencePath, {
                    sysparm_query: query,
                    sysparm_fields:
                      "sys_id,name,title,label,display_name,number,user_name,email,first_name,last_name",
                    sysparm_limit: "5",
                    sysparm_display_value: "all",
                  });
                const exactQuery = [
                  "name",
                  "title",
                  "label",
                  "display_name",
                  "number",
                  "user_name",
                  "email",
                ]
                  .map((queryField) => `${queryField}=${safe}`)
                  .join("^OR");
                let records = await fetchReferenceRecords(exactQuery);
                if (records.length === 0 && field.reference === "sys_user") {
                  const parts = safe.split(/\s+/).filter(Boolean);
                  const firstName = parts[0] || "";
                  const lastName = parts.slice(1).join(" ");
                  if (firstName && lastName) {
                    records = await fetchReferenceRecords(
                      `first_name=${firstName}^last_name=${lastName}`,
                    );
                  }
                }
                if (records.length === 0) {
                  records = await fetchReferenceRecords(
                    [
                      "name",
                      "title",
                      "label",
                      "display_name",
                      "user_name",
                      "email",
                    ]
                      .map((queryField) => `${queryField}LIKE${safe}`)
                      .join("^OR"),
                  );
                }
                const wanted = normalize(displayValue);
                const selected =
                  records.find(
                    (record) =>
                      queryFields.some(
                        (queryField) =>
                          normalize(unwrap(record[queryField])) === wanted,
                      ) ||
                      normalize(
                        `${unwrap(record.first_name)} ${unwrap(record.last_name)}`,
                      ) === wanted,
                  ) || records[0];
                return selected
                  ? unwrap(selected.sys_id) || displayValue
                  : displayValue;
              };

              const resolveEncodedValue = async (
                field: FieldMeta,
                displayValue: string,
                conditionIndex: number,
              ): Promise<string> => {
                const rawType = normalize(field.type);
                if (
                  rawType.includes("choice") ||
                  rawType === "boolean" ||
                  rawType === "integer"
                ) {
                  return cleanQueryValue(
                    await resolveChoiceValue(
                      field,
                      displayValue,
                      conditionIndex,
                    ),
                  );
                }
                if (rawType.includes("reference") || field.reference) {
                  return cleanQueryValue(
                    await resolveReferenceValue(
                      field,
                      displayValue,
                      conditionIndex,
                    ),
                  );
                }
                return cleanQueryValue(displayValue);
              };

              const buildPredicate = async (
                condition: { field: string; operator: string; value: string },
                conditionIndex: number,
              ): Promise<AppliedCondition> => {
                const field = resolveField(condition.field);
                if (!field) {
                  throw new Error(`unknown_field:${condition.field}`);
                }
                const operator = normalize(condition.operator || "is");
                const displayValue = condition.value ?? "";
                if (
                  operator.includes("empty") ||
                  displayValue.trim().length === 0
                ) {
                  return {
                    field: field.name,
                    label: field.label,
                    operator: "is empty",
                    displayValue,
                    encodedValue: "",
                    predicate: `${field.name}ISEMPTY`,
                    type: field.type,
                  };
                }
                const encodedValue = await resolveEncodedValue(
                  field,
                  displayValue,
                  conditionIndex,
                );
                const encodedOperator =
                  operator.includes("not") && !operator.includes("empty")
                    ? "!="
                    : operator.includes("contain") ||
                        operator.includes("like") ||
                        operator.includes("include")
                      ? "LIKE"
                    : operator.includes("start")
                      ? "STARTSWITH"
                      : "=";
                return {
                  field: field.name,
                  label: field.label,
                  operator: condition.operator || "is",
                  displayValue,
                  encodedValue,
                  predicate:
                    encodedOperator === "=" || encodedOperator === "!="
                      ? `${field.name}${encodedOperator}${encodedValue}`
                      : `${field.name}${encodedOperator}${encodedValue}`,
                  type: field.type,
                };
              };

              try {
                const applied: AppliedCondition[] = [];
                for (
                  let index = 0;
                  index < payload.conditions.length;
                  index += 1
                ) {
                  applied.push(
                    await buildPredicate(payload.conditions[index], index),
                  );
                }
                const separator = payload.join === "AND" ? "^" : "^OR";
                const query = applied
                  .map((condition) => condition.predicate)
                  .join(separator);
                const target = `${tableName}_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
                return {
                  ok: true,
                  platform: "servicenow",
                  table: tableName,
                  query,
                  targetUrl: `${location.origin}/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`,
                  frameUrl: location.href,
                  currentQuery:
                    listApi && typeof listApi.getQuery === "function"
                      ? String(listApi.getQuery() || "")
                      : "",
                  conditions: applied,
                };
              } catch (error) {
                return {
                  ok: false,
                  reason:
                    error instanceof Error
                      ? error.message
                      : "filter_build_failed",
                  table: tableName,
                  availableFields: [...fields.values()]
                    .slice(0, 80)
                    .map((field) => `${field.label} (${field.name})`),
                  url: location.href,
                };
              }
            },
            args: [
              {
                conditions,
                join,
                table: effectiveTable,
                referenceValueOverrides,
              },
            ],
          }),
          APPLY_LIST_FILTER_SCRIPT_TIMEOUT_MS,
          "apply_list_filter planning",
        );

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter(Boolean);
        const applied = plans.find(
          (plan) => plan?.ok === true && typeof plan.targetUrl === "string",
        );
        if (!applied) {
          const reason =
            plans.find((plan) => typeof plan?.reason === "string")?.reason ||
            "no_supported_list_surface";
          const fields = plans.find((plan) =>
            Array.isArray(plan?.availableFields),
          )?.availableFields as string[] | undefined;
          return [
            `Error: Could not apply a structured list filter (${String(reason)}).`,
            fields?.length
              ? `Available fields included: ${fields.slice(0, 20).join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }

        const targetUrl = String(applied.targetUrl);
        const query = String(applied.query || "");
        const tableName = String(applied.table || "list");
        const conditionLines = Array.isArray(applied.conditions)
          ? (applied.conditions as Record<string, unknown>[])
              .map(
                (condition) =>
                  `- ${String(condition.label || condition.field)} ${String(condition.operator || "is")} "${String(condition.displayValue ?? "")}" -> ${String(condition.predicate || "")}`,
              )
              .join("\n")
          : "";

        if (shouldRun) {
          const currentTab = await chrome.tabs.get(tabId);
          const currentOrigin = normalizeOrigin(currentTab.url || "");
          const targetOrigin = normalizeOrigin(targetUrl);
          if (currentOrigin && targetOrigin && currentOrigin !== targetOrigin) {
            return navigationBoundaryError(targetUrl, [currentOrigin]);
          }
          await chrome.tabs.update(tabId, { url: targetUrl });
          await waitForNavigation(tabId, 10_000);
        }

        return [
          `${shouldRun ? "Applied" : "Built"} ${tableName} list filter.`,
          `Query state: sysparm_query=${query}`,
          conditionLines ? `Conditions:\n${conditionLines}` : "",
          shouldRun ? `Navigated to filtered list: ${targetUrl}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      } catch (e: any) {
        return `Error applying list filter: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.APPLY_LIST_SORT,
    APPLY_LIST_SORT_DEF,
    async (args, tabId) => {
      const rawSorts = Array.isArray(args.sorts) ? args.sorts : [];
      const sorts = rawSorts
        .map((sort) => {
          const obj =
            sort && typeof sort === "object"
              ? (sort as Record<string, unknown>)
              : {};
          const field = typeof obj.field === "string" ? obj.field.trim() : "";
          const direction =
            typeof obj.direction === "string"
              ? obj.direction.trim()
              : "ascending";
          return field ? { field, direction } : null;
        })
        .filter((sort): sort is { field: string; direction: string } =>
          Boolean(sort),
        );

      if (sorts.length === 0) {
        return "Error: apply_list_sort requires at least one sort clause with a field.";
      }

      const table = typeof args.table === "string" ? args.table.trim() : "";
      const shouldRun = args.run !== false;

      try {
        let currentTabUrl = "";
        try {
          currentTabUrl = (await chrome.tabs.get(tabId)).url || "";
        } catch {
          currentTabUrl = "";
        }
        const effectiveTable = resolveServiceNowListTable(table, currentTabUrl);

        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "MAIN" as any,
            func: async (payload: {
              sorts: { field: string; direction: string }[];
              table: string;
            }) => {
              type FieldMeta = {
                name: string;
                label: string;
                type: string;
                reference: string;
              };
              type AppliedSort = {
                field: string;
                label: string;
                direction: "asc" | "desc";
                predicate: string;
              };

              const normalize = (value: unknown): string =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
              const keyFor = (value: unknown): string =>
                normalize(value).replace(/[^a-z0-9]+/g, "");
              const unwrap = (value: unknown): string => {
                if (typeof value === "string") return value;
                if (value && typeof value === "object") {
                  const obj = value as Record<string, unknown>;
                  if (typeof obj.value === "string") return obj.value;
                  if (typeof obj.display_value === "string") {
                    return obj.display_value;
                  }
                }
                return "";
              };
              const serviceNowListMatch = /\/([^/?#]+)_list\.do\b/i.exec(
                location.pathname,
              );
              const listApi = (() => {
                const win = window as any;
                const glide = win.GlideList2;
                if (!glide || typeof glide.get !== "function") return null;
                const candidates = [
                  ...(document.querySelectorAll("[data-list_id]") as any),
                ]
                  .map((element: Element) =>
                    element.getAttribute("data-list_id"),
                  )
                  .filter(Boolean);
                for (const id of candidates) {
                  try {
                    const list = glide.get(id);
                    if (list) return list;
                  } catch {
                    // Try the next list candidate.
                  }
                }
                try {
                  if (win.g_list) return win.g_list;
                } catch {
                  return null;
                }
                return null;
              })();

              const tableFromList =
                listApi && typeof listApi.getTableName === "function"
                  ? String(listApi.getTableName() || "")
                  : "";
              const tableFromUrl = serviceNowListMatch?.[1] || "";
              const tableName = tableFromList || tableFromUrl;
              if (!tableName || !serviceNowListMatch) {
                return {
                  ok: false,
                  reason: "not_servicenow_list_frame",
                  url: location.href,
                  title: document.title,
                };
              }
              const hasListSurface =
                Boolean(listApi) ||
                Boolean(
                  document.querySelector(
                    "table.data_list_table, [data-list_id], th[name], [id$='_table']",
                  ),
                );
              if (!hasListSurface && !tableFromUrl) {
                return {
                  ok: false,
                  reason: "no_list_surface_in_frame",
                  table: tableName,
                  url: location.href,
                  title: document.title,
                };
              }

              if (payload.table) {
                const requested = keyFor(payload.table);
                const title = keyFor(document.title);
                if (
                  requested &&
                  requested !== keyFor(tableName) &&
                  !title.includes(requested)
                ) {
                  return {
                    ok: false,
                    reason: "table_mismatch",
                    table: tableName,
                    url: location.href,
                    title: document.title,
                  };
                }
              }

              const fetchJson = async (
                path: string,
                params: Record<string, string>,
              ): Promise<Record<string, unknown>[]> => {
                const search = new URLSearchParams(params);
                const controller = new AbortController();
                const timer = window.setTimeout(() => controller.abort(), 3000);
                try {
                  const headers: Record<string, string> = {
                    Accept: "application/json",
                  };
                  const token = String((window as any).g_ck || "");
                  if (token) headers["X-UserToken"] = token;
                  const response = await fetch(`${path}?${search.toString()}`, {
                    credentials: "same-origin",
                    headers,
                    signal: controller.signal,
                  });
                  if (!response.ok) return [];
                  const payload = await response.json().catch(() => null);
                  return Array.isArray(payload?.result) ? payload.result : [];
                } catch {
                  return [];
                } finally {
                  window.clearTimeout(timer);
                }
              };

              const fields = new Map<string, FieldMeta>();
              const addField = (
                name: string,
                label = name,
                type = "",
                reference = "",
              ) => {
                const fieldName = name.trim();
                if (!fieldName) return;
                const existing = fields.get(fieldName);
                fields.set(fieldName, {
                  name: fieldName,
                  label: label.trim() || existing?.label || fieldName,
                  type: type || existing?.type || "",
                  reference: reference || existing?.reference || "",
                });
              };
              const dictionaryTablesFor = (table: string): string[] => {
                const normalized = table.trim();
                const inherited: Record<string, string[]> = {
                  alm_hardware: [
                    "alm_hardware",
                    "alm_asset",
                    "cmdb_ci",
                    "cmdb",
                  ],
                  alm_asset: ["alm_asset", "cmdb_ci", "cmdb"],
                  change_request: ["change_request", "task"],
                  incident: ["incident", "task"],
                  problem: ["problem", "task"],
                };
                return inherited[normalized] || [normalized];
              };
              const addCommonListFields = (table: string) => {
                if (table === "alm_hardware" || table === "alm_asset") {
                  addField("asset_function", "Asset function", "choice", "");
                  addField(
                    "model_category",
                    "Model category",
                    "reference",
                    "cmdb_model_category",
                  );
                  addField("assigned_to", "Assigned to", "reference", "sys_user");
                  addField("substatus", "Substate", "choice", "");
                  addField("vendor", "Vendor", "reference", "core_company");
                  addField("cost", "Cost", "decimal", "");
                }
                if (
                  table === "change_request" ||
                  table === "incident" ||
                  table === "problem"
                ) {
                  addField("assigned_to", "Assigned to", "reference", "sys_user");
                  addField("closed_by", "Closed by", "reference", "sys_user");
                  addField("description", "Description", "string", "");
                  addField(
                    "short_description",
                    table === "problem"
                      ? "Problem statement"
                      : "Short description",
                    "string",
                    "",
                  );
                  addField("state", "State", "choice", "");
                }
                if (table === "change_request") {
                  addField("chg_model", "Model", "reference", "chg_model");
                }
              };

              for (const th of [
                ...document.querySelectorAll(
                  `[id^="hdr_"] th[name], table.data_list_table th[name], th[name]`,
                ),
              ]) {
                const name = th.getAttribute("name") || "";
                const label =
                  th.getAttribute("glide_label") ||
                  th.getAttribute("aria-label") ||
                  th.querySelector("a")?.textContent ||
                  th.textContent ||
                  name;
                addField(name, label);
              }

              if (tableName === "incident") {
                addField("number", "Number");
                addField("task_effective_number", "Effective number");
                addField("calendar_duration", "Duration");
                addField("business_duration", "Business duration");
                addField("business_stc", "Business resolve time");
                addField("activity_due", "Activity due");
                addField("assigned_to", "Assigned to", "reference", "sys_user");
                addField(
                  "assignment_group",
                  "Assignment group",
                  "reference",
                  "sys_user_group",
                );
                addField("closed_by", "Closed by", "reference", "sys_user");
                addField("caller_id", "Caller", "reference", "sys_user");
              }

              addCommonListFields(tableName);

              const hasKnownField = (requestedField: string): boolean => {
                const normalized = keyFor(requestedField);
                const snake = normalize(requestedField).replace(
                  /[^a-z0-9]+/g,
                  "_",
                );
                if (fields.has(snake) || fields.has(`${snake}_id`)) return true;
                for (const field of fields.values()) {
                  if (
                    keyFor(field.name) === normalized ||
                    keyFor(field.label) === normalized
                  ) {
                    return true;
                  }
                }
                return false;
              };

              if (!payload.sorts.every((sort) => hasKnownField(sort.field))) {
                const dictRecords = await fetchJson(
                  "/api/now/table/sys_dictionary",
                  {
                    sysparm_query: `nameIN${dictionaryTablesFor(tableName).join(",")}^internal_type!=collection`,
                    sysparm_fields:
                      "element,column_label,internal_type,reference",
                    sysparm_limit: "1000",
                    sysparm_display_value: "all",
                  },
                );
                for (const record of dictRecords) {
                  const name = unwrap(record.element);
                  addField(
                    name,
                    unwrap(record.column_label) || name,
                    unwrap(record.internal_type),
                    unwrap(record.reference),
                  );
                }
              }

              const byKey = new Map<string, FieldMeta>();
              for (const field of fields.values()) {
                byKey.set(keyFor(field.name), field);
                byKey.set(keyFor(field.label), field);
              }

              const resolveField = (
                requestedField: string,
              ): FieldMeta | null => {
                const normalized = keyFor(requestedField);
                const snake = normalize(requestedField).replace(
                  /[^a-z0-9]+/g,
                  "_",
                );
                if (fields.has(snake)) return fields.get(snake) || null;
                if (fields.has(`${snake}_id`))
                  return fields.get(`${snake}_id`) || null;
                const direct = byKey.get(normalized);
                if (direct) return direct;
                const partial = [...fields.values()]
                  .filter((field) => {
                    const labelKey = keyFor(field.label);
                    return (
                      labelKey.includes(normalized) ||
                      (labelKey.length >= 8 && normalized.includes(labelKey))
                    );
                  })
                  .sort(
                    (a, b) => keyFor(a.label).length - keyFor(b.label).length,
                  );
                return partial[0] || null;
              };

              const normalizeDirection = (direction: string): "asc" | "desc" =>
                normalize(direction).startsWith("desc") ? "desc" : "asc";

              try {
                const applied: AppliedSort[] = payload.sorts.map((sort) => {
                  const field = resolveField(sort.field);
                  if (!field) throw new Error(`unknown_field:${sort.field}`);
                  const direction = normalizeDirection(sort.direction);
                  const predicate = `ORDERBY${direction === "desc" ? "DESC" : ""}${field.name}`;
                  return {
                    field: field.name,
                    label: field.label,
                    direction,
                    predicate,
                  };
                });
                const currentQuery =
                  listApi && typeof listApi.getQuery === "function"
                    ? String(listApi.getQuery() || "")
                    : new URLSearchParams(location.search).get(
                        "sysparm_query",
                      ) || "";
                const baseQuery = currentQuery
                  .split("^")
                  .map((part) => part.trim())
                  .filter((part) => part && !/^ORDERBY/i.test(part))
                  .join("^");
                const query = [
                  baseQuery,
                  ...applied.map((sort) => sort.predicate),
                ]
                  .filter(Boolean)
                  .join("^");
                const target = `${tableName}_list.do?sysparm_query=${encodeURIComponent(query)}&sysparm_first_row=1&sysparm_view=`;
                return {
                  ok: true,
                  platform: "servicenow",
                  table: tableName,
                  query,
                  targetUrl: `${location.origin}/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`,
                  frameUrl: location.href,
                  sorts: applied,
                };
              } catch (error) {
                return {
                  ok: false,
                  reason:
                    error instanceof Error
                      ? error.message
                      : "sort_build_failed",
                  table: tableName,
                  availableFields: [...fields.values()]
                    .slice(0, 80)
                    .map((field) => `${field.label} (${field.name})`),
                  url: location.href,
                };
              }
            },
            args: [
              {
                sorts,
                table: effectiveTable,
              },
            ],
          }),
          12_000,
          "apply_list_sort planning",
        );

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter(Boolean);
        const applied = plans.find(
          (plan) => plan?.ok === true && typeof plan.targetUrl === "string",
        );
        if (!applied) {
          const reason =
            plans.find((plan) => typeof plan?.reason === "string")?.reason ||
            "no_supported_list_surface";
          const fields = plans.find((plan) =>
            Array.isArray(plan?.availableFields),
          )?.availableFields as string[] | undefined;
          return [
            `Error: Could not apply structured list sorting (${String(reason)}).`,
            fields?.length
              ? `Available fields included: ${fields.slice(0, 20).join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }

        const targetUrl = String(applied.targetUrl);
        const query = String(applied.query || "");
        const tableName = String(applied.table || "list");
        const sortLines = Array.isArray(applied.sorts)
          ? (applied.sorts as Record<string, unknown>[])
              .map(
                (sort) =>
                  `- ${String(sort.label || sort.field)} ${String(sort.direction || "asc")} -> ${String(sort.predicate || "")}`,
              )
              .join("\n")
          : "";

        if (shouldRun) {
          const currentTab = await chrome.tabs.get(tabId);
          const currentOrigin = normalizeOrigin(currentTab.url || "");
          const targetOrigin = normalizeOrigin(targetUrl);
          if (currentOrigin && targetOrigin && currentOrigin !== targetOrigin) {
            return navigationBoundaryError(targetUrl, [currentOrigin]);
          }
          await chrome.tabs.update(tabId, { url: targetUrl });
          await waitForNavigation(tabId, 10_000);
        }

        return [
          `${shouldRun ? "Applied" : "Built"} ${tableName} list sorting.`,
          `Query state: sysparm_query=${query}`,
          sortLines ? `Sorts:\n${sortLines}` : "",
          shouldRun ? `Navigated to sorted list: ${targetUrl}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      } catch (e: any) {
        return `Error applying list sort: ${e.message}`;
      }
    },
  );

  toolRegistry.register(
    ToolName.APPLY_LIST_ACTION,
    APPLY_LIST_ACTION_DEF,
    async (args, tabId) => {
      const records = Array.isArray(args.records)
        ? args.records
            .map((record) =>
              typeof record === "string"
                ? record.trim()
                : String(record ?? "").trim(),
            )
            .filter(Boolean)
        : [];
      const action = typeof args.action === "string" ? args.action.trim() : "";
      const relatedRecord =
        typeof args.relatedRecord === "string"
          ? args.relatedRecord.trim()
          : "";
      const relatedField =
        typeof args.relatedField === "string" ? args.relatedField.trim() : "";
      const table = typeof args.table === "string" ? args.table.trim() : "";
      const confirm = args.confirm !== false;

      if (records.length === 0) {
        return "Error: apply_list_action requires at least one record identifier or row text snippet.";
      }
      if (!action) {
        return "Error: apply_list_action requires a visible selected-row action label.";
      }

      try {
        let currentTabUrl = "";
        try {
          currentTabUrl = (await chrome.tabs.get(tabId)).url || "";
        } catch {
          currentTabUrl = "";
        }
        const effectiveTable = resolveServiceNowListTable(table, currentTabUrl);

        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "MAIN" as any,
            func: async (payload: {
              records: string[];
              action: string;
              relatedRecord: string;
              relatedField: string;
              table: string;
              confirm: boolean;
            }) => {
              const sleep = (ms: number) =>
                new Promise((resolve) => window.setTimeout(resolve, ms));
              const normalize = (value: unknown): string =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
              const keyFor = (value: unknown): string =>
                normalize(value).replace(/[^a-z0-9]+/g, "");
              const cssEscape = (value: string): string => {
                const css = (window as any).CSS;
                if (css && typeof css.escape === "function") {
                  return css.escape(value);
                }
                return value.replace(/["\\]/g, "\\$&");
              };
              const visibleText = (element: Element | null): string =>
                normalize(
                  [
                    element?.getAttribute("aria-label"),
                    element?.getAttribute("title"),
                    element?.getAttribute("name"),
                    element?.getAttribute("id"),
                    element?.textContent,
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
              const fieldNameFromDisplayInput = (
                input: HTMLInputElement,
              ): string => {
                const name = input.name || input.id || "";
                return name
                  .replace(/^sys_display\./, "")
                  .replace(/^sys_original\./, "")
                  .split(".")
                  .pop() || name;
              };
              const fieldMatches = (
                input: HTMLInputElement,
                requestedField: string,
              ): boolean => {
                if (!requestedField) return true;
                const requested = keyFor(requestedField);
                const fieldName = fieldNameFromDisplayInput(input);
                const label = input
                  .closest("tr, .form-group, .form-field, .container-fluid")
                  ?.querySelector("label");
                return [
                  fieldName,
                  input.name,
                  input.id,
                  input.getAttribute("aria-label"),
                  label?.textContent,
                ].some((value) => keyFor(value).includes(requested));
              };
              const resolveRecordReference = async (
                tableName: string,
                displayValue: string,
              ): Promise<{ sysId: string; display: string } | null> => {
                const cleanValue = displayValue.trim();
                if (!tableName || !cleanValue) return null;
                const encodedQuery = encodeURIComponent(
                  `number=${cleanValue}^ORname=${cleanValue}^ORuser_name=${cleanValue}`,
                );
                const fields = encodeURIComponent("sys_id,number,name,user_name");
                const url = `/api/now/table/${encodeURIComponent(
                  tableName,
                )}?sysparm_query=${encodedQuery}&sysparm_fields=${fields}&sysparm_limit=1`;
                try {
                  const response = await fetch(url, {
                    credentials: "include",
                    headers: { accept: "application/json" },
                  });
                  if (!response.ok) return null;
                  const body = (await response.json()) as {
                    result?: Array<Record<string, unknown>>;
                  };
                  const record = body.result?.[0];
                  if (!record) return null;
                  const sysId =
                    typeof record?.sys_id === "string" ? record.sys_id : "";
                  if (!sysId) return null;
                  const display =
                    String(record.number || record.name || record.user_name || "")
                      .trim() || cleanValue;
                  return { sysId, display };
                } catch {
                  return null;
                }
              };
              const fillRelatedReference = async (): Promise<
                | {
                    ok: true;
                    field: string;
                    display: string;
                    sysId?: string;
                  }
                | { ok: false; reason: string; availableFields?: string[] }
              > => {
                if (!payload.relatedRecord) {
                  return { ok: false, reason: "no_related_record" };
                }
                const requestedField =
                  payload.relatedField ||
                  (/duplicate/i.test(payload.action) ? "duplicate_of" : "");
                const candidates = [
                  ...document.querySelectorAll<HTMLInputElement>(
                    "input[id^='sys_display.'], input[name^='sys_display.'], input[type='search']",
                  ),
                ].filter((input) => {
                  if (input.disabled || input.readOnly) return false;
                  const rect = input.getBoundingClientRect();
                  if (rect.width <= 0 || rect.height <= 0) return false;
                  if (!fieldMatches(input, requestedField)) return false;
                  if (requestedField) return true;
                  return /sys_display|reference|lookup/i.test(
                    `${input.id} ${input.name} ${input.type}`,
                  );
                });
                const input =
                  candidates.find((candidate) =>
                    /duplicate_of/i.test(`${candidate.id} ${candidate.name}`),
                  ) || candidates[0];
                if (!input) {
                  return {
                    ok: false,
                    reason: "related_field_not_found",
                    availableFields: [
                      ...document.querySelectorAll<HTMLInputElement>(
                        "input[id^='sys_display.'], input[name^='sys_display.'], input[type='search']",
                      ),
                    ]
                      .map(visibleText)
                      .filter(Boolean)
                      .slice(0, 20),
                  };
                }

                const fieldName = fieldNameFromDisplayInput(input);
                const resolved = await resolveRecordReference(
                  tableName || payload.table,
                  payload.relatedRecord,
                );
                const win = window as any;
                if (
                  resolved?.sysId &&
                  win.g_form &&
                  typeof win.g_form.setValue === "function"
                ) {
                  try {
                    win.g_form.setValue(
                      fieldName,
                      resolved.sysId,
                      resolved.display,
                    );
                  } catch {
                    // Fall back to DOM value setting below.
                  }
                }
                input.value = resolved?.display || payload.relatedRecord;
                input.setAttribute("value", input.value);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));

                const hidden =
                  document.querySelector<HTMLInputElement>(
                  `input[name="${cssEscape(fieldName)}"], input[id="${cssEscape(
                    fieldName,
                  )}"], input[name$=".${cssEscape(
                    fieldName,
                  )}"]:not([id^="sys_display."])`,
                  ) ||
                  [
                    ...document.querySelectorAll<HTMLInputElement>("input"),
                  ].find((candidate) => {
                    if (/^sys_display\./i.test(candidate.id)) return false;
                    if (/^sys_display\./i.test(candidate.name)) return false;
                    return [candidate.id, candidate.name].some(
                      (value) =>
                        value === fieldName || value.endsWith(`.${fieldName}`),
                    );
                  });
                if (hidden && resolved?.sysId) {
                  hidden.value = resolved.sysId;
                  hidden.setAttribute("value", resolved.sysId);
                  hidden.dispatchEvent(new Event("input", { bubbles: true }));
                  hidden.dispatchEvent(new Event("change", { bubbles: true }));
                }
                await sleep(200);
                return {
                  ok: true,
                  field: fieldName,
                  display: input.value,
                  sysId: resolved?.sysId,
                };
              };
              const serviceNowListMatch = /\/([^/?#]+)_list\.do\b/i.exec(
                location.pathname,
              );
              const listApi = (() => {
                const win = window as any;
                const glide = win.GlideList2;
                if (glide && typeof glide.get === "function") {
                  const candidates = [
                    ...(document.querySelectorAll("[data-list_id]") as any),
                  ]
                    .map((element: Element) =>
                      element.getAttribute("data-list_id"),
                    )
                    .filter(Boolean);
                  for (const id of candidates) {
                    try {
                      const list = glide.get(id);
                      if (list) return list;
                    } catch {
                      // Try the next list candidate.
                    }
                  }
                }
                try {
                  if (win.g_list) return win.g_list;
                } catch {
                  return null;
                }
                return null;
              })();
              const tableFromList =
                listApi && typeof listApi.getTableName === "function"
                  ? String(listApi.getTableName() || "")
                  : "";
              const tableFromUrl = serviceNowListMatch?.[1] || "";
              const tableName = tableFromList || tableFromUrl;
              if (!tableName || !serviceNowListMatch) {
                return {
                  ok: false,
                  reason: "not_servicenow_list_frame",
                  url: location.href,
                  title: document.title,
                };
              }
              if (payload.table) {
                const requested = keyFor(payload.table);
                const title = keyFor(document.title);
                if (
                  requested &&
                  requested !== keyFor(tableName) &&
                  !title.includes(requested)
                ) {
                  return {
                    ok: false,
                    reason: "table_mismatch",
                    table: tableName,
                    url: location.href,
                    title: document.title,
                  };
                }
              }

              const tables = [
                ...document.querySelectorAll(
                  "table.data_list_table, table, [role='grid'], [role='table']",
                ),
              ];
              const rows = tables.flatMap((table) => [
                ...table.querySelectorAll("tr, [role='row']"),
              ]);
              const matchedRows: Array<{ record: string; row: Element }> = [];
              const missing: string[] = [];
              for (const record of payload.records) {
                const needle = normalize(record);
                const row = rows.find((candidate) =>
                  normalize(candidate.textContent).includes(needle),
                );
                if (row) matchedRows.push({ record, row });
                else missing.push(record);
              }
              if (missing.length > 0) {
                return {
                  ok: false,
                  reason: "rows_not_found",
                  table: tableName,
                  missing,
                  sampledRows: rows
                    .map((row) => normalize(row.textContent).slice(0, 220))
                    .filter(Boolean)
                    .slice(0, 12),
                  url: location.href,
                };
              }

              const selected: string[] = [];
              for (const match of matchedRows) {
                const checkbox = match.row.querySelector<HTMLElement>(
                  "input[type='checkbox']:not([disabled]), [role='checkbox']:not([aria-disabled='true'])",
                );
                if (!checkbox) {
                  return {
                    ok: false,
                    reason: "row_checkbox_not_found",
                    table: tableName,
                    record: match.record,
                    rowText: normalize(match.row.textContent).slice(0, 240),
                    url: location.href,
                  };
                }
                const checked =
                  checkbox instanceof HTMLInputElement
                    ? checkbox.checked
                    : checkbox.getAttribute("aria-checked") === "true";
                if (!checked) {
                  checkbox.click();
                  checkbox.dispatchEvent(new Event("input", { bubbles: true }));
                  checkbox.dispatchEvent(
                    new Event("change", { bubbles: true }),
                  );
                }
                selected.push(match.record);
              }
              await sleep(150);

              const actionNeedle = keyFor(payload.action);
              const optionSelect = [
                ...document.querySelectorAll<HTMLSelectElement>("select"),
              ].find((select) =>
                [...select.options].some(
                  (option) =>
                    keyFor(option.textContent || option.label) === actionNeedle,
                ),
              );
              let appliedAction = "";
              if (optionSelect) {
                const option = [...optionSelect.options].find(
                  (candidate) =>
                    keyFor(candidate.textContent || candidate.label) ===
                    actionNeedle,
                );
                if (!option) {
                  return {
                    ok: false,
                    reason: "action_option_not_found",
                    table: tableName,
                    action: payload.action,
                    url: location.href,
                  };
                }
                optionSelect.value = option.value;
                option.selected = true;
                optionSelect.dispatchEvent(
                  new Event("input", { bubbles: true }),
                );
                optionSelect.dispatchEvent(
                  new Event("change", { bubbles: true }),
                );
                appliedAction =
                  option.textContent?.trim() || option.label || payload.action;
              } else {
                const controls = [
                  ...document.querySelectorAll<HTMLElement>(
                    "button, a, [role='button'], [role='menuitem']",
                  ),
                ];
                const control = controls.find(
                  (candidate) =>
                    keyFor(
                      candidate.textContent ||
                        candidate.getAttribute("aria-label"),
                    ) === actionNeedle,
                );
                if (!control) {
                  return {
                    ok: false,
                    reason: "action_control_not_found",
                    table: tableName,
                    action: payload.action,
                    availableActions: controls
                      .map((control) =>
                        normalize(
                          control.textContent ||
                            control.getAttribute("aria-label"),
                        ),
                      )
                      .filter(Boolean)
                      .slice(0, 40),
                    url: location.href,
                  };
                }
                control.click();
                appliedAction =
                  control.textContent?.trim() ||
                  control.getAttribute("aria-label") ||
                  payload.action;
              }

              await sleep(350);
              const related = payload.relatedRecord
                ? await fillRelatedReference()
                : null;
              if (related && related.ok === false) {
                return {
                  ok: false,
                  reason: related.reason,
                  table: tableName,
                  action: payload.action,
                  relatedRecord: payload.relatedRecord,
                  availableFields: related.availableFields,
                  url: location.href,
                };
              }
              let confirmed = false;
              if (payload.confirm) {
                const confirmControls = [
                  ...document.querySelectorAll<HTMLElement>(
                    "[role='dialog'] button, .modal button, .modal-footer button, button, [role='button']",
                  ),
                ];
                const confirmControl = confirmControls.find((control) =>
                  /^(ok|yes|delete|confirm|continue|submit)$/i.test(
                    normalize(
                      control.textContent || control.getAttribute("aria-label"),
                    ),
                  ),
                );
                if (confirmControl) {
                  confirmControl.click();
                  confirmed = true;
                  await sleep(350);
                }
              }

              return {
                ok: true,
                platform: "servicenow",
                table: tableName,
                selected,
                action: appliedAction,
                related,
                confirmed,
                frameUrl: location.href,
              };
            },
            args: [
              {
                records,
                action,
                relatedRecord,
                relatedField,
                table: effectiveTable,
                confirm,
              },
            ],
          }),
          12_000,
          "apply_list_action",
        );

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter(Boolean);
        const applied = plans.find((plan) => plan?.ok === true);
        if (!applied) {
          const failed = plans.find((plan) => typeof plan?.reason === "string");
          const reason = failed?.reason || "no_supported_list_surface";
          const missing = Array.isArray(failed?.missing)
            ? ` Missing: ${(failed.missing as string[]).join(", ")}.`
            : "";
          const sampledRows = Array.isArray(failed?.sampledRows)
            ? ` Sampled rows: ${(failed.sampledRows as string[])
                .slice(0, 6)
                .join(" | ")}`
            : "";
          return `Error: Could not apply ServiceNow list action (${String(reason)}).${missing}${sampledRows}`;
        }

        const selected = Array.isArray(applied.selected)
          ? (applied.selected as string[]).join(", ")
          : records.join(", ");
        return [
          `Applied ServiceNow list action "${String(applied.action || action)}" on ${String(applied.table || "list")}.`,
          `Selected rows: ${selected}`,
          applied.related &&
          typeof applied.related === "object" &&
          (applied.related as Record<string, unknown>).ok === true
            ? `Related record: ${String((applied.related as Record<string, unknown>).field || relatedField || "reference")} = ${String((applied.related as Record<string, unknown>).display || relatedRecord)}`
            : "",
          `Confirmed dialog: ${String(Boolean(applied.confirmed))}`,
        ]
          .filter(Boolean)
          .join("\n");
      } catch (e: any) {
        return `Error applying ServiceNow list action: ${e.message}`;
      }
    },
  );
}
