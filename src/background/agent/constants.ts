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
  ESCALATE: 3,
  /** Maximum turns before giving up entirely */
  GIVE_UP: 10,
  /** Tighter give-up when already on the smart model (saves wasted turns) */
  GIVE_UP_SMART: 8,
} as const;

/** Escalation/de-escalation cycle limits */
export const ESCALATION_LIMITS = {
  /** Max escalation→de-escalation cycles before staying on smart permanently */
  MAX_CYCLES: 3,
  /** Turns of cooldown after de-escalation before re-escalation is allowed */
  COOLDOWN_TURNS: 3,
  /** Minimum turns the smart model must run before de-escalation is allowed */
  MIN_SMART_TENURE: 5,
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

/** Redundant action detection */
export const REDUNDANT_ACTION = {
  /** Size of the sliding window for recent successful tool calls */
  WINDOW: 8,
  /** Number of exact (tool+args) repetitions before injecting a corrective message */
  THRESHOLD: 2,
  /** Block the next exact repeat once this many successful identical DOM actions would occur */
  HARD_BLOCK_THRESHOLD: 3,
  /** Number of same tool name (any args) repetitions before injecting a warning */
  TOOL_NAME_ONLY_THRESHOLD: 4,
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
