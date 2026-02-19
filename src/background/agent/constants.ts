/**
 * Agent loop constants - centralized configuration for magic numbers
 * These values can be tuned without searching through the codebase
 */

/** Agent loop execution limits */
export const AGENT_LIMITS = {
  /** Maximum turns before agent gives up */
  MAX_TURNS_DEFAULT: 30,
  /** Maximum times done() can be rejected before forcing through */
  MAX_DONE_REJECTIONS: 3,
  /** Maximum consecutive all-fail turns before circuit breaker */
  MAX_CONSECUTIVE_ALL_FAIL: 5,
} as const;

/** Stuck detection thresholds */
export const STUCK_THRESHOLDS = {
  /** Turns of no progress before escalating to next tier */
  ESCALATE: 5,
  /** Maximum turns before giving up entirely */
  GIVE_UP: 10,
  /** Tighter give-up when already on the smart model (saves wasted turns) */
  GIVE_UP_SMART: 8,
} as const;

/** Escalation/de-escalation cycle limits */
export const ESCALATION_LIMITS = {
  /** Max escalation→de-escalation cycles before cooldown becomes effectively permanent */
  MAX_CYCLES: 5,
  /** Turns of cooldown after de-escalation before re-escalation is allowed */
  COOLDOWN_TURNS: 3,
  /** Minimum turns the smart model must run before de-escalation is allowed */
  MIN_SMART_TENURE: 2,
  /** Consecutive progress signals required before de-escalation */
  PROGRESS_GATE: 2,
} as const;

/** BRAINS→HANDS: smart model orients, then fast model executes */
export const ORIENTATION = {
  /** Turns the smart model ("brains") runs before handing off to fast ("hands") */
  PHASE_TURNS: 2,
} as const;

/** Tool failure circuit breaker */
export const TOOL_FAILURE_THRESHOLDS = {
  /** Warn after this many consecutive failures on the same tool */
  WARN: 4,
  /** Exit after this many consecutive failures on the same tool */
  EXIT: 6,
} as const;

/** Redundant action detection (informational — nudges, never blocks) */
export const REDUNDANT_ACTION = {
  /** Size of the sliding window for recent successful tool calls */
  WINDOW: 10,
  /** Exact (tool+args+same page state) repetitions before injecting an informational nudge */
  INFO_THRESHOLD: 4,
  /** Same tool name (any args) repetitions before a soft note */
  TOOL_NAME_INFO_THRESHOLD: 6,
} as const;

/** Step duration watchdog */
export const STEP_WATCHDOG = {
  /** Turns on same step before injecting a nudge */
  WARN_TURNS: 5,
  /** Turns on same step before forcing escalation */
  ESCALATE_TURNS: 10,
} as const;

/** Broadcast intervals (turns) */
export const BROADCAST_INTERVALS = {
  /** Broadcast session metrics every N turns */
  METRICS: 3,
  /** Broadcast turn progress every N turns */
  TURN_PROGRESS: 5,
} as const;

/** LLM configuration */
export const LLM_CONFIG = {
  /** Maximum tokens in LLM response */
  MAX_TOKENS: 4096,
  /** Temperature for agentic tasks (low = deterministic) */
  TEMPERATURE: 0,
  /** Token budget for decomposition */
  DECOMPOSITION_MAX_TOKENS: 512,
  /** Token budget for validation */
  VALIDATION_MAX_TOKENS: 256,
  /** Maximum subtasks from guardian */
  MAX_SUBTASKS: 8,
} as const;

/** String length limits for logging/truncation */
export const STRING_LIMITS = {
  /** Slice for argument logging */
  ARGS_LOG: 500,
  /** Slice for result logging */
  RESULT_LOG: 1000,
  /** Slice for reasoning in logs */
  REASONING_LOG: 300,
  /** Slice for summary in done() */
  SUMMARY_LOG: 300,
  /** Slice for rejection reason */
  REJECTION_REASON: 200,
  /** Slice for escalation reason display */
  ESCALATION_REASON: 60,
  /** Tool call snippet in logs */
  TOOL_CALL_SNIPPET: 80,
} as const;

/** Turn-count-based compression triggers (overrides utilization-based) */
export const COMPRESSION_TRIGGERS = {
  /** History length at which LIGHT compression activates */
  LIGHT_TURN_COUNT: 30,
  /** History length at which MEDIUM compression activates */
  MEDIUM_TURN_COUNT: 60,
  /** History length at which HEAVY compression activates */
  HEAVY_TURN_COUNT: 100,
  /** Messages to keep verbatim in HEAVY compression */
  HEAVY_KEEP_RECENT: 10,
  /** Tool result truncation limit for LIGHT compression */
  LIGHT_TOOL_RESULT_LIMIT: 300,
  /** Tool result truncation limit for MEDIUM compression */
  MEDIUM_TOOL_RESULT_LIMIT: 100,
  /** Re-compress every N messages once in HEAVY mode */
  HEAVY_RECOMPRESS_INTERVAL: 20,
} as const;

