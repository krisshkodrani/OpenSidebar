import type { ToolProfile } from "../tools/metadata";

export function isToolProfileName(
  value: string | undefined,
): value is ToolProfile {
  return (
    value === "full" ||
    value === "read_only" ||
    value === "form_fill" ||
    value === "edit_surface" ||
    value === "navigate" ||
    value === "enter_code" ||
    value === "submit_form" ||
    value === "inspect_hidden_state" ||
    value === "recover_from_stuck" ||
    value === "navigation_only"
  );
}
