import { DomSnapshot, ToolName } from "../../types";
import { normalizeGuardText } from "./text-entry-guards";

export function isListDetailReturnControlRepeatExempt(params: {
  selectedSkillId?: string | null;
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot?: DomSnapshot | null;
}): boolean {
  if (params.selectedSkillId !== "list-detail-review-loop") return false;
  if (params.toolName !== ToolName.CLICK_ELEMENT) return false;

  const id =
    typeof params.args.id === "number"
      ? params.args.id
      : Number(params.args.id);
  if (!Number.isFinite(id)) return false;

  const element = params.snapshot?.elements.find(
    (candidate) => candidate.tag === id,
  );
  if (!element) return false;

  const attributes = Object.values(element.attributes || {})
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const label = `${element.text || ""} ${attributes}`.toLowerCase();

  return /\b(?:back|return)\s+to\s+(?:the\s+)?(?:listings?|results?|list)\b/.test(
    label,
  );
}

export function listDetailElementLabel(
  element: DomSnapshot["elements"][number] | null | undefined,
): string {
  if (!element) return "";
  const preferred =
    element.text ||
    element.attributes?.["aria-label"] ||
    element.attributes?.title;
  return normalizeGuardText(typeof preferred === "string" ? preferred : "");
}

function isListDetailActionElement(
  element: DomSnapshot["elements"][number] | null | undefined,
): boolean {
  if (!element || element.isDisabled || element.isVisible === false)
    return false;
  const label = listDetailElementLabel(element);
  if (!label) return false;
  if (
    /\b(?:back|return)\s+to\s+(?:the\s+)?(?:listings?|results?|list)\b/.test(
      label,
    )
  ) {
    return false;
  }
  return /\b(?:view|open|read|show)\s+(?:full\s+)?(?:details?|profile|listing|item|result)s?\b/.test(
    label,
  );
}

export function listDetailActionTargetLabel(
  element: DomSnapshot["elements"][number] | null | undefined,
): string | null {
  if (!isListDetailActionElement(element)) return null;
  const label = listDetailElementLabel(element);
  const match = label.match(
    /\b(?:view|open|read|show)\s+(?:full\s+)?(?:details?|profile|listing|item|result)s?(?:\s+for)?\s+(.+)$/,
  );
  return (match?.[1] || label).trim();
}

export function getListDetailReturnControl(
  snapshot: DomSnapshot | null | undefined,
): DomSnapshot["elements"][number] | null {
  if (!snapshot?.elements?.length) return null;
  return (
    snapshot.elements.find((element) =>
      /\b(?:back|return)\s+to\s+(?:the\s+)?(?:listings?|results?|list)\b/.test(
        listDetailElementLabel(element),
      ),
    ) ?? null
  );
}

export function hasListDetailReturnControl(
  snapshot: DomSnapshot | null | undefined,
): boolean {
  return !!getListDetailReturnControl(snapshot);
}

export type ListDetailNextAction = {
  id: number;
  label: string;
};

