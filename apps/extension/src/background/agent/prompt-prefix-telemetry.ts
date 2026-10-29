/**
 * Prompt-prefix telemetry (RFC LP-21 §9).
 *
 * OpenRouter prefix caching keeps only the bytes BEFORE the first
 * changed byte of a request. So the single most predictive number we can record
 * is *where the current turn's prompt first diverges from the previous turn's*
 * — everything after that offset is billed at full price no matter how long the
 * shared prefix nominally is.
 *
 * Before this module, prefix breaks were inferred indirectly from turn-to-turn
 * input-token deltas (see issue #103, which had to reason from a 13-turn trace).
 * This makes them directly observable.
 *
 * ## Why this stores digests and never text
 *
 * A fingerprint is retained across turns to diff against. Retaining prompt TEXT
 * would mean holding page content — which is user browsing data — in agent
 * memory and, worse, risking it reaching an exported span. So a fingerprint
 * holds only:
 *
 *   - block-level hashes (irreversible, fixed width),
 *   - lengths and counts.
 *
 * No content is recoverable from a fingerprint, so no telemetry consumer can
 * leak page state through this path.
 *
 * ## Why block-level
 *
 * Message-granular divergence would be too coarse: LP-21 phase 2's whole point
 * was moving a volatile region OUT of message 0, and verifying that requires
 * knowing whether message 0 diverges at char 200 or not at all. Hashing each
 * message in fixed-size blocks resolves the divergence offset to within
 * `BLOCK_SIZE` chars while keeping retained memory proportional to
 * prompt-length / BLOCK_SIZE rather than to prompt length.
 */

import type { LLMMessage } from "../llm/types";

/**
 * Divergence resolution, in characters. Small enough to tell "message 0 is
 * byte-stable" from "message 0 diverges early"; large enough that a 100K-char
 * prompt retains ~400 hashes rather than 100K chars of page text.
 */
const BLOCK_SIZE = 256;

/**
 * Which structural region of the prompt a divergence landed in.
 *
 * "tools" is the function-tool array sent alongside the messages. Providers
 * serialize it AHEAD of every message, so a changed tool set — or even a
 * reordered one — invalidates the entire cached prefix. Before this region
 * existed, that churn was invisible: `fingerprintPrompt` hashed messages only,
 * which is a candidate explanation for the ~99% unexplained divergence in the
 * 2026-07-23 step-2 baseline (issue #103).
 */
export type PromptRegion =
  | "tools"
  | "system"
  | "history"
  | "volatile_tail"
  | "none";

/** How the tools array changed relative to the previous turn. */
export type ToolsChange =
  | "none"
  /** Same tool set, different order — the skill-ranking signature. */
  | "reordered"
  /** Tools were added, removed, or their definition bytes changed. */
  | "set_changed"
  /** No previous tools digest to compare against. */
  | "unknown";

/** Minimal structural shape of a function-tool definition, for hashing. */
export interface ToolDefinitionLike {
  function: { name: string };
}

export interface PromptMessageFingerprint {
  role: LLMMessage["role"];
  /** Serialized length in characters. */
  length: number;
  /** Hash per BLOCK_SIZE-char block of the serialized message. */
  blockDigests: string[];
}

export interface PromptPrefixFingerprint {
  /** Digest of the whole serialized prompt — changes iff any byte changed. */
  digest: string;
  messages: PromptMessageFingerprint[];
  /** Total serialized length of the prompt, in characters. */
  totalChars: number;
  /** First volatile message in this prompt, including current visual evidence. */
  volatileTailStartIndex: number;
  /**
   * Order-sensitive digest of the tools array (names + definition bytes, in
   * send order). Absent when the fingerprint was taken without tools.
   */
  toolsDigest?: string;
  /**
   * Order-INsensitive digest of the same tools. When `toolsDigest` differs but
   * this matches, the array was merely reordered.
   */
  toolsSetDigest?: string;
  /** Number of tools in the array. */
  toolsCount?: number;
}

export interface PromptPrefixDivergence {
  /**
   * Index of the first message that differs from the previous turn, or null
   * when the prompt is byte-identical (or there is no previous turn).
   */
  firstDivergenceMessageIndex: number | null;
  /**
   * Character offset of the first divergence within the serialized prompt,
   * rounded DOWN to a block boundary — i.e. a lower bound on the surviving
   * prefix, never an optimistic one. Null when nothing diverged.
   */
  firstDivergenceOffset: number | null;
  /** Region the divergence landed in. "none" when nothing diverged. */
  firstDivergenceRegion: PromptRegion;
  /** Characters of prompt that survived unchanged before the divergence. */
  stablePrefixChars: number;
  /** `stablePrefixChars` as a percentage of the current prompt, 2dp. */
  stablePrefixPct: number;
  /** Whole messages that were byte-identical to the previous turn. */
  stablePrefixMessages: number;
  /** True on the first turn, where there is nothing to compare against. */
  isFirstTurn: boolean;
  /** How the tools array changed. "unknown" when either side lacks a digest. */
  toolsChange: ToolsChange;
}

