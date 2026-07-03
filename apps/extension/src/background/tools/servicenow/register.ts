/**
 * ServiceNow adapter — tool registrations.
 *
 * Registers the two ServiceNow-specific tools (open_servicenow_module,
 * configure_servicenow_form) against a ToolRegistry. Called from
 * registerTools() in tools/index.ts at the tools' original positions so
 * the LLM-facing definition order is unchanged.
 *
 * Import-direction rule: servicenow/* must never import "../index" or
 * the "../tools" barrel — only ../helpers and concrete siblings.
 */

import type { ToolRegistry } from "../registry";
import { ToolName, EvidenceEvent } from "../../../types";
import {
  OPEN_SERVICENOW_MODULE_DEF,
  CONFIGURE_SERVICENOW_FORM_DEF,
} from "../definitions";
import { waitForNavigation } from "../bridge";
import { withTimeout } from "../helpers";
import {
  waitForContentScriptReady,
  waitForDomReady,
  clearTabReady,
} from "../../tab-ready";
import { logger } from "../../../utils";
import {
  CONFIGURE_SERVICENOW_FORM_SCRIPT_TIMEOUT_MS,
  resolveServiceNowRecordUrl,
  serviceNowRecordExistsBySysId,
  hasServiceNowIdentityFields,
  resolveServiceNowRecordSysIdByFields,
  retryServiceNowNativeSubmit,
  serviceNowRecordUrlForSysId,
  collectServiceNowSubmitDiagnostics,
  type ServiceNowSubmittedRecordField,
} from "./records";
import {
  getServiceNowTabOrigin,
  detectAlreadyOpenServiceNowModule,
  resolveServiceNowModule,
  prepareServiceNowNavigatorCandidate,
  prepareServiceNowSnapshotNavigatorCandidate,
  commitResolvedServiceNowModule,
  commitServiceNowNavigatorCandidate,
  withServiceNowTiming,
  summarizeServiceNowMetadataOutcome,
  summarizeServiceNowNavigatorOutcome,
  serviceNowModuleEvidence,
  summarizeServiceNowModuleCandidates,
  type TimedServiceNowResult,
  type ResolvedServiceNowModule,
  type ServiceNowModuleResolutionFailure,
  type ServiceNowNavigatorCandidateResult,
} from "./navigation";

