import type { UserSettings } from "../types";

export type InteractionMode =
  | "confirm_all"
  | "confirm_high_risk_only"
  | "confirm_plans_only"
  | "autonomous";

export function getInteractionMode(
  settings: Pick<UserSettings, "requireApprovals" | "requirePlanConfirmation">,
): InteractionMode {
  const requireApprovals = settings.requireApprovals !== false;
  const requirePlanConfirmation = settings.requirePlanConfirmation !== false;

  if (requireApprovals && requirePlanConfirmation) return "confirm_all";
  if (requireApprovals) return "confirm_high_risk_only";
  if (requirePlanConfirmation) return "confirm_plans_only";
  return "autonomous";
}

export function applyInteractionMode(
  settings: UserSettings,
  mode: InteractionMode,
): UserSettings {
  return {
    ...settings,
    requireApprovals:
      mode === "confirm_all" || mode === "confirm_high_risk_only",
    requirePlanConfirmation:
      mode === "confirm_all" || mode === "confirm_plans_only",
  };
}

export function getInteractionModeLabel(mode: InteractionMode): string {
  switch (mode) {
    case "confirm_all":
      return "Ask before acting";
    case "confirm_high_risk_only":
      return "Ask for risky actions";
    case "confirm_plans_only":
      return "Confirm plans only";
    case "autonomous":
      return "Act without asking";
  }
}

export function getInteractionModeDescription(mode: InteractionMode): string {
  switch (mode) {
    case "confirm_all":
      return "Agent confirms multi-step plans and high-risk actions.";
    case "confirm_high_risk_only":
      return "Agent starts plans directly, but asks before high-risk actions.";
    case "confirm_plans_only":
      return "Agent confirms multi-step plans, but high-risk actions run without approval.";
    case "autonomous":
      return "Agent takes actions without plan or approval prompts.";
  }
}

export function getInteractionModeBadge(mode: InteractionMode): string | null {
  switch (mode) {
    case "confirm_high_risk_only":
      return "Risk checks";
    case "confirm_plans_only":
      return "Plan checks";
    case "autonomous":
      return "Auto";
    case "confirm_all":
    default:
      return null;
  }
}
