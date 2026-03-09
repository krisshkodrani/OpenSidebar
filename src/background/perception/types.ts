/**
 * Perception Types — Stateful perception agent types
 *
 * Separated from perception.ts to avoid circular dependencies
 * and provide clean imports for the PerceptionAgent class.
 */

import type { TaggedElement, PageSkeletonNode } from "../../types";
import type { TokenUsage } from "../llm/types";

/** A single observation entry from one perception turn. */
export interface ObservationEntry {
  turn: number;
  url: string;
  /** Page identity from LOCATION section (~120 chars) */
  location: string;
  /** What changed since last observation (~200 chars) */
  changes: string;
  /** Blockers summary (~200 chars) */
  blockers: string;
  /** Visual-only content (~150 chars) */
  visualOnly: string;
  /** Snapshot fingerprint at this observation */
  fingerprint: string;
}

/** Input for PerceptionAgent.observe() — goal-free, no objective/subtask. */
export interface ObserveInput {
  screenshotDataUrl: string;
  /** Additional viewport screenshots for panoramic perception */
  panoramicScreenshots?: PanoramicShot[];
  elements: TaggedElement[];
  url: string;
  title: string;
  scroll: { y: number; maxY: number; viewportHeight?: number };
  /** Lightweight page skeleton (headings, landmarks, status, text) */
  skeleton?: PageSkeletonNode[];
  /** Page language from <html lang> (e.g., "de", "ja"). Omitted for English pages. */
  lang?: string;
}

/** Additional viewport screenshot captured at a different scroll position */
export interface PanoramicShot {
  dataUrl: string;
  scrollY: number;
  label: string; // "top", "middle", "bottom"
}

/** Serializable state for cross-navigation persistence. */
export interface PerceptionState {
  observationLog: ObservationEntry[];
  lastFingerprint: string;
  fingerprintAge: number;
  turnCounter: number;
}

/** Result from PerceptionAgent.observe() — no completion signal. */
export interface PerceptionResult {
  interpretation: string;
  usage?: TokenUsage;
  model: string;
  providerId?: string;
  durationMs: number;
  cached: boolean;
  /** The parsed observation from this call (undefined on cache hit or fallback) */
  observation?: ObservationEntry;
}
