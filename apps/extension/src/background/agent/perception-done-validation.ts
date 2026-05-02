import type { ToolProfile } from "../tools/metadata";
import { inferToolProfileForStep } from "./planner";

export function isPerceptionFailurePlaceholder(
  interpretation: string | null | undefined,
): boolean {
  if (!interpretation) return false;
  return /\[visual perception failed:/i.test(interpretation);
}

export function shouldOmitPerceptionForDoneValidation(args: {
  interpretation: string | null | undefined;
  hasReadPage: boolean;
  originalQuery: string;
  activeStepDescription?: string;
  activeStepToolProfile?: ToolProfile;
}): boolean {
  if (!args.hasReadPage) return false;
  if (!isPerceptionFailurePlaceholder(args.interpretation)) return false;

  const activeProfile =
    args.activeStepToolProfile ??
    inferToolProfileForStep(
      args.activeStepDescription || args.originalQuery,
      "",
    );
  if (activeProfile === "read_only") return true;

  return inferToolProfileForStep(args.originalQuery, "") === "read_only";
}
