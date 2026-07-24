/**
 * LP-24 presence layer — the choreography grammar (RFC §5).
 *
 * Maps action kind × control type to a visual script: where the cursor
 * glides, which glyph it wears, where the ripple lands (radio/checkbox
 * clicks retarget the visual from the label to the control), whether a
 * focus halo appears, and what chip (if any) narrates a non-visual effect.
 */

import type { Point } from "./motion";

export type PresenceActionKind =
  | "click"
  | "right_click"
  | "type"
  | "select"
  | "checkbox"
  | "hover"
  | "key"
  | "drag"
  | "scroll"
  | "upload"
  | "none";

export interface ChoreographyScript {
  kind: PresenceActionKind;
  /** Where the cursor glides / the ripple lands (viewport coords). */
  point: Point | null;
  /** Width of the visual target — feeds Fitts duration scaling. */
  targetWidth: number;
  ripple: "accent" | "square" | "none";
  /** Element that receives a persistent focus halo (text fields, selects). */
  haloTarget: Element | null;
  /** Chip text narrating an effect the page won't render (select value, upload). */
  chipText: string | null;
  /** Key label for key-cap chips. */
  keyLabel: string | null;
  /** Scroll direction for the chevron glyph. */
  scrollDirection: "up" | "down" | "left" | "right" | null;
  /** Drag source rect for the ghost outline. */
  dragSourceRect: DOMRect | null;
  /** Drag destination point. */
  dragTo: Point | null;
  /** Cinematic-only post-action hold (ms) before the next glide — restores a
   *  human rhythm after instant value-pops (owner feedback: zip-pop cadence). */
  lingerMs: number;
}

/** Linger scaled to how much "typing" the instant value-pop stood in for. */
export function typeLingerMs(textLength: number): number {
  return Math.min(800, 250 + 25 * textLength);
}

function centerOf(el: Element): Point {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Rect only when the element has real on-screen geometry. */
function visibleRectOf(el: Element | null | undefined): DOMRect | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1 ? rect : null;
}

function labelOf(control: Element): Element | null {
  const wrapping = control.closest("label");
  if (wrapping) return wrapping;
  const id = control.getAttribute("id");
  if (!id) return null;
  try {
    return control.ownerDocument.querySelector(
      `label[for="${typeof CSS !== "undefined" ? CSS.escape(id) : id}"]`,
    );
  } catch {
    return null;
  }
}

/**
 * Where the cursor lands for an element-targeted action. Custom radios and
 * checkboxes hide the real input (opacity:0 / sr-only / 1x1px), so its rect
 * would put the cursor "in the general area" — or at the page origin — not
 * on the choice (owner report 2026-07-24). Resolution order:
 *   1. the control's own visible rect → its center;
 *   2. its label's (or parent's) rect → the START of that rect, where the
 *      choice bullet visually sits;
 *   3. nothing visible → null, and the glide is skipped entirely.
 */
export function resolveVisualAnchor(
  target: Element,
  kind: PresenceActionKind,
): { point: Point; width: number } | null {
  const control =
    kind === "click" || kind === "checkbox"
      ? resolveVisualTarget(target)
      : target;
  const own = visibleRectOf(control);
  if (own) {
    return {
      point: { x: own.left + own.width / 2, y: own.top + own.height / 2 },
      width: own.width,
    };
  }
  const fallback =
    visibleRectOf(labelOf(control)) ?? visibleRectOf(control.parentElement);
  if (!fallback) return null;
  return {
    point: {
      x: fallback.left + Math.min(14, fallback.width / 2),
      y: fallback.top + fallback.height / 2,
    },
    width: Math.min(fallback.width, 48),
  };
}

function isTextEntry(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (tag !== "input") return false;
  const type = (el.getAttribute("type") ?? "text").toLowerCase();
  return ![
    "checkbox",
    "radio",
    "button",
    "submit",
    "reset",
    "range",
    "color",
    "file",
    "image",
  ].includes(type);
}

function isToggleControl(el: Element): boolean {
  if (el.tagName.toLowerCase() !== "input") return false;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  return type === "checkbox" || type === "radio";
}

/**
 * Clicks on a <label> visually belong to the control it labels — the ripple
 * lands on the radio/checkbox, not the text (RFC §5).
 */
export function resolveVisualTarget(el: Element): Element {
  if (isToggleControl(el)) return el;
  const label = el.closest("label");
  if (label) {
    const forId = label.getAttribute("for");
    const doc = el.ownerDocument;
    const control = forId
      ? doc.getElementById(forId)
      : label.querySelector("input[type=checkbox], input[type=radio]");
    if (control && isToggleControl(control)) return control;
  }
  return el;
}

export function buildScript(params: {
  kind: PresenceActionKind;
  target?: Element | null;
  point?: Point | null;
  optionLabel?: string | null;
  key?: string | null;
  scrollDirection?: "up" | "down" | "left" | "right" | null;
  dragTarget?: Element | null;
  typedTextLength?: number;
}): ChoreographyScript {
  const script: ChoreographyScript = {
    kind: params.kind,
    point: params.point ?? null,
    targetWidth: 24,
    ripple: "none",
    haloTarget: null,
    chipText: null,
    keyLabel: null,
    scrollDirection: null,
    dragSourceRect: null,
    dragTo: null,
    lingerMs: 120,
  };

  const target = params.target ?? null;
  if (target) {
    const anchor = resolveVisualAnchor(target, params.kind);
    if (anchor) {
      script.point = anchor.point;
      script.targetWidth = Math.max(8, Math.min(anchor.width, 400));
    }
  }

  switch (params.kind) {
    case "click":
    case "upload":
      script.ripple = "accent";
      if (params.kind === "upload") script.chipText = "file attached";
      break;
    case "right_click":
      script.ripple = "square";
      break;
    case "checkbox":
      script.ripple = "accent";
      break;
    case "type":
      script.ripple = "accent";
      if (target && isTextEntry(target)) script.haloTarget = target;
      script.lingerMs = typeLingerMs(params.typedTextLength ?? 10);
      break;
    case "select":
      script.ripple = "accent";
      script.haloTarget = target;
      script.lingerMs = 500;
      // Honesty over mime: the OS picker never renders in-page, so narrate
      // the chosen value with a chip instead of faking a menu (RFC §5).
      script.chipText = params.optionLabel ? `${params.optionLabel} ✓` : null;
      break;
    case "hover":
      break;
    case "key":
      script.keyLabel = params.key ?? null;
      break;
    case "scroll":
      script.scrollDirection = params.scrollDirection ?? "down";
      break;
    case "drag": {
      if (target) script.dragSourceRect = target.getBoundingClientRect();
      if (params.dragTarget) script.dragTo = centerOf(params.dragTarget);
      script.ripple = "accent";
      break;
    }
    case "none":
      break;
  }
  return script;
}
