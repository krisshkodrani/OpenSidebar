export type BlindToolCallNudge = "initial" | "repeat";

export type BlindToolCallAssessment = {
  consecutiveBlindToolTurns: number;
  nudge: BlindToolCallNudge | null;
  message: string | null;
};

export const INITIAL_BLIND_TOOL_CALL_MESSAGE =
  "WARNING: You have made 3 consecutive tool calls with no reasoning. " +
  "Include your Think step before calling tools — state what you observe, your plan, and why this action.";

export const REPEAT_BLIND_TOOL_CALL_MESSAGE =
  "REMINDER: Include reasoning text before tool calls. Explain what you see and your plan.";

export function assessBlindToolCallReasoning(args: {
  cleanContent: string | null;
  toolsRecoveredFromText: boolean;
  hadThinking: boolean;
  consecutiveBlindToolTurns: number;
}): BlindToolCallAssessment {
  const lacksReasoning =
    !args.cleanContent && !args.toolsRecoveredFromText && !args.hadThinking;

  if (!lacksReasoning) {
    return {
      consecutiveBlindToolTurns: 0,
      nudge: null,
      message: null,
    };
  }

  const consecutiveBlindToolTurns = args.consecutiveBlindToolTurns + 1;
  if (consecutiveBlindToolTurns === 3) {
    return {
      consecutiveBlindToolTurns,
      nudge: "initial",
      message: INITIAL_BLIND_TOOL_CALL_MESSAGE,
    };
  }

  if (
    consecutiveBlindToolTurns > 0 &&
    consecutiveBlindToolTurns % 6 === 0
  ) {
    return {
      consecutiveBlindToolTurns,
      nudge: "repeat",
      message: REPEAT_BLIND_TOOL_CALL_MESSAGE,
    };
  }

  return {
    consecutiveBlindToolTurns,
    nudge: null,
    message: null,
  };
}