/** Failed action memory: blocks exact repeats of failed tool calls */
export const FAILED_ACTION_MEMORY = {
  /** Maximum failed actions to remember */
  BUFFER_SIZE: 10,
  /** Turns after step-watchdog escalation before forcing a strategy pivot */
  POST_ESCALATION_PIVOT_TURNS: 5,
} as const;

/** Outcome-based dead-end detection */
export const DEAD_END_DETECTION = {
  /** Size of the sliding window for recent outcomes */
  WINDOW: 6,
  /** Consecutive identical outcomes before injecting a nudge */
  NUDGE_THRESHOLD: 3,
  /** Consecutive identical outcomes before forcing a strategy pivot */
  PIVOT_THRESHOLD: 5,
} as const;

/** Batch execution limits */
export const BATCH_LIMITS = {
  /** Maximum steps in a single batch_execute call */
  MAX_STEPS: 10,
} as const;

/** Timing constants (milliseconds) */
export const TIMING = {
  /** Delay before retrying snapshot refresh */
  SNAPSHOT_RETRY_DELAY: 300,
} as const;

/** Rolling distillation — periodic compression of older history */
export const ROLLING_DISTILL = {
  /** Compress every N turns */
  INTERVAL: 8,
  /** Minimum messages before distillation kicks in */
  MIN_MESSAGES: 20,
  /** Messages to keep verbatim (most recent) */
  KEEP_RECENT: 6,
  /** Maximum summary entries in the distilled output */
  MAX_SUMMARY_ENTRIES: 15,
} as const;

/** Fresh-start recovery — full context reset when escalation cycles exhaust */
export const FRESH_START = {
  /** Escalation cycle count that triggers a fresh start */
  TRIGGER_ESCALATION_CYCLE: 3,
  /** Maximum fresh starts per session */
  MAX_PER_SESSION: 2,
  /** Minimum turns before a fresh start is allowed */
  MIN_TURNS_BEFORE_RESET: 10,
} as const;

// ---------------------------------------------------------------------------
// Difficulty-Adaptive Runtime Limits (RFC: rfc-adaptive-runtime-limits.md)
// ---------------------------------------------------------------------------

/** Task difficulty level assessed by the guardian at plan time */
export type Difficulty = "simple" | "moderate" | "complex" | "extreme";

/** Adaptive limits that the guardian can override per-task */
export interface RuntimeLimits {
  stuckEscalate: number;
  stuckGiveUp: number;
  stuckGiveUpSmart: number;
  maxEscalationCycles: number;
  escalationCooldown: number;
  toolFailureWarn: number;
  toolFailureExit: number;
  maxDoneRejections: number;
  maxConsecutiveAllFail: number;
  deadEndNudge: number;
  deadEndPivot: number;
  stepWarnTurns: number;
  stepEscalateTurns: number;
  maxFreshStarts: number;
}

/** Static defaults — equivalent to current hard-coded values (the "moderate" baseline) */
export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  stuckEscalate: STUCK_THRESHOLDS.ESCALATE,
  stuckGiveUp: STUCK_THRESHOLDS.GIVE_UP,
  stuckGiveUpSmart: STUCK_THRESHOLDS.GIVE_UP_SMART,
  maxEscalationCycles: ESCALATION_LIMITS.MAX_CYCLES,
  escalationCooldown: ESCALATION_LIMITS.COOLDOWN_TURNS,
  toolFailureWarn: TOOL_FAILURE_THRESHOLDS.WARN,
  toolFailureExit: TOOL_FAILURE_THRESHOLDS.EXIT,
  maxDoneRejections: AGENT_LIMITS.MAX_DONE_REJECTIONS,
  maxConsecutiveAllFail: AGENT_LIMITS.MAX_CONSECUTIVE_ALL_FAIL,
  deadEndNudge: DEAD_END_DETECTION.NUDGE_THRESHOLD,
  deadEndPivot: DEAD_END_DETECTION.PIVOT_THRESHOLD,
  stepWarnTurns: STEP_WATCHDOG.WARN_TURNS,
  stepEscalateTurns: STEP_WATCHDOG.ESCALATE_TURNS,
  maxFreshStarts: FRESH_START.MAX_PER_SESSION,
};

