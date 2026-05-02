import { DomSnapshot, ToolName } from "../../types";
import type { LLMMessage } from "../llm/types";
import { normalizeGuardText } from "./text-entry-guards";

export function isPaginationNavigationClick(params: {
  selectedSkillId?: string | null;
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot?: DomSnapshot | null;
}): boolean {
  if (
    params.selectedSkillId !== "paginated-table-scan" &&
    params.selectedSkillId !== "paginated-record-lookup"
  ) {
    return false;
  }
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
  const label = `${element.text || ""} ${attributes}`
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return /^(?:next|prev|previous|\d+|[<>]|[‹›«»])$/.test(label);
}

export function hasRecentExactTextFieldRead(messages: LLMMessage[]): boolean {
  const recent = messages.slice(-10);
  return recent.some((message) => {
    if (message.role !== "tool" || typeof message.content !== "string") {
      return false;
    }
    return (
      /<textarea|<input/i.test(message.content) &&
      message.content.replace(/\s+/g, " ").trim().length > 80
    );
  });
}

export function isFinalCommunicationClick(params: {
  selectedSkillId?: string | null;
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot?: DomSnapshot | null;
  originalQuery: string;
}): boolean {
  if (params.toolName !== ToolName.CLICK_ELEMENT) return false;
  if (
    params.selectedSkillId !== "email-reply-careful" &&
    params.selectedSkillId !== "thread-message-careful"
  ) {
    return false;
  }
  if (!/\b(reply|respond|confirm|send|post)\b/i.test(params.originalQuery)) {
    return false;
  }
  const id =
    typeof params.args.id === "number"
      ? params.args.id
      : Number(params.args.id);
  if (!Number.isFinite(id)) return false;
  const element = params.snapshot?.elements.find(
    (candidate) => candidate.tag === id,
  );
  if (!element) return false;
  const label = normalizeGuardText(
    [
      element.text,
      element.attributes?.["aria-label"],
      element.attributes?.title,
      element.attributes?.id,
    ]
      .filter(Boolean)
      .join(" "),
  );
  return /\b(send|post|reply)\b/.test(label);
}
