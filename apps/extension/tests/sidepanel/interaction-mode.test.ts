import { describe, expect, test } from "vitest";
import "../setup";
import {
  applyInteractionMode,
  getInteractionMode,
  getInteractionModeBadge,
  getInteractionModeDescription,
  getInteractionModeLabel,
} from "../../src/sidepanel/interaction-mode";

describe("interaction mode helpers", () => {
  test("derives confirm_all mode when both gates are enabled", () => {
    const mode = getInteractionMode({
      requireApprovals: true,
      requirePlanConfirmation: true,
    });
    expect(mode).toBe("confirm_all");
    expect(getInteractionModeLabel(mode)).toBe("Ask before acting");
    expect(getInteractionModeBadge(mode)).toBeNull();
  });

  test("derives confirm_high_risk_only mode", () => {
    const mode = getInteractionMode({
      requireApprovals: true,
      requirePlanConfirmation: false,
    });
    expect(mode).toBe("confirm_high_risk_only");
    expect(getInteractionModeLabel(mode)).toBe("Ask for risky actions");
    expect(getInteractionModeBadge(mode)).toBe("Risk checks");
    expect(getInteractionModeDescription(mode)).toContain("high-risk actions");
  });

  test("derives confirm_plans_only mode", () => {
    const mode = getInteractionMode({
      requireApprovals: false,
      requirePlanConfirmation: true,
    });
    expect(mode).toBe("confirm_plans_only");
    expect(getInteractionModeLabel(mode)).toBe("Confirm plans only");
    expect(getInteractionModeBadge(mode)).toBe("Plan checks");
    expect(getInteractionModeDescription(mode)).toContain("multi-step plans");
  });

  test("derives autonomous mode when both gates are disabled", () => {
    const mode = getInteractionMode({
      requireApprovals: false,
      requirePlanConfirmation: false,
    });
    expect(mode).toBe("autonomous");
    expect(getInteractionModeLabel(mode)).toBe("Act without asking");
    expect(getInteractionModeBadge(mode)).toBe("Auto");
  });

  test("applyInteractionMode maps confirm_high_risk_only to mixed settings", () => {
    const next = applyInteractionMode(
      {
        openRouterApiKey: "",
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
        requirePlanConfirmation: true,
      },
      "confirm_high_risk_only",
    );
    expect(next.requireApprovals).toBe(true);
    expect(next.requirePlanConfirmation).toBe(false);
  });

  test("applyInteractionMode maps confirm_plans_only to mixed settings", () => {
    const next = applyInteractionMode(
      {
        openRouterApiKey: "",
        maxTurns: 30,
        theme: "system",
        showSessionMetrics: true,
        requireApprovals: true,
        allowNavigation: true,
        requirePlanConfirmation: true,
      },
      "confirm_plans_only",
    );
    expect(next.requireApprovals).toBe(false);
    expect(next.requirePlanConfirmation).toBe(true);
  });
});
