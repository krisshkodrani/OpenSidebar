import type { DomSnapshot } from "../../types";
import type { ToolProfile } from "../tools/metadata";
import { isTextLikeInputElement } from "./text-entry-guards";

export function getUncommittedInlineEditDoneRejection(input: {
  toolProfile?: ToolProfile;
  snapshot?: DomSnapshot | null;
  taskText: string;
}): string | null {
  if (input.toolProfile !== "edit_surface") return null;
  const snapshot = input.snapshot;
  if (!snapshot?.elements?.length) return null;
  if (
    !snapshot.elements.some(
      (element) =>
        element.isVisible !== false && isTextLikeInputElement(element),
    )
  )
    return null;
  const pageText = `${snapshot.visibleContent || ""}\n${snapshot.pageContent || ""}`;
  const inlineEditTask =
    /\b(spreadsheet|grid|cell|row|column|rename|filename|file name|document|inline)\b/i.test(
      input.taskText,
    );
  if (!inlineEditTask && !/\(editing\)/i.test(pageText)) return null;
  return (
    "An inline edit field is still active on the page. Commit the edit " +
    "(for example with Enter or by applying the rename) before calling done()."
  );
}