export function registerOpenServiceNowModuleTool(registry: ToolRegistry): void {
  registry.register(
    ToolName.OPEN_SERVICENOW_MODULE,
    OPEN_SERVICENOW_MODULE_DEF,
    async (args, tabId) => {
      const application =
        typeof args.application === "string" ? args.application.trim() : "";
      const path = Array.isArray(args.path)
        ? args.path
            .filter((segment): segment is string => typeof segment === "string")
            .map((segment) => segment.trim())
            .filter(Boolean)
        : [];
      const shouldRun = args.run !== false;

      if (path.length === 0) {
        return "Error: open_servicenow_module requires a non-empty path array.";
      }

      logger.info("tools", "open_servicenow_module", {
        tabId,
        application,
        path,
        shouldRun,
      });

      const originResult = await getServiceNowTabOrigin(tabId);
      if (!originResult.ok) {
        return [
          `Error: Could not resolve ServiceNow module (${originResult.reason}).`,
          `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
        ].join("\n");
      }

      const alreadyOpen = await detectAlreadyOpenServiceNowModule(
        tabId,
        originResult.origin,
        path,
      );
      if (alreadyOpen.ok) {
        const result = [
          "ServiceNow module is already open.",
          `Winning path: current_page`,
          `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
          `Page title: ${alreadyOpen.title}`,
          `Target: ${alreadyOpen.target}`,
          `URL: ${alreadyOpen.url}`,
          `Matched by: ${alreadyOpen.matchedBy.join("; ")}`,
        ].join("\n");
        return {
          result,
          evidence: serviceNowModuleEvidence({
            winningPath: "current_page",
            application: application || "unknown",
            path,
            moduleTitle: path[path.length - 1],
            target: alreadyOpen.target,
            targetUrl: alreadyOpen.url,
            matchedBy: alreadyOpen.matchedBy,
          }),
        };
      }

      if (!shouldRun) {
        const resolved = await resolveServiceNowModule(
          tabId,
          application,
          path,
          originResult.origin,
        );
        if (!resolved.ok) {
          const candidateLines = summarizeServiceNowModuleCandidates(
            resolved.candidates,
          );
          return [
            `Error: Could not resolve ServiceNow module (${resolved.reason}).`,
            `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
            resolved.candidateCount !== undefined
              ? `Candidate count: ${resolved.candidateCount}`
              : "",
            candidateLines ? `Top candidates:\n${candidateLines}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        }

        return [
          "Resolved ServiceNow module.",
          `Application: ${resolved.module.application || application || "unknown"}`,
          `Module: ${resolved.module.title}`,
          `Module sys_id: ${resolved.module.sysId}`,
          `Target: ${resolved.target}`,
          `Target URL: ${resolved.targetUrl}`,
          `Candidate count: ${resolved.candidateCount}`,
        ].join("\n");
      }

      const serviceCatalogRequested = [application, ...path]
        .join(" > ")
        .toLowerCase()
        .includes("service catalog");
      const reportsViewRunRequested = [application, ...path]
        .join(" > ")
        .toLowerCase()
        .match(/\breports?\b.*\b(view\/run|view run|view and run)\b/);
      if (reportsViewRunRequested) {
        const targetUrl = `${originResult.origin}/report_home.do?jvar_selected_tab=myReports`;
        clearTabReady(tabId);
        await chrome.tabs.update(tabId, { url: targetUrl });
        await waitForNavigation(tabId);
        await waitForContentScriptReady(tabId, 2000);
        const result = [
          "Opened ServiceNow module.",
          "Winning path: reports_view_run_direct",
          `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
          "Target: report_home.do?jvar_selected_tab=myReports",
          `Target URL: ${targetUrl}`,
        ].join("\n");
        return {
          result,
          evidence: serviceNowModuleEvidence({
            winningPath: "reports_view_run_direct",
            application: application || "Reports",
            path,
            moduleTitle: path[path.length - 1] || "View/Run",
            target: "report_home.do?jvar_selected_tab=myReports",
            targetUrl,
          }),
        };
      }
      if (serviceCatalogRequested) {
        const targetUrl = `${originResult.origin}/catalog_home.do?sysparm_view=catalog_default`;
        clearTabReady(tabId);
        await chrome.tabs.update(tabId, { url: targetUrl });
        await waitForNavigation(tabId);
        await waitForContentScriptReady(tabId, 2000);
        const result = [
          "Opened ServiceNow module.",
          "Winning path: service_catalog_direct",
          `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
          "Target: catalog_home.do?sysparm_view=catalog_default",
          `Target URL: ${targetUrl}`,
        ].join("\n");
        return {
          result,
          evidence: serviceNowModuleEvidence({
            winningPath: "service_catalog_direct",
            application: application || "Service Catalog",
            path,
            moduleTitle: path[path.length - 1] || "Service Catalog",
            target: "catalog_home.do?sysparm_view=catalog_default",
            targetUrl,
          }),
        };
      }

      const raceStartedAt = Date.now();
      let metadataOutcome: TimedServiceNowResult<
        ResolvedServiceNowModule | ServiceNowModuleResolutionFailure
      > | null = null;
      let navigatorOutcome: TimedServiceNowResult<ServiceNowNavigatorCandidateResult> | null =
        null;
      let metadataPending = true;
      let navigatorPending = true;
      let navigatorCommitFailure: string | null = null;
      const metadataPromise = withServiceNowTiming(
        resolveServiceNowModule(tabId, application, path, originResult.origin),
      ).then((outcome) => ({ source: "metadata" as const, outcome }));
      const navigatorPromise = withServiceNowTiming(
        (async () => {
          const snapshotCandidate =
            await prepareServiceNowSnapshotNavigatorCandidate(
              tabId,
              originResult.origin,
              application,
              path,
            );
          if (snapshotCandidate.ok) return snapshotCandidate;
          const navigatorCandidate = await prepareServiceNowNavigatorCandidate(
            tabId,
            originResult.origin,
            application,
            path,
          );
          if (navigatorCandidate.ok) return navigatorCandidate;
          return {
            ok: false,
            reason: `${snapshotCandidate.reason}; ${navigatorCandidate.reason}`,
          } as ServiceNowNavigatorCandidateResult;
        })(),
      ).then((outcome) => ({ source: "navigator" as const, outcome }));

      while (metadataPending || navigatorPending) {
        const next = await Promise.race(
          [
            metadataPending ? metadataPromise : null,
            navigatorPending ? navigatorPromise : null,
          ].filter(
            (
              promise,
            ): promise is typeof metadataPromise | typeof navigatorPromise =>
              Boolean(promise),
          ),
        );

        if (next.source === "metadata") {
          metadataPending = false;
          metadataOutcome = next.outcome;
          const resolved = metadataOutcome.value;
          if (resolved?.ok) {
            await commitResolvedServiceNowModule(tabId, resolved);
            const result = [
              "Opened ServiceNow module.",
              "Winning path: metadata",
              `Application: ${resolved.module.application || application || "unknown"}`,
              `Module: ${resolved.module.title}`,
              `Module sys_id: ${resolved.module.sysId}`,
              `Target: ${resolved.target}`,
              `Target URL: ${resolved.targetUrl}`,
              `Candidate count: ${resolved.candidateCount}`,
              summarizeServiceNowMetadataOutcome(
                metadataOutcome,
                raceStartedAt,
              ),
              summarizeServiceNowNavigatorOutcome(
                navigatorOutcome,
                raceStartedAt,
              ),
            ].join("\n");
            return {
              result,
              evidence: serviceNowModuleEvidence({
                winningPath: "metadata",
                application:
                  resolved.module.application || application || "unknown",
                path,
                moduleTitle: resolved.module.title,
                moduleSysId: resolved.module.sysId,
                target: resolved.target,
                targetUrl: resolved.targetUrl,
              }),
            };
          }
          continue;
        }

        navigatorPending = false;
        navigatorOutcome = next.outcome;
        const candidate = navigatorOutcome.value;
        if (candidate?.ok) {
          try {
            const commitPath = await commitServiceNowNavigatorCandidate(
              tabId,
              candidate,
            );
            if (commitPath !== "navigator_click_unavailable") {
              const result = [
                "Opened ServiceNow module via navigator fallback.",
                `Winning path: ${commitPath}`,
                `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
                `Navigator query: ${candidate.query}`,
                `Candidate: ${candidate.candidateText}`,
                candidate.target ? `Target: ${candidate.target}` : "",
                candidate.targetUrl ? `Target URL: ${candidate.targetUrl}` : "",
                summarizeServiceNowMetadataOutcome(
                  metadataOutcome,
                  raceStartedAt,
                ),
                summarizeServiceNowNavigatorOutcome(
                  navigatorOutcome,
                  raceStartedAt,
                ),
              ]
                .filter(Boolean)
                .join("\n");
              return {
                result,
                evidence: serviceNowModuleEvidence({
                  winningPath: commitPath,
                  application: application || "unknown",
                  path,
                  candidate: candidate.candidateText,
                  navigatorQuery: candidate.query,
                  target: candidate.target ?? null,
                  targetUrl: candidate.targetUrl ?? null,
                }),
              };
            }
            navigatorCommitFailure = commitPath;
          } catch (error) {
            navigatorCommitFailure =
              error instanceof Error
                ? error.message
                : "navigator_commit_failed";
          }
        }
      }

      const resolved = metadataOutcome?.value;
      const candidateLines =
        resolved && !resolved.ok
          ? summarizeServiceNowModuleCandidates(resolved.candidates)
          : "";
      return [
        `Error: Could not resolve ServiceNow module (${
          resolved && !resolved.ok
            ? resolved.reason
            : metadataOutcome?.error || "metadata_unavailable"
        }).`,
        `Requested: ${application ? `${application} > ` : ""}${path.join(" > ")}`,
        summarizeServiceNowMetadataOutcome(metadataOutcome, raceStartedAt),
        summarizeServiceNowNavigatorOutcome(navigatorOutcome, raceStartedAt),
        navigatorCommitFailure
          ? `Navigator commit reason: ${navigatorCommitFailure}`
          : "",
        resolved && !resolved.ok && resolved.candidateCount !== undefined
          ? `Candidate count: ${resolved.candidateCount}`
          : "",
        candidateLines ? `Top candidates:\n${candidateLines}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  );
}

export function registerConfigureServiceNowFormTool(registry: ToolRegistry): void {
  registry.register(
    ToolName.CONFIGURE_SERVICENOW_FORM,
    CONFIGURE_SERVICENOW_FORM_DEF,
    async (args, tabId) => {
      const fields = Array.isArray(args.fields)
        ? args.fields
            .filter(
              (field: any) =>
                typeof field?.field === "string" &&
                typeof field?.value === "string" &&
                field.field.trim(),
            )
            .map((field: any) => ({
              field: field.field.trim(),
              value: field.value,
            }))
        : [];
      const submit = args.submit === true;
      const submitButton =
        typeof args.submitButton === "string" && args.submitButton.trim()
          ? args.submitButton.trim()
          : null;

      if (fields.length === 0 && !submit) {
        return "Error: provide at least one field or set submit=true.";
      }

      try {
        let scriptTarget: { tabId: number; frameIds?: number[] } = { tabId };
        try {
          const tab = await chrome.tabs.get(tabId);
          const tableHints = new Set<string>();
          const collectTableHints = (url: string) => {
            for (const match of url.matchAll(
              /(?:target\/|\/)([a-z][a-z0-9_]*)\.do(?:[/?#]|$)/gi,
            )) {
              tableHints.add(match[1].toLowerCase());
            }
          };
          collectTableHints(tab.url || "");
          const frames =
            typeof chrome.webNavigation?.getAllFrames === "function"
              ? await chrome.webNavigation.getAllFrames({ tabId })
              : null;
          const frameScores = (frames || [])
            .map((frame) => {
              const frameUrl = String(frame.url || "");
              const url = frameUrl.toLowerCase();
              const isServiceNowHost =
                /^https:\/\/[^/]+\.service-now\.com\//i.test(frameUrl) ||
                /^https:\/\/[^/]+\.servicenow\.com\//i.test(frameUrl);
              if (!isServiceNowHost) return null;
              let score = frame.frameId === 0 ? 0 : 10;
              if (/\.do(?:[/?#]|$)/i.test(frameUrl)) score += 20;
              for (const tableHint of tableHints) {
                if (
                  url.includes(`/${tableHint}.do`) ||
                  url.includes(`target/${tableHint}.do`)
                ) {
                  score += 100;
                }
              }
              if (/about:blank|empty\.html|blank\.html/i.test(frameUrl)) {
                score -= 100;
              }
              return { frameId: frame.frameId, score };
            })
            .filter(
              (
                frame,
              ): frame is {
                frameId: number;
                score: number;
              } => Boolean(frame),
            )
            .sort((a, b) => b.score - a.score);
          const selectedFrame = frameScores[0];
          if (selectedFrame && selectedFrame.frameId !== 0) {
            scriptTarget = { tabId, frameIds: [selectedFrame.frameId] };
          }
        } catch {
          // Fall back to the current frame if frame metadata is unavailable.
        }

        await waitForDomReady(tabId, {
          timeoutMs: 5_000,
          waitForElements: true,
        });

        const results = await withTimeout(
          chrome.scripting.executeScript({
            target: scriptTarget,
            world: "MAIN" as any,
            func: async (input: {
              fields: Array<{ field: string; value: string }>;
              submit: boolean;
              submitButton: string | null;
            }) => {
              const normalize = (value: unknown) =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
            const keyFor = (value: unknown) =>
              normalize(value).replace(/[^a-z0-9]+/g, "");
            const display = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const escapeCss = (value: string) =>
              (window as any).CSS?.escape
                ? (window as any).CSS.escape(value)
                : value.replace(/["\\]/g, "\\$&");
            const isServiceNowHost =
              location.hostname.endsWith(".service-now.com") ||
              location.hostname.endsWith(".servicenow.com");
            const gForm = (window as any).g_form;
            if (!isServiceNowHost || !gForm) {
              return {
                matched: false,
                ok: false,
                reason: "not_servicenow_form_frame",
                url: location.href,
                title: document.title,
              };
            }

            type FieldMeta = {
              name: string;
              fieldPath: string;
              label: string;
              type: string;
              reference: string;
              control:
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement
                | null;
            };

            const normalizeFieldName = (raw: unknown): string => {
              const text = String(raw ?? "").trim();
              if (!text) return "";
              const withoutDisplay = text.replace(/^sys_display\./, "");
              return withoutDisplay.includes(".")
                ? withoutDisplay.slice(withoutDisplay.lastIndexOf(".") + 1)
                : withoutDisplay;
            };

            const controlFor = (
              fieldName: string,
            ):
              | HTMLInputElement
              | HTMLSelectElement
              | HTMLTextAreaElement
              | null => {
              const candidates: unknown[] = [];
              try {
                candidates.push(gForm.getControl?.(fieldName));
              } catch {
                // DOM fallback below.
              }
              const selectors = [
                `[name="${escapeCss(fieldName)}"]`,
                `[id="${escapeCss(fieldName)}"]`,
                `[name$=".${escapeCss(fieldName)}"]`,
                `[id$=".${escapeCss(fieldName)}"]`,
                `[name="sys_display.${escapeCss(fieldName)}"]`,
                `[id="sys_display.${escapeCss(fieldName)}"]`,
                `[name$=".${escapeCss(fieldName)}"][id^="sys_display."]`,
                `[id$=".${escapeCss(fieldName)}"][id^="sys_display."]`,
              ];
              for (const selector of selectors) {
                try {
                  candidates.push(document.querySelector(selector));
                } catch {
                  // Try the next selector.
                }
              }
              const controls = candidates.filter(
                (
                  candidate,
                ): candidate is
                  | HTMLInputElement
                  | HTMLSelectElement
                  | HTMLTextAreaElement =>
                  candidate instanceof HTMLInputElement ||
                  candidate instanceof HTMLSelectElement ||
                  candidate instanceof HTMLTextAreaElement,
              );
              return (
                controls.find(
                  (control) =>
                    !(
                      control instanceof HTMLInputElement &&
                      control.type === "hidden"
                    ),
                ) ??
                controls[0] ??
                null
              );
            };

            const fieldPathFor = (
              fieldName: string,
              control: Element | null,
            ) => {
              const raw =
                control?.getAttribute("name") ||
                control?.getAttribute("id") ||
                "";
              if (raw.startsWith("sys_display.")) {
                return raw.slice("sys_display.".length);
              }
              if (raw.endsWith(`.${fieldName}`)) return raw;
              return fieldName;
            };

            const labelFor = (fieldName: string, control: Element | null) => {
              const labels: string[] = [];
              try {
                const gLabel = gForm.getLabelOf?.(fieldName);
                if (gLabel) labels.push(String(gLabel));
              } catch {
                // Continue with DOM labels.
              }
              const id = control?.getAttribute("id") || "";
              if (id) {
                document
                  .querySelectorAll(`label[for="${escapeCss(id)}"]`)
                  .forEach((label) => labels.push(label.textContent || ""));
              }
              labels.push(
                control?.getAttribute("aria-label") || "",
                control?.getAttribute("title") || "",
                control?.getAttribute("placeholder") || "",
                control?.closest("label")?.textContent || "",
              );
              const clean = labels.map(display).find(Boolean);
              return clean || fieldName;
            };

            const commonReferenceTableForField = (fieldName: string) => {
              const refs: Record<string, string> = {
                assigned_to: "sys_user",
                caller_id: "sys_user",
                opened_by: "sys_user",
                resolved_by: "sys_user",
                assignment_group: "sys_user_group",
                department: "cmn_department",
                company: "core_company",
                location: "cmn_location",
                rfc: "change_request",
                problem_id: "problem",
                parent_incident: "incident",
                business_service: "cmdb_ci_service",
                service_offering: "service_offering",
                cmdb_ci: "cmdb_ci",
                model_category: "cmdb_model_category",
                model: "cmdb_model",
                vendor: "core_company",
                depreciation: "cmdb_depreciation",
              };
              return refs[fieldName] || "";
            };

            const isReferenceLikeControl = (
              fieldName: string,
              control: Element | null,
            ) => {
              if (commonReferenceTableForField(fieldName)) return true;
              if (control instanceof HTMLTextAreaElement) return false;
              if (
                control instanceof HTMLInputElement &&
                !/^sys_display\./i.test(
                  `${control.getAttribute("name") || ""} ${control.getAttribute("id") || ""}`,
                ) &&
                !fieldName.endsWith("_id")
              ) {
                return false;
              }
              const raw = [
                control?.getAttribute("name"),
                control?.getAttribute("id"),
                control?.getAttribute("role"),
                control?.getAttribute("aria-autocomplete"),
                control?.getAttribute("autocomplete"),
                control?.getAttribute("class"),
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              if (raw.includes("sys_display.")) return true;
              if (/\b(reference|lookup|typeahead|autocomplete)\b/.test(raw)) {
                return true;
              }
              if (
                control instanceof HTMLInputElement &&
                control.type.toLowerCase() === "search" &&
                fieldName.endsWith("_id")
              ) {
                return true;
              }
              try {
                const lookup = document.getElementById(
                  `lookup.${fieldPathFor(fieldName, control)}`,
                );
                if (!lookup) return false;
                const lookupText = [
                  lookup.getAttribute("aria-label"),
                  lookup.getAttribute("title"),
                  lookup.getAttribute("name"),
                  lookup.textContent,
                ]
                  .map(display)
                  .join(" ")
                  .toLowerCase();
                return /\blook\s*up\s+value\b|\breference\b/.test(lookupText);
              } catch {
                return false;
              }
            };

            const referenceFor = (
              fieldName: string,
              control: Element | null,
            ) => {
              const commonReference = commonReferenceTableForField(fieldName);
              if (commonReference) return commonReference;
              if (!isReferenceLikeControl(fieldName, control)) return "";

              try {
                const uiElement =
                  gForm.getGlideUIElement?.(fieldName) ??
                  gForm.getControl?.(fieldName) ??
                  null;
                for (const prop of [
                  "reference",
                  "referenceTable",
                  "refTable",
                  "refName",
                  "tableName",
                ]) {
                  const propValue = uiElement?.[prop];
                  if (typeof propValue === "string" && propValue) {
                    return propValue;
                  }
                }
              } catch {
                // DOM fallback below.
              }
              const attr =
                control?.getAttribute("data-ref") ||
                control?.getAttribute("data-reference") ||
                control?.getAttribute("reference") ||
                "";
              return attr;
            };

            const fieldNames = new Set<string>();
            try {
              const names = gForm.getFieldNames?.();
              if (Array.isArray(names)) {
                names.forEach((name) => {
                  const normalized = normalizeFieldName(name);
                  if (normalized) fieldNames.add(normalized);
                });
              }
            } catch {
              // DOM field discovery below.
            }
            document
              .querySelectorAll(
                "input[name], select[name], textarea[name], input[id], select[id], textarea[id]",
              )
              .forEach((el) => {
                const raw =
                  el.getAttribute("name") || el.getAttribute("id") || "";
                const fieldName = normalizeFieldName(raw);
                if (
                  fieldName &&
                  !/^(sys_|ni_|label_|lookup_|sys_original)/i.test(fieldName)
                ) {
                  fieldNames.add(fieldName);
                }
              });

            const fieldsMeta: FieldMeta[] = [...fieldNames].map((name) => {
              const control = controlFor(name);
              const type =
                control instanceof HTMLSelectElement
                  ? "choice"
                  : control instanceof HTMLInputElement
                    ? control.type || "text"
                    : control instanceof HTMLTextAreaElement
                      ? "textarea"
                      : "";
              return {
                name,
                fieldPath: fieldPathFor(name, control),
                label: labelFor(name, control),
                type,
                reference: referenceFor(name, control),
                control,
              };
            });

            const matchField = (requested: string) => {
              const requestedKey = keyFor(requested);
              const exact = fieldsMeta.find(
                (field) =>
                  keyFor(field.label) === requestedKey ||
                  keyFor(field.name) === requestedKey,
              );
              if (exact) return exact;
              return (
                fieldsMeta.find((field) => {
                  const labelKey = keyFor(field.label);
                  const nameKey = keyFor(field.name);
                  return (
                    labelKey.includes(requestedKey) ||
                    requestedKey.includes(labelKey) ||
                    nameKey.includes(requestedKey) ||
                    requestedKey.includes(nameKey)
                  );
                }) ?? null
              );
            };

            const readNativeControlValue = (
              control:
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement
                | null,
              includeHidden = false,
            ): string | null => {
              if (control instanceof HTMLSelectElement) {
                return display(
                  control.selectedOptions[0]?.textContent || control.value,
                );
              }
              if (control instanceof HTMLInputElement) {
                if (control.type === "hidden" && !includeHidden) return null;
                if (control.type === "checkbox") {
                  return control.checked ? "true" : "false";
                }
                return display(control.value);
              }
              if (control instanceof HTMLTextAreaElement) {
                return display(control.value);
              }
              return null;
            };

            const readValue = (field: FieldMeta) => {
              const nativeValue = readNativeControlValue(field.control);
              if (nativeValue !== null) return nativeValue;

              try {
                const displayBox = gForm.getDisplayBox?.(field.name);
                const displayBoxValue =
                  displayBox && displayBox instanceof HTMLInputElement
                    ? display(displayBox.value)
                    : "";
                if (displayBoxValue) return displayBoxValue;
              } catch {
                // Fall through.
              }

              try {
                const value = gForm.getValue?.(field.name);
                if (value !== undefined && value !== null) {
                  const rendered = display(value);
                  if (rendered || !field.control) return rendered;
                }
              } catch {
                // Fall through.
              }

              return readNativeControlValue(field.control, true) ?? "";
            };

            const hiddenControlsFor = (field: FieldMeta) => {
              const candidates: unknown[] = [
                document.getElementById(field.fieldPath),
                ...Array.from(document.getElementsByName(field.fieldPath)),
                document.getElementById(field.name),
                ...Array.from(document.getElementsByName(field.name)),
              ];
              for (const selector of [
                `[name$=".${escapeCss(field.name)}"]:not([name^="sys_display."])`,
                `[id$=".${escapeCss(field.name)}"]:not([id^="sys_display."])`,
              ]) {
                try {
                  candidates.push(
                    ...Array.from(document.querySelectorAll(selector)),
                  );
                } catch {
                  // Continue with direct candidates.
                }
              }
              const seen = new Set<HTMLInputElement>();
              const controls = candidates.filter(
                (candidate): candidate is HTMLInputElement => {
                  if (
                    !(candidate instanceof HTMLInputElement) ||
                    candidate === field.control ||
                    seen.has(candidate)
                  ) {
                    return false;
                  }
                  seen.add(candidate);
                  const identity = `${candidate.name || ""} ${candidate.id || ""}`;
                  return !/^sys_display\./i.test(identity);
                },
              );
              return controls.sort((a, b) => {
                const aOriginal = /^sys_original\./i.test(
                  `${a.name || ""} ${a.id || ""}`,
                );
                const bOriginal = /^sys_original\./i.test(
                  `${b.name || ""} ${b.id || ""}`,
                );
                return Number(aOriginal) - Number(bOriginal);
              });
            };

            const hiddenControlFor = (field: FieldMeta) => {
              return hiddenControlsFor(field)[0] ?? null;
            };

            const readCommittedReferenceValue = (field: FieldMeta) => {
              const hidden = hiddenControlFor(field);
              const hiddenValue = hidden?.value?.trim() || "";
              if (hiddenValue) return hiddenValue;

              try {
                const value = gForm.getValue?.(field.name);
                if (typeof value === "string" && value.trim()) {
                  return value.trim();
                }
              } catch {
                // Fall through to hidden field lookup.
              }
              return "";
            };

            const isCommittedReferenceValue = (
              committed: string,
              displayValue: string,
              sysId?: string,
            ) => {
              if (!committed) return false;
              if (sysId) return normalize(committed) === normalize(sysId);
              return normalize(committed) !== normalize(displayValue);
            };

            const setNativeValue = (
              control:
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement
                | null,
              value: string,
            ) => {
              if (!control) return;
              if (
                control instanceof HTMLInputElement &&
                control.type === "checkbox"
              ) {
                control.checked = /^(true|yes|checked|1)$/i.test(value);
              } else {
                const descriptor =
                  Object.getOwnPropertyDescriptor(
                    Object.getPrototypeOf(control),
                    "value",
                  ) ||
                  Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype,
                    "value",
                  );
                if (descriptor?.set) descriptor.set.call(control, value);
                control.value = value;
              }
              control.dispatchEvent(new Event("input", { bubbles: true }));
              control.dispatchEvent(new Event("change", { bubbles: true }));
              control.dispatchEvent(new Event("blur", { bubbles: true }));
            };

            const delay = (ms: number) =>
              new Promise((resolve) => setTimeout(resolve, ms));
            const isVisibleControl = (control: Element | null): boolean => {
              if (!control?.isConnected) return false;
              const view = control.ownerDocument?.defaultView ?? window;
              let node: Element | null = control;
              while (node) {
                const style = view.getComputedStyle(node);
                if (
                  style.display === "none" ||
                  style.visibility === "hidden" ||
                  style.opacity === "0"
                ) {
                  return false;
                }
                node = node.parentElement;
              }
              const rect = control.getBoundingClientRect();
              return rect.width > 0 || rect.height > 0;
            };
            const revealFieldSection = async (field: FieldMeta) => {
              if (isVisibleControl(field.control)) return false;
              let sectionId = "";
              try {
                const element = gForm.getElement?.(field.name);
                const ancestors =
                  typeof element?.ancestors === "function"
                    ? element.ancestors()
                    : [];
                for (const ancestor of ancestors) {
                  const id = String(ancestor?.id || "");
                  if (id.startsWith("section-")) {
                    sectionId = id;
                    break;
                  }
                }
              } catch {
                // DOM fallback below.
              }
              if (!sectionId) {
                let node = field.control?.parentElement ?? null;
                while (node) {
                  if (node.id?.startsWith("section-")) {
                    sectionId = node.id;
                    break;
                  }
                  node = node.parentElement;
                }
              }
              const sectionName = sectionId.replace(/^section-/, "");
              if (!sectionName) return false;

              try {
                const tabs = (window as any).g_tabs2Sections;
                const tabIDs = Array.isArray(tabs?.tabIDs) ? tabs.tabIDs : [];
                const index = tabIDs.findIndex((value: unknown) => {
                  const raw = String(value || "");
                  const suffix = raw.split(".").pop() || raw;
                  return (
                    raw === sectionName ||
                    suffix === sectionName ||
                    keyFor(raw) === keyFor(sectionName) ||
                    keyFor(suffix) === keyFor(sectionName)
                  );
                });
                const tabElement = index >= 0 ? tabs?.tabsTabs?.[index]?.element : null;
                if (tabElement instanceof HTMLElement) {
                  tabElement.click();
                  await delay(100);
                  return true;
                }
              } catch {
                // DOM fallback below.
              }

              const sectionKey = keyFor(sectionName);
              const tab = Array.from(
                document.querySelectorAll(
                  '[role="tab"], [aria-controls], [id*="tab"], .tabs2_tab, .tab_caption',
                ),
              ).find((node): node is HTMLElement => {
                if (!(node instanceof HTMLElement)) return false;
                const identity = keyFor(
                  [
                    node.id,
                    node.textContent,
                    node.getAttribute("aria-controls"),
                    node.getAttribute("aria-label"),
                    node.getAttribute("title"),
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
                return Boolean(sectionKey && identity.includes(sectionKey));
              });
              if (tab) {
                tab.click();
                await delay(100);
                return true;
              }
              return false;
            };

            const commitReferenceValue = (
              field: FieldMeta,
              sysId: string,
              displayValue: string,
            ) => {
              if (!sysId) return false;
              let committed = false;
              try {
                gForm.setValue?.(field.name, sysId, displayValue);
                committed = true;
              } catch {
                // Hidden field fallback below covers frames without usable g_form.
              }

              const hiddenControls = hiddenControlsFor(field);
              for (const hidden of hiddenControls) {
                setNativeValue(hidden, sysId);
                hidden.setAttribute("value", sysId);
                committed = true;
              }

              setNativeValue(field.control, displayValue);
              if (field.control instanceof HTMLInputElement) {
                field.control.setAttribute("value", displayValue);
              }
              return committed;
            };

            const unwrap = (value: unknown): string => {
              if (typeof value === "string") return value;
              if (value && typeof value === "object") {
                const obj = value as Record<string, unknown>;
                if (typeof obj.value === "string") return obj.value;
                if (typeof obj.display_value === "string")
                  return obj.display_value;
              }
              return "";
            };

            const resolveReference = async (
              referenceTable: string,
              rawDisplayValue: string,
            ): Promise<{ sysId: string; displayValue: string } | null> => {
              const displayValue = rawDisplayValue.trim();
              if (!referenceTable || !displayValue) return null;
              const clean = displayValue.replace(/\^/g, "");
              const queryFields = [
                "name",
                "display_name",
                "number",
                "user_name",
                "email",
                "first_name",
                "last_name",
              ];
              const fetchRecords = async (query: string) => {
                const params = new URLSearchParams({
                  sysparm_query: query,
                  sysparm_fields:
                    "sys_id,name,display_name,number,user_name,email,first_name,last_name",
                  sysparm_limit: "5",
                  sysparm_display_value: "all",
                });
                const headers: Record<string, string> = {
                  Accept: "application/json",
                };
                const token = String((window as any).g_ck || "");
                if (token) headers["X-UserToken"] = token;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 4_000);
                try {
                  const response = await fetch(
                    `/api/now/table/${encodeURIComponent(referenceTable)}?${params.toString()}`,
                    {
                      credentials: "same-origin",
                      headers,
                      signal: controller.signal,
                    },
                  );
                  if (!response.ok) return [];
                  const payload = await response.json();
                  return Array.isArray(payload?.result) ? payload.result : [];
                } catch {
                  return [];
                } finally {
                  clearTimeout(timer);
                }
              };
              let records: Array<Record<string, unknown>> = [];
              for (const field of [
                "name",
                "display_name",
                "number",
                "user_name",
                "email",
              ]) {
                records = await fetchRecords(`${field}=${clean}`);
                if (records.length > 0) break;
              }
              if (records.length === 0 && referenceTable === "sys_user") {
                const parts = clean.split(/\s+/).filter(Boolean);
                const firstName = parts[0] || "";
                const lastName = parts.slice(1).join(" ");
                if (firstName && lastName) {
                  records = await fetchRecords(
                    `first_name=${firstName}^last_name=${lastName}`,
                  );
                }
              }
              if (records.length === 0) {
                records = await fetchRecords(
                  ["name", "display_name", "user_name", "email"]
                    .map((field) => `${field}LIKE${clean}`)
                    .join("^OR"),
                );
              }
              const selected =
                records.find((record: Record<string, unknown>) => {
                  const exact = queryFields.some(
                    (field) =>
                      normalize(unwrap(record[field])) === normalize(clean),
                  );
                  const fullName =
                    `${unwrap(record.first_name)} ${unwrap(record.last_name)}`.trim();
                  return exact || normalize(fullName) === normalize(clean);
                }) ?? records[0];
              const sysId = unwrap(selected?.sys_id);
              const selectedDisplay =
                unwrap(selected?.name) ||
                unwrap(selected?.display_name) ||
                `${unwrap(selected?.first_name)} ${unwrap(selected?.last_name)}`.trim() ||
                displayValue;
              return sysId ? { sysId, displayValue: selectedDisplay } : null;
            };

            type FieldSetSuccess = {
              ok: true;
              acceptedDisplay?: string;
              acceptedSysId?: string;
            };
            type FieldSetResult =
              | FieldSetSuccess
              | { ok: false; reason: string };

            const selectReferenceAutocomplete = async (
              field: FieldMeta,
              rawDisplayValue: string,
            ): Promise<FieldSetResult> => {
              const input =
                field.control instanceof HTMLInputElement
                  ? field.control
                  : null;
              if (!input) return { ok: false, reason: "field_not_found" };
              const displayValue = rawDisplayValue.trim();
              if (!displayValue)
                return { ok: false, reason: "empty_display_value" };

              const delay = (ms: number) =>
                new Promise((resolve) => setTimeout(resolve, ms));
              const normalizedDisplay = normalize(displayValue);
              const view = input.ownerDocument?.defaultView ?? window;
              const setter = Object.getOwnPropertyDescriptor(
                view.HTMLInputElement.prototype,
                "value",
              )?.set;
              const setInputValue = (nextValue: string) => {
                if (setter) {
                  setter.call(input, nextValue);
                } else {
                  input.value = nextValue;
                }
              };
              const dispatchKeyboard = (
                type: string,
                key: string,
                init: KeyboardEventInit = {},
              ) => {
                const keyCode =
                  key === "Enter"
                    ? 13
                    : key === "Backspace"
                      ? 8
                      : key.length === 1
                        ? key.toUpperCase().charCodeAt(0)
                        : undefined;
                input.dispatchEvent(
                  new view.KeyboardEvent(type, {
                    key,
                    code: key === "Enter" ? "Enter" : undefined,
                    keyCode,
                    which: keyCode,
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    ...init,
                  }),
                );
              };
              const dispatchInput = (
                data: string | null,
                inputType: string,
              ) => {
                input.dispatchEvent(
                  new view.InputEvent("input", {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    data,
                    inputType,
                  }),
                );
              };
              const emitAutocompleteSearch = async (searchValue: string) => {
                input.focus();
                try {
                  input.setSelectionRange(0, input.value.length);
                } catch {
                  // Some specialized inputs do not support selection ranges.
                }
                dispatchKeyboard("keydown", "a", { ctrlKey: true });
                dispatchKeyboard("keyup", "a", { ctrlKey: true });
                dispatchKeyboard("keydown", "Backspace");
                setInputValue("");
                dispatchInput(null, "deleteContentBackward");
                dispatchKeyboard("keyup", "Backspace");
                for (const char of searchValue) {
                  dispatchKeyboard("keydown", char);
                  setInputValue(input.value + char);
                  dispatchInput(char, "insertText");
                  dispatchKeyboard("keyup", char);
                  await delay(15);
                }
                input.dispatchEvent(
                  new view.Event("change", { bubbles: true, composed: true }),
                );
                dispatchKeyboard("keydown", searchValue.slice(-1) || " ");
                dispatchKeyboard("keyup", searchValue.slice(-1) || " ");
              };
              const isVisible = (node: Element): boolean => {
                if (!node.isConnected) return false;
                const style = view.getComputedStyle(node);
                if (
                  style.display === "none" ||
                  style.visibility === "hidden" ||
                  style.opacity === "0"
                ) {
                  return false;
                }
                const rect = node.getBoundingClientRect();
                return (
                  rect.width > 0 ||
                  rect.height > 0 ||
                  !!node.textContent?.trim()
                );
              };
              const optionSelectors = [
                '[role="option"]',
                "tr[role='option']",
                ".ac_results tr",
                ".ac_results li",
                ".autocomplete tr",
                ".autocomplete li",
                ".typeahead tr",
                ".typeahead li",
                ".select2-results__option",
                ".ui-menu-item",
                "li.ui-menu-item",
                "[id^='AC.'] tr",
                "[id^='AC.'] li",
                "[aria-selected]",
              ];
              const optionMatches = (node: Element): boolean => {
                const text = normalize(node.textContent ?? "");
                if (!text) return false;
                if (text.includes(normalizedDisplay)) return true;
                const tokens = normalizedDisplay.split(" ").filter(Boolean);
                return (
                  tokens.length > 0 &&
                  tokens.every((token) => text.includes(token))
                );
              };
              const findMatchingOption = (): HTMLElement | null => {
                const seen = new Set<Element>();
                for (const optionSelector of optionSelectors) {
                  for (const node of Array.from(
                    document.querySelectorAll(optionSelector),
                  )) {
                    if (seen.has(node)) continue;
                    seen.add(node);
                    if (
                      node instanceof HTMLElement &&
                      isVisible(node) &&
                      optionMatches(node)
                    ) {
                      return node;
                    }
                  }
                }
                return null;
              };
              const extractSysId = (node: Element): string => {
                const attrs = [
                  "sys_id",
                  "sys-id",
                  "data-sys-id",
                  "data-sysid",
                  "data-value",
                  "data-id",
                  "value",
                ];
                for (const attr of attrs) {
                  const value = node.getAttribute(attr);
                  if (value && /^[0-9a-f]{32}$/i.test(value)) return value;
                }
                const htmlMatch = node.outerHTML.match(/[0-9a-f]{32}/i);
                return htmlMatch?.[0] ?? "";
              };
              const clickOption = (option: HTMLElement) => {
                option.scrollIntoView?.({ block: "center", inline: "center" });
                const rect = option.getBoundingClientRect();
                const clientX = rect.left + rect.width / 2;
                const clientY = rect.top + rect.height / 2;
                const mouseInit: MouseEventInit = {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  view,
                  clientX,
                  clientY,
                  button: 0,
                };
                const pointerInit: PointerEventInit = {
                  ...mouseInit,
                  pointerId: 1,
                  pointerType: "mouse",
                  isPrimary: true,
                };
                try {
                  option.dispatchEvent(
                    new view.PointerEvent("pointerdown", {
                      ...pointerInit,
                      buttons: 1,
                    }),
                  );
                } catch {
                  // PointerEvent may be unavailable in older page contexts.
                }
                option.dispatchEvent(
                  new view.MouseEvent("mousedown", {
                    ...mouseInit,
                    buttons: 1,
                  }),
                );
                try {
                  option.dispatchEvent(
                    new view.PointerEvent("pointerup", {
                      ...pointerInit,
                      buttons: 0,
                    }),
                  );
                } catch {
                  // PointerEvent may be unavailable in older page contexts.
                }
                option.dispatchEvent(new view.MouseEvent("mouseup", mouseInit));
                option.click();
              };

              if (
                isCommittedReferenceValue(
                  readCommittedReferenceValue(field),
                  displayValue,
                )
              ) {
                return { ok: true, acceptedDisplay: displayValue };
              }

              const rawTokens = displayValue.split(/\s+/).filter(Boolean);
              const searchValues = [
                displayValue,
                rawTokens[0],
                rawTokens[0]?.length > 3 ? rawTokens[0].slice(0, 3) : null,
              ].filter(
                (value, index, values): value is string =>
                  typeof value === "string" &&
                  value.trim().length > 0 &&
                  values.indexOf(value) === index,
              );

              for (const searchValue of searchValues) {
                for (let attempt = 0; attempt < 14; attempt++) {
                  if (attempt === 0 || attempt === 5) {
                    await emitAutocompleteSearch(searchValue);
                  }

                  const option = findMatchingOption();
                  if (option) {
                    const sysId = extractSysId(option);
                    if (
                      sysId &&
                      commitReferenceValue(field, sysId, displayValue)
                    ) {
                      await delay(100);
                      if (
                        isCommittedReferenceValue(
                          readCommittedReferenceValue(field),
                          displayValue,
                          sysId,
                        )
                      ) {
                        return {
                          ok: true,
                          acceptedDisplay: displayValue,
                          acceptedSysId: sysId,
                        };
                      }
                    }

                    clickOption(option);
                    for (let verify = 0; verify < 12; verify++) {
                      await delay(100);
                      if (
                        isCommittedReferenceValue(
                          readCommittedReferenceValue(field),
                          displayValue,
                        )
                      ) {
                        setNativeValue(field.control, displayValue);
                        return { ok: true, acceptedDisplay: displayValue };
                      }
                    }
                    return { ok: false, reason: "selection_unverified" };
                  }

                  await delay(100);
                }
              }

              dispatchKeyboard("keydown", "Enter");
              dispatchKeyboard("keyup", "Enter");
              for (let verify = 0; verify < 8; verify++) {
                await delay(100);
                if (
                  isCommittedReferenceValue(
                  readCommittedReferenceValue(field),
                  displayValue,
                )
              ) {
                setNativeValue(field.control, displayValue);
                return { ok: true, acceptedDisplay: displayValue };
              }
              }
              setInputValue(displayValue);
              input.dispatchEvent(
                new view.Event("change", { bubbles: true, composed: true }),
              );
              return { ok: false, reason: "no_matching_option" };
            };

            const setField = async (
              field: FieldMeta,
              value: string,
            ): Promise<FieldSetResult> => {
              await revealFieldSection(field);
              const desired = value;
              const choiceControl =
                field.control instanceof HTMLSelectElement
                  ? field.control
                  : null;
              if (choiceControl) {
                const option =
                  Array.from(choiceControl.options).find(
                    (candidate) =>
                      normalize(candidate.textContent) === normalize(desired) ||
                      normalize(candidate.value) === normalize(desired),
                  ) ??
                  Array.from(choiceControl.options).find((candidate) =>
                    normalize(candidate.textContent).includes(
                      normalize(desired),
                    ),
                  );
                const optionValue = option?.value ?? desired;
                try {
                  gForm.setValue?.(field.name, optionValue);
                } catch {
                  // DOM fallback below.
                }
                setNativeValue(choiceControl, optionValue);
                return { ok: true };
              }

              if (
                field.control instanceof HTMLInputElement &&
                field.control.type === "checkbox"
              ) {
                const boolValue = /^(true|yes|checked|1)$/i.test(desired);
                try {
                  gForm.setValue?.(field.name, boolValue ? "true" : "false");
                } catch {
                  // DOM fallback below.
                }
                setNativeValue(field.control, boolValue ? "true" : "false");
                return { ok: true };
              }

              const referenceTable = field.reference;
              if (referenceTable) {
                if (!desired.trim()) {
                  try {
                    gForm.setValue?.(field.name, "");
                  } catch {
                    // DOM fallback below.
                  }
                  const hidden = hiddenControlFor(field);
                  if (hidden) setNativeValue(hidden, "");
                  setNativeValue(field.control, "");
                  return { ok: true, acceptedDisplay: "" };
                }

                const resolved = await resolveReference(
                  referenceTable,
                  desired,
                );
                if (resolved) {
                  commitReferenceValue(
                    field,
                    resolved.sysId,
                    resolved.displayValue,
                  );
                  if (
                    isCommittedReferenceValue(
                      readCommittedReferenceValue(field),
                      resolved.displayValue,
                      resolved.sysId,
                    )
                  ) {
                    return {
                      ok: true,
                      acceptedDisplay: resolved.displayValue,
                      acceptedSysId: resolved.sysId,
                    };
                  }
                }

                const selected = await selectReferenceAutocomplete(
                  field,
                  desired,
                );
                if (selected.ok) {
                  const committed = readCommittedReferenceValue(field);
                  return selected.acceptedSysId ||
                    !/^[0-9a-f]{32}$/i.test(committed)
                    ? selected
                    : { ...selected, acceptedSysId: committed };
                }
                return {
                  ok: false,
                  reason: resolved
                    ? `reference sys_id not committed; autocomplete ${selected.reason}`
                    : `reference value not resolved; autocomplete ${selected.reason}`,
                };
              }

              if (field.control) {
                try {
                  gForm.setValue?.(field.name, desired);
                } catch {
                  // DOM fallback below.
                }
                setNativeValue(field.control, desired);
                return { ok: true };
              }

              try {
                gForm.setValue?.(field.name, desired);
              } catch {
                // DOM fallback below.
              }
              setNativeValue(field.control, desired);
              return { ok: true };
            };

            const configured: string[] = [];
            const configuredFields: ServiceNowSubmittedRecordField[] = [];
            let configuredRecordNumber = "";
            const mismatches: string[] = [];
            const recordNumberFromText = (value: string): string => {
              return value.match(/\b[A-Z]{2,}\d+\b/i)?.[0]?.toUpperCase() ?? "";
            };
            const isRecordNumberField = (
              field: Pick<FieldMeta, "label" | "name" | "fieldPath">,
              requestedField = "",
            ) => {
              const terminalFieldName = field.fieldPath.includes(".")
                ? field.fieldPath.slice(field.fieldPath.lastIndexOf(".") + 1)
                : field.fieldPath;
              return [
                field.label,
                field.name,
                terminalFieldName,
                requestedField,
              ].some((value) => keyFor(value) === "number");
            };
            for (const requested of input.fields) {
              const field = matchField(requested.field);
              if (!field) {
                mismatches.push(`${requested.field}: field not found`);
                continue;
              }
              const setResult = await setField(field, requested.value);
              const actual = readValue(field);
              const expected = display(requested.value);
              const acceptedDisplay =
                setResult.ok && setResult.acceptedDisplay
                  ? setResult.acceptedDisplay
                  : "";
              const acceptedSysId =
                setResult.ok && setResult.acceptedSysId
                  ? setResult.acceptedSysId
                  : "";
              const committedReferenceValue = acceptedSysId
                ? readCommittedReferenceValue(field)
                : "";
              const normalizedActual = normalize(actual);
              const normalizedExpected = normalize(expected);
              const actualTokenCount = normalizedActual
                .split(" ")
                .filter(Boolean).length;
              const isReferenceDisplayAlias = Boolean(
                field.reference &&
                  actualTokenCount >= 2 &&
                  normalizedExpected.endsWith(normalizedActual),
              );
              const ok =
                setResult.ok &&
                (expected === ""
                  ? actual === "" || /^--\s*none\s*--$/i.test(actual)
                  : normalizedActual === normalizedExpected ||
                    normalizedActual.includes(normalizedExpected) ||
                    isReferenceDisplayAlias ||
                    (acceptedDisplay
                      ? normalizedActual === normalize(acceptedDisplay) ||
                        normalizedActual.includes(normalize(acceptedDisplay))
                      : false) ||
                    (acceptedSysId
                      ? actual.trim().toLowerCase() ===
                          acceptedSysId.toLowerCase() ||
                        normalize(committedReferenceValue) ===
                          normalize(acceptedSysId)
                      : false));
              const row = `${field.label || field.name} (${field.name}) = ${actual || "(empty)"}`;
              if (ok) {
                configured.push(row);
                configuredFields.push({
                  name: field.name,
                  label: field.label || field.name,
                  value: actual || requested.value,
                });
                if (isRecordNumberField(field, requested.field)) {
                  configuredRecordNumber =
                    recordNumberFromText(actual) ||
                    recordNumberFromText(requested.value) ||
                    configuredRecordNumber;
                }
              } else {
                const reason = setResult.ok ? "" : `; ${setResult.reason}`;
                mismatches.push(
                  `${row}; expected ${expected || "(empty)"}${reason}`,
                );
              }
            }
            const currentRecordNumber =
              configuredRecordNumber ||
              (() => {
                const numberField = fieldsMeta.find((field) =>
                  isRecordNumberField(field),
                );
                return numberField
                  ? recordNumberFromText(readValue(numberField))
                  : "";
              })();

            const recordFromTitle =
              document.title.match(/\bCreate\s+([A-Z]{2,}\d+)\b/i)?.[1] ||
              document.body?.innerText?.match(
                /\b(?:Number|Record)\s+([A-Z]{2,}\d+)\b/i,
              )?.[1] ||
              null;
            const tableName = (() => {
              try {
                const table = gForm.getTableName?.();
                if (table) return String(table);
              } catch {
                // Fall back to field paths below.
              }
              const fieldPath = fieldsMeta.find((field) =>
                field.fieldPath.includes("."),
              )?.fieldPath;
              return fieldPath ? fieldPath.split(".")[0] : "";
            })();

            let submitClicked = false;
            let submitLabel = "";
            let submitMethod = "";
            let submitActionName = "";
            let submittedSysId = "";
            const currentSysId = () => {
              try {
                const sysId = String(gForm.getUniqueValue?.() || "");
                if (/^[0-9a-f]{32}$/i.test(sysId)) return sysId;
              } catch {
                // Fall back to form controls below.
              }
              const candidates = [
                tableName ? `${tableName}.sys_id` : "",
                "sys_uniqueValue",
                "sys_id",
              ].filter(Boolean);
              for (const name of candidates) {
                const control = document.querySelector(
                  `[name="${escapeCss(name)}"], #${escapeCss(name)}`,
                ) as HTMLInputElement | null;
                const value = String(control?.value || "");
                if (/^[0-9a-f]{32}$/i.test(value)) return value;
              }
              return "";
            };
            if (input.submit && mismatches.length === 0) {
              submittedSysId = currentSysId();
              const expected = input.submitButton
                ? normalize(input.submitButton)
                : "";
              const isUsableSubmitControl = (control: HTMLElement) => {
                const style = getComputedStyle(control);
                const disabled =
                  "disabled" in control &&
                  Boolean(
                    (control as HTMLButtonElement | HTMLInputElement).disabled,
                  );
                return (
                  !disabled &&
                  style.display !== "none" &&
                  style.visibility !== "hidden"
                );
              };
              const submitTextFor = (control: HTMLElement) =>
                normalize(
                  [
                    control.textContent,
                    control.getAttribute("value"),
                    control.getAttribute("aria-label"),
                    control.getAttribute("title"),
                    control.getAttribute("id"),
                    control.getAttribute("name"),
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
              const actionNameFor = (control: HTMLElement) => {
                const candidates = [
                  control.getAttribute("name"),
                  control.getAttribute("value"),
                  control.getAttribute("id"),
                  control.getAttribute("data-action-name"),
                ].filter((value): value is string => Boolean(value));
                return (
                  candidates.find((value) =>
                    /\b(?:sysverb_insert|sysverb_update|sysverb_save|sysverb_submit)\b/i.test(
                      value,
                    ),
                  ) ||
                  candidates.find((value) => /\bsysverb_/i.test(value)) ||
                  ""
                );
              };
              const triggerSubmit = (control: HTMLElement) => {
                const actionName = actionNameFor(control);
                const formElement =
                  gForm.getFormElement?.() ||
                  control.closest("form") ||
                  document.querySelector("form");
                try {
                  control.click();
                  return { ok: true, method: "click", actionName };
                } catch {
                  // Fall back to ServiceNow submit APIs below.
                }
                if (
                  actionName &&
                  typeof (window as any).gsftSubmit === "function" &&
                  formElement
                ) {
                  try {
                    (window as any).gsftSubmit(null, formElement, actionName);
                    return { ok: true, method: "gsftSubmit", actionName };
                  } catch {
                    // Fall back to DOM click below.
                  }
                }
                if (actionName && typeof gForm.submit === "function") {
                  try {
                    gForm.submit(actionName);
                    return { ok: true, method: "g_form.submit", actionName };
                  } catch {
                    // Fall back to DOM click below.
                  }
                }
                control.click();
                return { ok: true, method: "click", actionName };
              };
              const controls = Array.from(
                document.querySelectorAll(
                  "button, input[type='submit'], input[type='button'], [role='button']",
                ),
              ) as HTMLElement[];
              const submitControl =
                controls.find((control) => {
                  if (!isUsableSubmitControl(control)) return false;
                  const text = submitTextFor(control);
                  if (!text) return false;
                  if (expected) return text.includes(expected);
                  return /\b(submit|save|update|insert)\b/i.test(text);
                }) ??
                controls.find((control) => {
                  if (!isUsableSubmitControl(control)) return false;
                  return Boolean(actionNameFor(control));
                }) ??
                null;
              if (submitControl) {
                submitLabel = display(
                  submitControl.textContent ||
                    submitControl.getAttribute("value") ||
                    submitControl.getAttribute("aria-label") ||
                    submitControl.getAttribute("id") ||
                    "submit",
                );
                const submitResult = triggerSubmit(submitControl);
                submitClicked = true;
                submitMethod = submitResult.method;
                submitActionName = submitResult.actionName;
              } else {
                mismatches.push("submit control not found");
              }
            }

            return {
              matched: true,
              ok: mismatches.length === 0 && (!input.submit || submitClicked),
              url: location.href,
              title: document.title,
              configured,
              configuredFields,
              mismatches,
              submitClicked,
              submitLabel,
              submitMethod,
              submitActionName,
              submittedRecord: submitClicked
                ? currentRecordNumber || recordFromTitle
                : null,
              submittedSysId: submitClicked ? submittedSysId : null,
              tableName,
              fieldCount: fieldsMeta.length,
            };
            },
            args: [{ fields, submit, submitButton }],
          }),
          CONFIGURE_SERVICENOW_FORM_SCRIPT_TIMEOUT_MS,
          "configure_servicenow_form script",
        );

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter((result): result is Record<string, unknown> =>
            Boolean(result),
          );
        const selected =
          plans.find((plan) => plan.ok === true) ||
          plans.find((plan) => plan.matched === true);
        if (!selected) {
          return "Error: Could not find a ServiceNow record form on the current page.";
        }

        if (selected.submitClicked === true) {
          await waitForNavigation(tabId, 12_000);
          await waitForDomReady(tabId, {
            timeoutMs: 2_000,
            waitForElements: true,
          });
        }

        let tab = await chrome.tabs.get(tabId);
        const configured = Array.isArray(selected.configured)
          ? selected.configured.map(String)
          : [];
        const configuredFields = Array.isArray(selected.configuredFields)
          ? selected.configuredFields
              .filter(
                (field): field is Record<string, unknown> =>
                  field !== null && typeof field === "object",
              )
              .map((field) => ({
                name: String(field.name || ""),
                label: String(field.label || ""),
                value: String(field.value || ""),
              }))
          : [];
        const mismatches = Array.isArray(selected.mismatches)
          ? selected.mismatches.map(String)
          : [];
        const submittedRecord =
          typeof selected.submittedRecord === "string"
            ? selected.submittedRecord
            : "";
        const submittedSysId =
          typeof selected.submittedSysId === "string" &&
          /^[0-9a-f]{32}$/i.test(selected.submittedSysId)
            ? selected.submittedSysId.toLowerCase()
            : "";
        const tableName =
          typeof selected.tableName === "string" ? selected.tableName : "";
        let currentUrl = tab.url || String(selected.url || "");
        let currentTitle = tab.title || String(selected.title || "");
        const escapeRegExp = (value: string) =>
          value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const computeSubmitStayedOnSameCreateRecord = () =>
          Boolean(
            submit &&
              submittedRecord &&
              new RegExp(
                `\\b(?:Create|New)\\s+${escapeRegExp(submittedRecord)}\\b`,
                "i",
              ).test(currentTitle),
          );
        const isLikelySameUncommittedForm = () => {
          if (!submit || selected.submitClicked !== true) return false;
          const selectedUrl = String(selected.url || "");
          const selectedTitle = String(selected.title || "");
          const currentUrlLower = currentUrl.toLowerCase();
          const selectedUrlLower = selectedUrl.toLowerCase();
          const sameLocation =
            Boolean(selectedUrl && currentUrl === selectedUrl) ||
            Boolean(
              tableName &&
                currentUrlLower.includes(`${tableName.toLowerCase()}.do`) &&
                selectedUrlLower.includes(`${tableName.toLowerCase()}.do`),
            );
          const titleLooksUncommitted =
            /\bnew record\b/i.test(currentTitle) ||
            /\bcreate\b/i.test(currentTitle) ||
            /\bnew record\b/i.test(selectedTitle);
          return sameLocation && titleLooksUncommitted;
        };
        let submitStayedOnSameCreateRecord =
          computeSubmitStayedOnSameCreateRecord();
        let resolvedSubmittedSysId = submittedSysId;
        let fallbackSubmitMethod = "";
        let fallbackSubmitActionName = "";
        let fallbackSubmittedSysId = "";
        const configuredFieldsContainIdentity =
          hasServiceNowIdentityFields(configuredFields);
        const verifySubmittedSysId = async (
          options: {
            quickIdentityLookup?: boolean;
            allowSubmittedSysIdLookup?: boolean;
          } = {},
        ) => {
          if (
            !submit ||
            selected.submitClicked !== true ||
            submittedRecord ||
            !tableName
          ) {
            return false;
          }
          if (configuredFieldsContainIdentity) {
            const sysIdFromFields =
              await resolveServiceNowRecordSysIdByFields(
                tabId,
                tableName,
                configuredFields,
                options.quickIdentityLookup
                  ? { attempts: 2, delayMs: 250, timeoutMs: 2_000 }
                  : undefined,
              );
            if (sysIdFromFields) {
              resolvedSubmittedSysId = sysIdFromFields;
              return true;
            }
          }
          const candidateSysId = fallbackSubmittedSysId || submittedSysId;
          if (options.allowSubmittedSysIdLookup !== false && candidateSysId) {
            const exists = await serviceNowRecordExistsBySysId(
              tabId,
              tableName,
              candidateSysId,
            );
            if (exists) {
              resolvedSubmittedSysId = candidateSysId;
              return true;
            }
          }
          return false;
        };
        let submittedSysIdVerified = await verifySubmittedSysId({
          quickIdentityLookup: isLikelySameUncommittedForm(),
          allowSubmittedSysIdLookup:
            !configuredFieldsContainIdentity || !isLikelySameUncommittedForm(),
        });
        const submitHasTrustedIdentity =
          !submit || Boolean(submittedRecord) || submittedSysIdVerified;
        let submitVerified =
          !submit ||
          (selected.submitClicked === true &&
            !submitStayedOnSameCreateRecord &&
            submitHasTrustedIdentity);
        let submitDiagnostics =
          submit &&
          selected.submitClicked === true &&
          !submitVerified &&
          isLikelySameUncommittedForm()
            ? await collectServiceNowSubmitDiagnostics(tabId)
            : [];
        if (
          submit &&
          selected.submitClicked === true &&
          !submitVerified &&
          isLikelySameUncommittedForm() &&
          submitDiagnostics.length === 0
        ) {
          const fallback = await retryServiceNowNativeSubmit(
            tabId,
            scriptTarget,
            String(selected.submitActionName || ""),
          );
          if (fallback?.ok === true) {
            fallbackSubmitMethod = fallback.method || "";
            fallbackSubmitActionName = fallback.actionName || "";
            fallbackSubmittedSysId =
              typeof fallback.submittedSysId === "string" &&
              /^[0-9a-f]{32}$/i.test(fallback.submittedSysId)
                ? fallback.submittedSysId.toLowerCase()
                : "";
            if (fallbackSubmittedSysId && !resolvedSubmittedSysId) {
              resolvedSubmittedSysId = fallbackSubmittedSysId;
            }
            await waitForNavigation(tabId, 12_000);
            await waitForDomReady(tabId, {
              timeoutMs: 2_000,
              waitForElements: true,
            });
            tab = await chrome.tabs.get(tabId);
            currentUrl = tab.url || currentUrl;
            currentTitle = tab.title || currentTitle;
            submitStayedOnSameCreateRecord =
              computeSubmitStayedOnSameCreateRecord();
            submittedSysIdVerified = await verifySubmittedSysId();
            submitVerified =
              selected.submitClicked === true &&
              !submitStayedOnSameCreateRecord &&
              (!submit || Boolean(submittedRecord) || submittedSysIdVerified);
          } else if (fallback?.reason) {
            submitDiagnostics = [
              ...submitDiagnostics,
              `ServiceNow submit fallback unavailable: ${fallback.reason}`,
            ];
          }
        }
        const effectiveMismatches = [...mismatches];
        if (
          submit &&
          selected.submitClicked === true &&
          submitStayedOnSameCreateRecord
        ) {
          effectiveMismatches.push(
            `submit did not leave the create form for ${submittedRecord}`,
          );
        }
        if (
          submit &&
          selected.submitClicked === true &&
          !submittedRecord &&
          submittedSysId &&
          !submittedSysIdVerified
        ) {
          effectiveMismatches.push(
            `submitted record sys_id ${submittedSysId} was not found in ServiceNow`,
          );
        } else if (
          submit &&
          selected.submitClicked === true &&
          !submittedRecord &&
          !submittedSysId
        ) {
          effectiveMismatches.push(
            "submit did not expose a submitted record identity",
          );
        }
        const effectiveOk = selected.ok === true && submitVerified;
        if (
          submit &&
          selected.submitClicked === true &&
          !submitVerified &&
          submitDiagnostics.length === 0
        ) {
          submitDiagnostics = await collectServiceNowSubmitDiagnostics(tabId);
        }
        let openedSubmittedRecordUrl = "";
        if (effectiveOk && submit && submittedRecord) {
          const resetToNextCreateRecord =
            /\bCreate\s+[A-Z]{2,}\d+\b/i.test(currentTitle) &&
            !new RegExp(`\\bCreate\\s+${submittedRecord}\\b`, "i").test(
              currentTitle,
            );
          const onSubmittedRecordPage =
            new RegExp(`\\b${submittedRecord}\\b`, "i").test(currentTitle) &&
            !new RegExp(`\\bCreate\\s+${submittedRecord}\\b`, "i").test(
              currentTitle,
            );
          if (!resetToNextCreateRecord && !onSubmittedRecordPage) {
            const recordUrl = await resolveServiceNowRecordUrl(
              tabId,
              tableName,
              submittedRecord,
            );
            if (recordUrl) {
              await chrome.tabs.update(tabId, { url: recordUrl });
              await waitForNavigation(tabId, 12_000);
              await waitForDomReady(tabId, {
                timeoutMs: 2_000,
                waitForElements: true,
              });
              tab = await chrome.tabs.get(tabId);
              openedSubmittedRecordUrl = recordUrl;
            }
          }
        } else if (
          effectiveOk &&
          submit &&
          !submittedRecord &&
          submittedSysIdVerified &&
          resolvedSubmittedSysId &&
          tableName
        ) {
          const recordUrl = serviceNowRecordUrlForSysId(
            currentUrl || String(selected.url || ""),
            tableName,
            resolvedSubmittedSysId,
          );
          if (
            recordUrl &&
            !new RegExp(`\\bsys_id=${escapeRegExp(resolvedSubmittedSysId)}\\b`, "i").test(
              currentUrl,
            )
          ) {
            await chrome.tabs.update(tabId, { url: recordUrl });
            await waitForNavigation(tabId, 12_000);
            await waitForDomReady(tabId, {
              timeoutMs: 2_000,
              waitForElements: true,
            });
            tab = await chrome.tabs.get(tabId);
            currentUrl = tab.url || recordUrl;
            currentTitle = tab.title || currentTitle;
            openedSubmittedRecordUrl = recordUrl;
          }
        }
        const lines = [
          effectiveOk
            ? "Configured ServiceNow form."
            : "ServiceNow form configuration incomplete.",
          configured.length ? `Configured:\n- ${configured.join("\n- ")}` : "",
          effectiveMismatches.length
            ? `Mismatches:\n- ${effectiveMismatches.join("\n- ")}`
            : "",
          submitDiagnostics.length
            ? `Submit diagnostics:\n- ${submitDiagnostics.join("\n- ")}`
            : "",
          selected.submitClicked
            ? `Clicked submit control: ${String(selected.submitLabel || "submit")}`
            : "",
          selected.submitMethod
            ? `Submit method: ${String(selected.submitMethod)}${selected.submitActionName ? ` (${String(selected.submitActionName)})` : ""}`
            : "",
          fallbackSubmitMethod
            ? `Fallback submit method: ${fallbackSubmitMethod}${fallbackSubmitActionName ? ` (${fallbackSubmitActionName})` : ""}`
            : "",
          submittedRecord && submitVerified
            ? `Submitted ServiceNow form record: ${submittedRecord}`
            : "",
          resolvedSubmittedSysId && submittedSysIdVerified
            ? `Submitted ServiceNow form sys_id: ${resolvedSubmittedSysId}`
            : "",
          openedSubmittedRecordUrl
            ? `Opened submitted ServiceNow record: ${openedSubmittedRecordUrl}`
            : "",
          `ServiceNow form fields discovered: ${String(selected.fieldCount ?? 0)}`,
          `Current URL: ${tab.url || currentUrl}`,
          `Current title: ${tab.title || currentTitle}`,
        ];
        const observedAt = new Date().toISOString();
        const evidence: EvidenceEvent[] = [];
        if (fields.length > 0) {
          evidence.push({
            type: "fill_attempted",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: effectiveMismatches.length === 0 ? "high" : "medium",
            observedAt,
            supportsTaskGoal: effectiveMismatches.length === 0,
            detail: { fields: fields.map((field) => field.field) },
          });
        }
        for (const configuredLine of configured) {
          evidence.push({
            type: "field_value_observed",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt,
            supportsTaskGoal: true,
            detail: { value: configuredLine },
          });
        }
        if (submit) {
          evidence.push({
            type: "submit_attempted",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: selected.submitClicked ? "high" : "medium",
            observedAt,
            supportsTaskGoal: selected.submitClicked === true,
            detail: {
              submitLabel: String(
                selected.submitLabel || submitButton || "submit",
              ),
              submitMethod: fallbackSubmitMethod
                ? `${String(selected.submitMethod || "")}+${fallbackSubmitMethod}`
                : String(selected.submitMethod || ""),
            },
          });
        }
        if (submit && submitStayedOnSameCreateRecord) {
          evidence.push({
            type: "uncertainty_detected",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt,
            supportsTaskGoal: false,
            detail: {
              reason: "same_create_form_after_submit",
              submittedRecord,
            },
          });
        }
        if (submit && submitDiagnostics.length > 0) {
          evidence.push({
            type: "uncertainty_detected",
            source: ToolName.CONFIGURE_SERVICENOW_FORM,
            confidence: "high",
            observedAt,
            supportsTaskGoal: false,
            detail: {
              reason: "servicenow_submit_diagnostics",
              diagnostics: submitDiagnostics,
            },
          });
        }
        if (
          effectiveOk &&
          submit &&
          (submittedRecord || submittedSysIdVerified)
        ) {
          const identity = {
            table: tableName,
            recordNumber: submittedRecord || undefined,
            sysId: submittedSysIdVerified
              ? resolvedSubmittedSysId
              : undefined,
            url: openedSubmittedRecordUrl || tab.url || currentUrl,
          };
          evidence.push(
            {
              type: "submit_succeeded",
              source: ToolName.CONFIGURE_SERVICENOW_FORM,
              confidence: "high",
              observedAt,
              supportsTaskGoal: true,
              detail: identity,
            },
            {
              type: "record_identity_observed",
              source: ToolName.CONFIGURE_SERVICENOW_FORM,
              confidence: "high",
              observedAt,
              supportsTaskGoal: true,
              detail: identity,
            },
          );
        }
        return { result: lines.filter(Boolean).join("\n"), evidence };
      } catch (e: any) {
        return `Error configuring ServiceNow form: ${e.message}`;
      }
    },
  );
}