/**
 * FNV-1a, 32-bit, returned as 8 hex chars.
 *
 * Deliberately NOT a cryptographic hash: this runs on every block of every
 * prompt on every turn, and `crypto.subtle` is async — awaiting it would push
 * telemetry into the turn's critical path. Collisions here cost us a missed
 * divergence report, not a correctness bug, and FNV-1a's collision rate on
 * 256-char blocks is far below the noise floor of what we're measuring.
 */
function hashBlock(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // hash *= 16777619, via shifts to stay in 32-bit int range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Serialize a message the way its bytes reach the provider.
 *
 * The exact wire format is the provider's business; what matters is that this
 * is *stable and total* — two messages serialize identically iff nothing the
 * provider sees changed. Tool calls are included because a changed tool-call
 * argument breaks the cache exactly like changed content does.
 */
function serializeMessage(message: LLMMessage): string {
  const parts: string[] = [message.role];
  if (typeof message.content === "string") {
    parts.push(message.content);
  } else if (Array.isArray(message.content)) {
    // Hash image parts without retaining base64 in the fingerprint. Length
    // alone misses same-size screenshots that still break the provider cache.
    parts.push(
      message.content
        .map((part) =>
          part.type === "text"
            ? `text:${part.text}`
            : `part:${part.type}:${hashBlock(JSON.stringify(part))}`,
        )
        .join("\u0000"),
    );
  } else {
    parts.push("");
  }
  if (message.tool_call_id) parts.push(`tcid:${message.tool_call_id}`);
  if (message.name) parts.push(`name:${message.name}`);
  if (message.tool_calls?.length) {
    parts.push(
      message.tool_calls
        .map((call) => `${call.id}:${call.function.name}:${call.function.arguments}`)
        .join("\u0000"),
    );
  }
  return parts.join("");
}

function fingerprintMessage(message: LLMMessage): PromptMessageFingerprint {
  const serialized = serializeMessage(message);
  const blockDigests: string[] = [];
  for (let offset = 0; offset < serialized.length; offset += BLOCK_SIZE) {
    blockDigests.push(hashBlock(serialized.slice(offset, offset + BLOCK_SIZE)));
  }
  return { role: message.role, length: serialized.length, blockDigests };
}

/**
 * Fingerprint a prompt for cross-turn comparison. Retain the result and pass it
 * as `previous` on the next turn.
 */
export function fingerprintPrompt(
  messages: LLMMessage[],
  tools?: ReadonlyArray<ToolDefinitionLike>,
  volatileTailStartIndex = messages.length - 1,
): PromptPrefixFingerprint {
  const fingerprints = messages.map(fingerprintMessage);
  const totalChars = fingerprints.reduce((sum, m) => sum + m.length, 0);
  // Digest of digests: cheap, and changes iff some block changed.
  const digest = hashBlock(
    fingerprints.map((m) => m.blockDigests.join("")).join(""),
  );
  const fingerprint: PromptPrefixFingerprint = {
    digest,
    messages: fingerprints,
    totalChars,
    volatileTailStartIndex,
  };
  if (tools) {
    // Full definition bytes, not just names: a changed description or schema
    // breaks the provider cache exactly like a changed tool set does. The
    // set digest sorts the serialized defs so a pure reorder (the
    // skill-ranking signature) is distinguishable from a real set change.
    const serialized = tools.map((tool) => JSON.stringify(tool));
    fingerprint.toolsDigest = hashBlock(serialized.join(" "));
    fingerprint.toolsSetDigest = hashBlock([...serialized].sort().join(" "));
    fingerprint.toolsCount = tools.length;
  }
  return fingerprint;
}

/** Classify how the tools array changed between two fingerprints. */
function compareTools(
  previous: PromptPrefixFingerprint,
  current: PromptPrefixFingerprint,
): ToolsChange {
  if (!previous.toolsDigest || !current.toolsDigest) return "unknown";
  if (previous.toolsDigest === current.toolsDigest) return "none";
  return previous.toolsSetDigest === current.toolsSetDigest
    ? "reordered"
    : "set_changed";
}

/**
 * Attribute a message index to a prompt region.
 *
 * Use the previous prompt's boundary. Appending history shifts its old visual
 * and page-state tail to a later index, but caching still survives up to that
 * old tail. Divergence before the boundary is an actual prefix break.
 */
function regionForIndex(index: number, previous: PromptPrefixFingerprint): PromptRegion {
  if (index === 0) return "system";
  if (index >= previous.volatileTailStartIndex) return "volatile_tail";
  return "history";
}

/**
 * Locate the first byte at which this turn's prompt diverges from the previous
 * turn's — the point past which prefix caching stops paying.
 */
export function comparePromptPrefix(
  previous: PromptPrefixFingerprint | null,
  current: PromptPrefixFingerprint,
): PromptPrefixDivergence {
  if (!previous) {
    return {
      firstDivergenceMessageIndex: null,
      firstDivergenceOffset: null,
      firstDivergenceRegion: "none",
      stablePrefixChars: 0,
      stablePrefixPct: 0,
      stablePrefixMessages: 0,
      isFirstTurn: true,
      toolsChange: "unknown",
    };
  }

  const toolsChange = compareTools(previous, current);
  // The tools array serializes AHEAD of every message, so any change to it —
  // including a pure reorder — invalidates the whole cached prefix regardless
  // of how stable the messages are. Report it as a divergence at offset 0.
  if (toolsChange === "reordered" || toolsChange === "set_changed") {
    return {
      firstDivergenceMessageIndex: null,
      firstDivergenceOffset: 0,
      firstDivergenceRegion: "tools",
      stablePrefixChars: 0,
      stablePrefixPct: 0,
      stablePrefixMessages: 0,
      isFirstTurn: false,
      toolsChange,
    };
  }

  const messageCount = current.messages.length;
  let charsBefore = 0;

  const shared = Math.min(previous.messages.length, messageCount);
  for (let i = 0; i < shared; i++) {
    const prev = previous.messages[i];
    const cur = current.messages[i];

    if (prev.role !== cur.role) {
      return divergence(i, charsBefore, i, previous, current, toolsChange);
    }

    const sharedBlocks = Math.min(prev.blockDigests.length, cur.blockDigests.length);
    for (let b = 0; b < sharedBlocks; b++) {
      if (prev.blockDigests[b] !== cur.blockDigests[b]) {
        return divergence(i, charsBefore + b * BLOCK_SIZE, i, previous, current, toolsChange);
      }
    }

    // Same blocks so far, but one message is longer — it grew (or shrank) past
    // the shared blocks, so it diverges at the end of the shared region.
    if (prev.blockDigests.length !== cur.blockDigests.length) {
      return divergence(
        i,
        charsBefore + sharedBlocks * BLOCK_SIZE,
        i,
        previous,
        current,
        toolsChange,
      );
    }

    charsBefore += cur.length;
  }

  // Every shared message was identical. If the current prompt has MORE
  // messages, that is a pure append — the ideal case, no divergence at all.
  if (messageCount > previous.messages.length) {
    return {
      firstDivergenceMessageIndex: null,
      firstDivergenceOffset: null,
      firstDivergenceRegion: "none",
      stablePrefixChars: charsBefore,
      stablePrefixPct: pct(charsBefore, current.totalChars),
      stablePrefixMessages: shared,
      isFirstTurn: false,
      toolsChange,
    };
  }

  // Fewer messages than last turn: history was truncated or rebuilt. Nothing
  // diverged within the surviving prefix, but the prompt is shorter than what
  // the provider cached, so report the truncation point as the divergence.
  if (messageCount < previous.messages.length) {
    return divergence(messageCount, charsBefore, messageCount, previous, current, toolsChange);
  }

  return {
    firstDivergenceMessageIndex: null,
    firstDivergenceOffset: null,
    firstDivergenceRegion: "none",
    stablePrefixChars: charsBefore,
    stablePrefixPct: pct(charsBefore, current.totalChars),
    stablePrefixMessages: messageCount,
    isFirstTurn: false,
    toolsChange,
  };
}

function divergence(
  messageIndex: number,
  offset: number,
  stableMessages: number,
  previous: PromptPrefixFingerprint,
  current: PromptPrefixFingerprint,
  toolsChange: ToolsChange,
): PromptPrefixDivergence {
  return {
    firstDivergenceMessageIndex: messageIndex,
    firstDivergenceOffset: offset,
    firstDivergenceRegion: regionForIndex(messageIndex, previous),
    stablePrefixChars: offset,
    stablePrefixPct: pct(offset, current.totalChars),
    stablePrefixMessages: stableMessages,
    isFirstTurn: false,
    toolsChange,
  };
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

/** A deliberate, one-time discard of the cached prompt prefix. */
export interface PromptPrefixReset {
  /** Which compaction mechanism reset the prefix. */
  cause: string;
  messagesBefore: number;
  messagesAfter: number;
}

/**
 * Records deliberate prompt-prefix resets so telemetry can separate them from
 * the accidental per-turn prefix breakage of issue #103.
 *
 * History compaction has to rewrite already-cached bytes — that is inherent, and
 * the resulting cache miss is a one-time cost, not a defect. What IS a defect is
 * a miss on a turn where no compaction ran. Without this distinction both look
 * identical in the data, which is exactly why #103 needed a hand-built
 * token-delta table to reason about a single 13-turn trace.
 *
 * The ledger holds at most one pending reset: it is drained by the turn that
 * actually pays for it, so a reset is reported exactly once, against the right
 * turn.
 */
export class PrefixResetLedger {
  private pending: PromptPrefixReset | null = null;

  record(cause: string, messagesBefore: number, messagesAfter: number): void {
    this.pending = { cause, messagesBefore, messagesAfter };
  }

  /** Drain the pending reset, if any. */
  consume(): PromptPrefixReset | null {
    const reset = this.pending;
    this.pending = null;
    return reset;
  }
}