export function getNextUnreviewedListDetailAction(
  snapshot: DomSnapshot | null | undefined,
  reviewedTargets: Iterable<string>,
): ListDetailNextAction | null {
  if (!snapshot?.elements?.length) return null;

  const reviewed = new Set(
    Array.from(reviewedTargets)
      .map((target) => normalizeGuardText(target))
      .filter(Boolean),
  );
  const seen = new Set<string>();

  for (const element of snapshot.elements) {
    const label = listDetailActionTargetLabel(element);
    if (!label) continue;

    const key = normalizeGuardText(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    if (!reviewed.has(key)) {
      return { id: element.tag, label };
    }
  }

  return null;
}

export function countVisibleListDetailActions(
  snapshot: DomSnapshot | null | undefined,
): number {
  if (!snapshot?.elements?.length) return 0;
  const targets = new Set<string>();
  for (const element of snapshot.elements) {
    const label = listDetailActionTargetLabel(element);
    if (label) targets.add(label);
  }
  return targets.size;
}

export function requiresBroadListDetailReview(query: string): boolean {
  const text = normalizeGuardText(query);
  if (!text) return false;
  const hasListSurface =
    /\b(job listings?|job postings?|jobs?|listings?|results?|items?|profiles?|candidates?)\b/.test(
      text,
    );
  if (!hasListSurface) return false;

  return (
    /\b(?:each|every|all)\b/.test(text) ||
    /\b(?:review|evaluate|compare|recommend|rank|shortlist)\b/.test(text) ||
    /\b(?:best matches?|best fits?|which (?:ones|jobs|listings|items))\b/.test(
      text,
    )
  );
}

export function getListDetailDoneRejection(params: {
  selectedSkillId?: string | null;
  query: string;
  reviewedDetailCount: number;
  visibleDetailActionCount: number;
}): string | null {
  if (params.selectedSkillId !== "list-detail-review-loop") return null;
  if (!requiresBroadListDetailReview(params.query)) return null;
  if (params.visibleDetailActionCount < 3) return null;
  if (params.reviewedDetailCount >= params.visibleDetailActionCount)
    return null;
  return (
    `This list-detail review is incomplete: reviewed ${params.reviewedDetailCount}/${params.visibleDetailActionCount} visible detail pages. ` +
    "Continue from the list page, open the next unreviewed detail action, read the detail page, store the fit-critical facts, return to the list, and only call done() after the visible candidate set has been reviewed."
  );
}

export function getListDetailWorkflowBlock(params: {
  selectedSkillId?: string | null;
  query: string;
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot: DomSnapshot | null | undefined;
  reviewedTargets: Iterable<string>;
  openedTargets?: Iterable<string>;
  visibleDetailActionCount: number;
}): string | null {
  if (params.selectedSkillId !== "list-detail-review-loop") return null;
  if (!requiresBroadListDetailReview(params.query)) return null;

  const currentVisibleCount = countVisibleListDetailActions(params.snapshot);
  const visibleCount = Math.max(
    currentVisibleCount,
    params.visibleDetailActionCount,
  );
  if (visibleCount < 3) return null;

  const next = getNextUnreviewedListDetailAction(
    params.snapshot,
    params.reviewedTargets,
  );
  if (!next) return null;

  const reviewed = new Set(
    Array.from(params.reviewedTargets)
      .map((target) => normalizeGuardText(target))
      .filter(Boolean),
  );
  const opened = new Set(
    Array.from(params.openedTargets ?? [])
      .map((target) => normalizeGuardText(target))
      .filter(Boolean),
  );
  const reviewedCount = reviewed.size;
  if (reviewedCount >= visibleCount) return null;

  const instruction =
    `List-detail review is incomplete: reviewed ${reviewedCount}/${visibleCount} visible detail pages. ` +
    `Click the next unreviewed visible detail action [${next.id}] "${next.label}", read the detail page, update notes with fit-critical facts, return to the list, and continue.`;

  if (
    params.toolName === ToolName.UPDATE_NOTES ||
    params.toolName === ToolName.ESCALATE ||
    params.toolName === ToolName.DONE
  ) {
    return null;
  }

  if (params.toolName === ToolName.CLICK_ELEMENT) {
    const id =
      typeof params.args.id === "number"
        ? params.args.id
        : Number(params.args.id);
    if (!Number.isFinite(id)) {
      return `BLOCKED: click_element needs a valid element id. ${instruction}`;
    }

    const target = params.snapshot?.elements.find(
      (element) => element.tag === id,
    );
    if (
      isListDetailReturnControlRepeatExempt({
        selectedSkillId: params.selectedSkillId,
        toolName: params.toolName,
        args: params.args,
        snapshot: params.snapshot,
      })
    ) {
      return null;
    }

    const targetLabel = listDetailActionTargetLabel(target);
    if (targetLabel && !reviewed.has(normalizeGuardText(targetLabel))) {
      return null;
    }

    if (targetLabel) {
      const targetKey = normalizeGuardText(targetLabel);
      const targetState = opened.has(targetKey)
        ? "opened but not reviewed"
        : "reviewed";
      return `BLOCKED: "${targetLabel}" has already been ${targetState} for this list-detail review. ${instruction}`;
    }

    return `BLOCKED: This click does not open an unreviewed list detail. ${instruction}`;
  }

  return `BLOCKED: ${params.toolName} is off workflow while unreviewed list details are visible. ${instruction}`;
}
