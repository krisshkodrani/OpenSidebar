import type { TaggedElement } from "../../types";

/** A visible editing surface whose text sink is not exposed as a DOM field. */
export function isNativeEditorSurface(element: TaggedElement | null | undefined): boolean {
  if (!element || !element.isVisible || element.isDisabled) return false;
  const tag = element.tagName.toLowerCase();
  if (["input", "textarea", "select", "button", "a"].includes(tag) ||
      (element.attributes.contenteditable !== undefined &&
        element.attributes.contenteditable !== "false")) return false;
  const role = element.role.toLowerCase();
  const label = `${element.attributes["aria-label"] ?? ""} ${element.text}`;
  return tag === "canvas" || role === "textbox" || role === "document" ||
    /\b(editor|document|writing area)\b/i.test(label);
}
