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
  /** Tighter give-up when already on the planner model (saves wasted turns) */
  GIVE_UP_PLANNER: 8,
  /** Same-URL turns before forced escalation (independent of DOM delta) */
  SAME_URL_ESCALATE: 6,
} as const;

/** Escalation/de-escalation cycle limits */
export const ESCALATION_LIMITS = {
  /** Max escalation→de-escalation cycles before cooldown becomes effectively permanent */
  MAX_CYCLES: 5,
  /** Turns of cooldown after de-escalation before re-escalation is allowed */
  COOLDOWN_TURNS: 3,
  /** Minimum turns the planner model must run before de-escalation is allowed */
  MIN_PLANNER_TENURE: 2,
  /** Consecutive progress signals required before de-escalation */
  PROGRESS_GATE: 2,
} as const;

/** plan-then-act: planner model orients, then executor model executes */
export const ORIENTATION = {
  /** Turns the planner model runs before handing off to executor model */
  PHASE_TURNS: 2,
} as const;

/** Tools that signal an investigation-type task (extend planner orientation phase when used) */
export const INVESTIGATION_TOOLS = new Set<string>([
  "inspect_hidden",
  "execute_js",
  "xray_page",
  "read_element",
]);
/** Additional turns to extend orientation when investigation tools are used */
export const INVESTIGATION_EXTENSION = 3;
/** Maximum total orientation turns (cap for extended phase) */
export const MAX_ORIENTATION_TURNS = 6;

/** Tool failure circuit breaker */
export const TOOL_FAILURE_THRESHOLDS = {
  /** Warn after this many consecutive failures on the same tool */
  WARN: 3,
  /** Exit after this many consecutive failures on the same tool */
  EXIT: 4,
} as const;

/** Exploration budget: nudge after consecutive turns of only reading/inspecting */
export const EXPLORATION_BUDGET = { MAX_CONSECUTIVE: 3 } as const;

/** Tools classified as exploration-only (read/inspect, no side-effects on the page) */
export const EXPLORATION_ONLY_TOOLS = new Set<string>([
  "read_page",
  "find_element",
  "inspect_hidden",
  "read_element",
  "xray_page",
  "get_cookies",
  "search_history",
]);

/** Redundant action detection (informational — nudges, never blocks) */
export const REDUNDANT_ACTION = {
  /** Size of the sliding window for recent successful tool calls */
  WINDOW: 10,
  /** Exact (tool+args+same page state) repetitions before injecting an informational nudge */
  INFO_THRESHOLD: 4,
  /** Same tool name (any args) repetitions before a soft note */
  TOOL_NAME_INFO_THRESHOLD: 6,
} as const;

/** Tool result cache configuration */
export const TOOL_CACHE = {
  /** Maximum cached entries (FIFO eviction) */
  MAX_SIZE: 64,
  /** Redundant action block: skip execution after this many same (tool+args+fingerprint) repeats */
  BLOCK_THRESHOLD: 3,
} as const;

