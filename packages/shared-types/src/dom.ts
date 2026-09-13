/**
 * OpenSidebar — DOM snapshot and element types
 */

// --- Content Script Types ---

/** The distilled DOM representation sent to the LLM */
export interface DomSnapshot {
  /** Page title */
  title: string;
  /** Current URL */
  url: string;
  /** Page language from <html lang> attribute (e.g., "de", "ja", "ar") */
  lang?: string;
  /** Text direction — "rtl" for right-to-left languages (Arabic, Hebrew) */
  dir?: "ltr" | "rtl";
  /** Array of tagged interactive elements */
  elements: TaggedElement[];
  /** Plain text content of the visible viewport (truncated) */
  visibleContent?: string;
  /** Markdown-formatted page content from Readability + Turndown (or plain text fallback) */
  pageContent?: string;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Scroll position */
  scroll: { x: number; y: number; maxY: number; viewportHeight: number };
  /** Overlays that survived auto-dismissal (agent should handle manually) */
  survivingOverlays?: { tagId: number; coveragePercent: number }[];
  /** Text content extracted from overlays that were dismissed (deduplicated) */
  capturedTexts?: string[];
  /** Overflow info when element cap was hit or near-identical elements collapsed */
  overflow?: { shown: number; total: number; collapsedGroups?: string[] };
  /** Lightweight page skeleton: headings, landmarks, status, and content text */
  skeleton?: PageSkeletonNode[];
  /** Detected SPA framework — "react", "vue", "angular", or "unknown" */
  framework?: string;
}

/**
 * Adapter-neutral identity for the live document that produced an observation.
 * The instance id changes on document replacement; the epoch advances whenever
 * page-owned DOM or location state changes within that document.
 */
export interface PageDocumentState {
  documentInstanceId: string;
  mutationEpoch: number;
  url: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
}

/** A structural (non-interactive) DOM node for page skeleton */
export interface PageSkeletonNode {
  /** HTML tag name, e.g. "h1", "nav", "p" */
  tagName: string;
  /** Semantic role: "heading", "navigation", "status", or tagName */
  role: string;
  /** Heading level 1-6 (only for headings) */
  level?: number;
  /** Visible text content (truncated to 120 chars) */
  text: string;
  /** Nesting depth from <body> (0 = direct child), capped at 4 */
  depth: number;
}

/** A single interactive DOM element with a numeric tag */
export interface TaggedElement {
  /** Unique numeric tag (the [N] label) */
  tag: number;
  /** HTML tag name (lowercase) */
  tagName: string;
  /** Role attribute or inferred role */
  role: string;
  /** Visible text content (truncated to 80 chars) */
  text: string;
  /** Key attributes: href, placeholder, aria-label, type, name */
  attributes: Record<string, string>;
  /** Bounding rect relative to viewport */
  rect: ElementRect;
  /** Whether the element is currently visible in the viewport */
  isVisible: boolean;
  /** Whether the element is disabled */
  isDisabled: boolean;
  /**
   * True when the element appeared since the previous snapshot (stable-hash
   * set difference). Rendered as a `*` prefix so the model can see what its
   * last action changed. Omitted on first snapshots, navigations (>50% new),
   * and capped snapshots where the diff is unreliable.
   */
  isNew?: boolean;
}

/** Bounding rectangle for a DOM element */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Absolute Y position on the page (rect.y + scrollY). Used for @y hints. */
  pageY?: number;
}

/** Describes a viewport-covering overlay that heuristic dismissal couldn't remove */
export interface OverlayDescriptor {
  /** outerHTML truncated to 3000 chars */
  html: string;
  /** Assigned via addDynamicTag */
  tagId: number;
  /** Bounding rect of the overlay */
  rect: ElementRect;
  /** Percentage of viewport covered by this overlay */
  coveragePercent: number;
}
