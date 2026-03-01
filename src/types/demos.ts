/**
 * OpenSidebar — Demo recording and golden action types
 */

import type { DomSnapshot } from "./dom";

// --- Demonstration Types (Learning from Demonstration) ---

/** A single recorded user action */
export interface DemoAction {
  type:
    | "click"
    | "type"
    | "scroll"
    | "select"
    | "press_key"
    | "navigate"
    | "drag"
    | "annotate";
  timestamp: number;
  url: string;
  element?: ElementDescriptor;
  /** Typed text, selected option value */
  value?: string;
  /** Key name for press_key actions */
  key?: string;
  /** Pixels scrolled (positive = down) */
  scrollDelta?: number;
  /** Source element for drag actions (element = target) */
  sourceElement?: ElementDescriptor;
}

/** Robust element identifier that survives DOM changes */
export interface ElementDescriptor {
  tagName: string;
  /** Visible text (truncated 80 chars) */
  text: string;
  role?: string;
  /** Key attributes: id, name, type, placeholder, aria-label, href */
  attributes: Record<string, string>;
  /** DOM path e.g. "body>main>form>input:nth-of-type(2)" */
  domPath: string;
  /** Best-effort unique CSS selector */
  selector: string;
}

/** A complete recorded demonstration */
export interface Demonstration {
  id: string;
  name: string;
  description?: string;
  /** Verb phrase — what the demo achieves (e.g. "Log into the account") */
  goal?: string;
  /** State assertions — when the demo applies (e.g. ["Must be logged out"]) */
  preconditions?: string[];
  /** Observable page state — how to verify success (e.g. "URL contains /dashboard") */
  outcomeSignal?: string;
  createdAt: number;
  updatedAt: number;
  actions: DemoAction[];
  /** Domain or URL prefix for matching */
  urlPattern: string;
  /** Tokenized name+description+goal for semantic matching */
  matchTokens: string[];
  /** Times injected into agent context */
  uses: number;
  enabled: boolean;
}

/** Result of matching a demo against a query + URL */
export interface DemoMatchResult {
  demo: Demonstration;
  score: number;
}

// --- Golden Dataset Recording Types ---

/** An enriched action captured during golden recording (includes snapshot + tag ID) */
export interface GoldenAction {
  action: DemoAction;
  /** Tag ID of the interacted element (null for scroll/navigate) */
  tagId: number | null;
  /** DOM snapshot at the time of the action */
  snapshot: DomSnapshot;
}