/** Step duration watchdog */
export const STEP_WATCHDOG = {
  /** Turns on same step before injecting a nudge */
  WARN_TURNS: 4,
  /** Turns on same step before forcing escalation */
  ESCALATE_TURNS: 7,
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
  /** Maximum tokens in LLM response (8192 to accommodate reasoning models
   *  like Kimi K2.5 whose reasoning_content counts toward this limit) */
  MAX_TOKENS: 8192,
  /** Temperature for agentic tasks (low = deterministic) */
  TEMPERATURE: 0,
  /** Token budget for decomposition */
  DECOMPOSITION_MAX_TOKENS: 512,
  /** Token budget for validation */
  VALIDATION_MAX_TOKENS: 256,
  /** Maximum subtasks from planner */
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
  LIGHT_TURN_COUNT: 20,
  /** History length at which MEDIUM compression activates */
  MEDIUM_TURN_COUNT: 40,
  /** History length at which HEAVY compression activates */
  HEAVY_TURN_COUNT: 70,
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

/** Outcome-based stagnation detection */
export const STAGNATION_DETECTION = {
  /** Size of the sliding window for recent outcomes */
  WINDOW: 6,
  /** Consecutive identical outcomes before injecting a reflection */
  REFLECTION_THRESHOLD: 2,
  /** Consecutive identical outcomes before forcing a strategy pivot */
  PIVOT_THRESHOLD: 4,
} as const;

/** Action effect verification thresholds */
export const ACTION_EFFECT = {
  /** Below this delta fraction, the action had ~no observable effect */
  ZERO_THRESHOLD: 0.02,
  /** First consecutive zero-effect turn gets a compact warning */
  WARNING_THRESHOLD: 1,
  /** Second consecutive zero-effect turn escalates or replans immediately */
  ESCALATE_THRESHOLD: 2,
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
// Difficulty-Adaptive Runtime Limits
// ---------------------------------------------------------------------------

/** Task difficulty level assessed by the planner at plan time */
export type Difficulty = "simple" | "moderate" | "complex" | "extreme";

/** Adaptive limits that the planner can override per-task */
export interface RuntimeLimits {
  stuckEscalate: number;
  stuckGiveUp: number;
  stuckGiveUpPlanner: number;
  maxEscalationCycles: number;
  escalationCooldown: number;
  toolFailureWarn: number;
  toolFailureExit: number;
  maxDoneRejections: number;
  maxConsecutiveAllFail: number;
  stagnationReflection: number;
  stagnationPivot: number;
  stepWarnTurns: number;
  stepEscalateTurns: number;
  maxFreshStarts: number;
  sameUrlEscalate: number;
}

/** Static defaults — equivalent to current hard-coded values (the "moderate" baseline) */
export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = {
  stuckEscalate: STUCK_THRESHOLDS.ESCALATE,
  stuckGiveUp: STUCK_THRESHOLDS.GIVE_UP,
  stuckGiveUpPlanner: STUCK_THRESHOLDS.GIVE_UP_PLANNER,
  maxEscalationCycles: ESCALATION_LIMITS.MAX_CYCLES,
  escalationCooldown: ESCALATION_LIMITS.COOLDOWN_TURNS,
  toolFailureWarn: TOOL_FAILURE_THRESHOLDS.WARN,
  toolFailureExit: TOOL_FAILURE_THRESHOLDS.EXIT,
  maxDoneRejections: AGENT_LIMITS.MAX_DONE_REJECTIONS,
  maxConsecutiveAllFail: AGENT_LIMITS.MAX_CONSECUTIVE_ALL_FAIL,
  stagnationReflection: STAGNATION_DETECTION.REFLECTION_THRESHOLD,
  stagnationPivot: STAGNATION_DETECTION.PIVOT_THRESHOLD,
  stepWarnTurns: STEP_WATCHDOG.WARN_TURNS,
  stepEscalateTurns: STEP_WATCHDOG.ESCALATE_TURNS,
  maxFreshStarts: FRESH_START.MAX_PER_SESSION,
  sameUrlEscalate: STUCK_THRESHOLDS.SAME_URL_ESCALATE,
};

/** Hard floor — no profile or override can go below these */
const MINIMUM_LIMITS: RuntimeLimits = {
  stuckEscalate: 2,
  stuckGiveUp: 4,
  stuckGiveUpPlanner: 3,
  maxEscalationCycles: 1,
  escalationCooldown: 1,
  toolFailureWarn: 2,
  toolFailureExit: 3,
  maxDoneRejections: 1,
  maxConsecutiveAllFail: 2,
  stagnationReflection: 2,
  stagnationPivot: 3,
  stepWarnTurns: 2,
  stepEscalateTurns: 4,
  maxFreshStarts: 1,
  sameUrlEscalate: 4,
};

/** Hard ceiling — no profile or override can exceed these */
const MAXIMUM_LIMITS: RuntimeLimits = {
  stuckEscalate: 12,
  stuckGiveUp: 25,
  stuckGiveUpPlanner: 20,
  maxEscalationCycles: 8,
  escalationCooldown: 6,
  toolFailureWarn: 10,
  toolFailureExit: 15,
  maxDoneRejections: 7,
  maxConsecutiveAllFail: 10,
  stagnationReflection: 6,
  stagnationPivot: 10,
  stepWarnTurns: 12,
  stepEscalateTurns: 20,
  maxFreshStarts: 4,
  sameUrlEscalate: 16,
};

/** Per-difficulty preset overrides (merged on top of DEFAULT_RUNTIME_LIMITS) */
export const DIFFICULTY_PROFILES: Record<Difficulty, Partial<RuntimeLimits>> = {
  simple: {
    stuckEscalate: 3,
    stuckGiveUp: 5,
    stuckGiveUpPlanner: 4,
    maxEscalationCycles: 2,
    toolFailureWarn: 2,
    toolFailureExit: 3,
    maxDoneRejections: 1,
    maxConsecutiveAllFail: 2,
    stagnationReflection: 2,
    stagnationPivot: 3,
    stepWarnTurns: 3,
    stepEscalateTurns: 5,
    maxFreshStarts: 1,
    sameUrlEscalate: 5,
  },
  moderate: {
    // Tighter than old defaults — fail fast, escalate sooner
    stuckEscalate: 4,
    maxDoneRejections: 2,
    stepEscalateTurns: 7,
    sameUrlEscalate: 6,
  },
  complex: {
    stuckEscalate: 6,
    stuckGiveUp: 14,
    stuckGiveUpPlanner: 10,
    maxEscalationCycles: 4,
    toolFailureWarn: 5,
    toolFailureExit: 8,
    maxDoneRejections: 4,
    maxConsecutiveAllFail: 6,
    stagnationReflection: 4,
    stagnationPivot: 6,
    stepWarnTurns: 7,
    stepEscalateTurns: 14,
    maxFreshStarts: 2,
    sameUrlEscalate: 10,
  },
  extreme: {
    stuckEscalate: 8,
    stuckGiveUp: 18,
    stuckGiveUpPlanner: 14,
    maxEscalationCycles: 5,
    escalationCooldown: 2,
    toolFailureWarn: 6,
    toolFailureExit: 10,
    maxDoneRejections: 5,
    maxConsecutiveAllFail: 7,
    stagnationReflection: 4,
    stagnationPivot: 7,
    stepWarnTurns: 8,
    stepEscalateTurns: 16,
    maxFreshStarts: 3,
    sameUrlEscalate: 12,
  },
};

/**
 * Resolve runtime limits by merging: defaults → difficulty profile → planner overrides.
 * Every value is clamped to [MINIMUM, MAXIMUM].
 */
export function resolveRuntimeLimits(
  difficulty: Difficulty,
  plannerOverrides?: Partial<RuntimeLimits> | null,
): RuntimeLimits {
  const profile = DIFFICULTY_PROFILES[difficulty] ?? {};
  const merged = { ...DEFAULT_RUNTIME_LIMITS, ...profile, ...plannerOverrides };
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
      // Can tighten — planner model may judge task is simpler
      result[key] = Math.max(
        MINIMUM_LIMITS[key],
        Math.min(MAXIMUM_LIMITS[key], value),
      );
    } else {
      // Can only widen (increase)
      result[key] = Math.max(result[key], Math.min(MAXIMUM_LIMITS[key], value));
    }
  }
  return result;
}
