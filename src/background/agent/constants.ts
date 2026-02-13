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
  /** Turns of no progress before nudging the agent */
  NUDGE: 6,
  /** Turns of no progress before escalating to smarter model */
  ESCALATE: 12,
  /** Maximum turns before giving up entirely */
  GIVE_UP: 20,
} as const;

/** Tool failure circuit breaker */
export const TOOL_FAILURE_THRESHOLDS = {
  /** Warn after this many consecutive failures on the same tool */
  WARN: 4,
  /** Exit after this many consecutive failures on the same tool */
  EXIT: 6,
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

/** Timing constants (milliseconds) */
export const TIMING = {
  /** Delay before retrying snapshot refresh */
  SNAPSHOT_RETRY_DELAY: 300,
} as const;
