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