/** Hard floor — no profile or override can go below these */
const MINIMUM_LIMITS: RuntimeLimits = {
  stuckEscalate: 2,
  stuckGiveUp: 4,
  stuckGiveUpSmart: 3,
  maxEscalationCycles: 1,
  escalationCooldown: 1,
  toolFailureWarn: 2,
  toolFailureExit: 3,
  maxDoneRejections: 1,
  maxConsecutiveAllFail: 2,
  deadEndNudge: 2,
  deadEndPivot: 3,
  stepWarnTurns: 2,
  stepEscalateTurns: 4,
  maxFreshStarts: 1,
};

/** Hard ceiling — no profile or override can exceed these */
const MAXIMUM_LIMITS: RuntimeLimits = {
  stuckEscalate: 12,
  stuckGiveUp: 25,
  stuckGiveUpSmart: 20,
  maxEscalationCycles: 8,
  escalationCooldown: 6,
  toolFailureWarn: 10,
  toolFailureExit: 15,
  maxDoneRejections: 7,
  maxConsecutiveAllFail: 10,
  deadEndNudge: 6,
  deadEndPivot: 10,
  stepWarnTurns: 12,
  stepEscalateTurns: 20,
  maxFreshStarts: 4,
};

/** Per-difficulty preset overrides (merged on top of DEFAULT_RUNTIME_LIMITS) */
export const DIFFICULTY_PROFILES: Record<Difficulty, Partial<RuntimeLimits>> = {
  simple: {
    stuckEscalate: 3,
    stuckGiveUp: 6,
    stuckGiveUpSmart: 5,
    maxEscalationCycles: 2,
    toolFailureWarn: 2,
    toolFailureExit: 4,
    maxDoneRejections: 1,
    maxConsecutiveAllFail: 3,
    deadEndNudge: 2,
    deadEndPivot: 3,
    stepWarnTurns: 3,
    stepEscalateTurns: 6,
    maxFreshStarts: 1,
  },
  moderate: {
    // Mostly defaults — the static constants were tuned for this tier
    stuckEscalate: 4,
    maxDoneRejections: 2,
  },
  complex: {
    stuckEscalate: 6,
    stuckGiveUp: 14,
    stuckGiveUpSmart: 10,
    maxEscalationCycles: 4,
    toolFailureWarn: 5,
    toolFailureExit: 8,
    maxDoneRejections: 4,
    maxConsecutiveAllFail: 6,
    deadEndNudge: 4,
    deadEndPivot: 6,
    stepWarnTurns: 7,
    stepEscalateTurns: 14,
    maxFreshStarts: 2,
  },
  extreme: {
    stuckEscalate: 8,
    stuckGiveUp: 18,
    stuckGiveUpSmart: 14,
    maxEscalationCycles: 5,
    escalationCooldown: 2,
    toolFailureWarn: 6,
    toolFailureExit: 10,
    maxDoneRejections: 5,
    maxConsecutiveAllFail: 7,
    deadEndNudge: 4,
    deadEndPivot: 7,
    stepWarnTurns: 8,
    stepEscalateTurns: 16,
    maxFreshStarts: 3,
  },
};

/**
 * Resolve runtime limits by merging: defaults → difficulty profile → guardian overrides.
 * Every value is clamped to [MINIMUM, MAXIMUM].
 */
export function resolveRuntimeLimits(
  difficulty: Difficulty,
  guardianOverrides?: Partial<RuntimeLimits> | null,
): RuntimeLimits {
  const profile = DIFFICULTY_PROFILES[difficulty] ?? {};
  const merged = { ...DEFAULT_RUNTIME_LIMITS, ...profile, ...guardianOverrides };
  const result = { ...merged };
  for (const key of Object.keys(result) as (keyof RuntimeLimits)[]) {
    result[key] = Math.max(
      MINIMUM_LIMITS[key],
      Math.min(MAXIMUM_LIMITS[key], result[key]),
    );
  }
  return result;
}

/**
 * Apply a mid-session reassessment. Can only widen limits (increase thresholds),
 * except maxDoneRejections which can be tightened.
 * Returns the updated limits (clamped).
 */
export function reassessRuntimeLimits(
  current: RuntimeLimits,
  overrides: Partial<RuntimeLimits>,
): RuntimeLimits {
  const result = { ...current };
  for (const [key, value] of Object.entries(overrides) as [
    keyof RuntimeLimits,
    number,
  ][]) {
    if (value == null || !(key in result)) continue;
    if (key === "maxDoneRejections") {
      // Can tighten — smart model may judge task is simpler
      result[key] = Math.max(
        MINIMUM_LIMITS[key],
        Math.min(MAXIMUM_LIMITS[key], value),
      );
    } else {
      // Can only widen (increase)
      result[key] = Math.max(
        result[key],
        Math.min(MAXIMUM_LIMITS[key], value),
      );
    }
  }
  return result;
}
