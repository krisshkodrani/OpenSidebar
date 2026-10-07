import type { DomSnapshot, ToolName } from "../../../types";
import type { CompletionEvidence } from "./kernel-types";
import { extractFormFieldObservations } from "./form-field-analysis";
import { samePageUrl } from "./navigation-analysis";
import {
  cleanLabel,
  compactKey,
  escapeRegExp,
  normalizeText,
} from "./text-utils";
import {
  elementControlText,
  textConfirmsWorkflowAction,
  workflowTargetLabelCoveredByText,
} from "./workflow-confirmation-analysis";

export function snapshotHasFormValidationText(snapshot: DomSnapshot): boolean {
  const text = [snapshot.title, snapshot.visibleContent, snapshot.pageContent]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
  return /\b(?:error|invalid|missing|please fill|please enter|is required|are required|required field|cannot be blank|can't be blank|must be filled)\b/i.test(
    text,
  );
}

/** Evidence for a submitted editor whose values become a visible saved record.
 * This does not infer success from a toast or a tool's reported click success.
 * Unrecognized layouts stay on the ordinary verification path.
 */
export function extractSavedFormReadbackEvidence(params: {
  userRequest?: string;
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (params.toolName !== "click_element" || /^Error:/i.test(params.result))
    return [];
  if (
    !pre ||
    !current ||
    !samePageUrl(pre.url, current.url) ||
    pre.title !== current.title
  )
    return [];
  const control = pre.elements.find(
    (element) => element.tag === Number(params.args.id),
  );
  if (!control || control.isDisabled || !control.isVisible) return [];
  if (
    control.tagName !== "button" &&
    control.role !== "button" &&
    !(control.tagName === "input" && control.attributes.type === "submit")
  )
    return [];
  const target = cleanLabel(elementControlText(control));
  if (!/^(?:save|add|submit|create|update|post|publish)\b/i.test(target))
    return [];
  if (snapshotHasFormValidationText(current)) return [];

  const fields = extractFormFieldObservations(pre).filter((field) =>
    field.value.trim(),
  );
  // Only accept values directly grounded in the user's request. Defaults,
  // inferred values and ambiguous/negated selections need ordinary verification.
  const request = normalizeText(params.userRequest || "").replace(
    /[-‐‑]/g,
    " ",
  );
  if (
    !request ||
    !fields.every((field) => {
      if (
        field.kind === "text" &&
        !cleanLabel(params.userRequest || "").includes(cleanLabel(field.value))
      )
        return false;
      const value = normalizeText(field.value).replace(/[-‐‑]/g, " ");
      return (
        containsValue(request, value) &&
        !new RegExp(
          `\\b(?:not|never|without)\\s+(?:be\\s+|set\\s+to\\s+)?${escapeRegExp(value)}\\b`,
          "i",
        ).test(request)
      );
    })
  )
    return [];
  // A substantive editor value avoids treating a disappearing filter/search as a save.
  if (
    !fields.some(
      (field) =>
        field.kind === "text" &&
        field.value.length >= 12 &&
        field.value.split(/\s+/).length >= 3,
    )
  )
    return [];
  if (extractFormFieldObservations(current).length > 0) return [];
  const before = pre.pageContent || pre.visibleContent || "";
  const after = current.pageContent || current.visibleContent || "";
  if (!textConfirmsWorkflowAction(after, "save", "visible")) return [];
  const normalizedAfter = normalizeText(after);
  const identityContext = normalizeText(
    [after, ...(current.skeleton?.map((node) => node.text) || [])].join("\n"),
  );
  if (!fields.every((field) => containsValue(normalizedAfter, field.value)))
    return [];
  // Readback must be new page content, not an older row already on the page.
  if (
    fields
      .filter((field) => field.kind === "text")
      .some((field) =>
        normalizeText(before).includes(normalizeText(field.value)),
      )
  )
    return [];

  const headings =
    pre.skeleton?.filter((node) => node.level === 1).map((node) => node.text) ||
    [];
  if (!headings.length) {
    const heading = /^#{1,6}\s+(.+)$/m.exec(before)?.[1];
    if (heading) headings.push(heading);
  }
  if (
    !headings.length ||
    !headings.every(
      (heading) =>
        containsValue(identityContext, heading) &&
        workflowTargetLabelCoveredByText(heading, params.userRequest || ""),
    )
  )
    return [];
  // Preserve both observed and requested record references across SPA updates.
  const references =
    [before, params.userRequest || ""]
      .join("\n")
      .match(
        /\b(?=[a-z0-9_-]*[a-z])(?=[a-z0-9_-]*\d)[a-z0-9]+(?:[-_][a-z0-9]+)*\b/gi,
      ) || [];
  if (
    !references.every((reference) => containsValue(identityContext, reference))
  )
    return [];

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:save:form-readback:${compactKey(target)}`,
      observedAtTurn: params.turn,
      detail: {
        action: "save",
        source: "saved_form_readback",
        targetText: [
          target,
          ...headings,
          ...[...before.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]),
          ...references,
          ...fields.map((field) => field.value),
        ].join("\n"),
        text: `Saved form values visible after submission: ${fields.map((field) => `${field.label}: ${field.value}`).join("; ")}`,
        url: current.url,
      },
    },
  ];
}

function containsValue(text: string, value: string): boolean {
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_-])${escapeRegExp(normalizeText(value))}(?=$|[^\\p{L}\\p{N}_-])`,
    "u",
  ).test(text);
}
