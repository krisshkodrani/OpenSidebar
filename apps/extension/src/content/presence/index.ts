/**
 * LP-24 presence layer — public API for the content script.
 *
 * `initPresence()` reads the presence mode from settings and tracks changes;
 * `presenceBeforeAction()` is the single hook `executeAction` calls before
 * dispatching a tool; `presenceAfterAction()` plays the error pulse on
 * failures; suspend/resume answer the background's capture bracket.
 *
 * Everything is fail-open: any error here is swallowed and the real action
 * proceeds untouched (RFC LP-24 §2.1).
 */

import { ToolName } from "../../types";
import {
  DEFAULT_PRESENCE_MODE,
  type PresenceMode,
  type UserSettings,
} from "@shared-types/settings";
import { getTaggedElement } from "../actions/helpers";
import { buildScript, type PresenceActionKind } from "./choreography";
import { PresenceCoordinator } from "./coordinator";

let coordinator: PresenceCoordinator | null = null;

function getCoordinator(): PresenceCoordinator {
  if (!coordinator) coordinator = new PresenceCoordinator();
  return coordinator;
}

export function normalizePresenceMode(value: unknown): PresenceMode {
  return value === "off" || value === "subtle" || value === "cinematic"
    ? value
    : DEFAULT_PRESENCE_MODE;
}

/** Read the mode from userSettings and keep following changes. */
export function initPresence(): void {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.sync) return;
    const apply = (settings: Partial<UserSettings> | undefined) => {
      getCoordinator().setMode(normalizePresenceMode(settings?.presenceMode));
      setPresenceCaptureHide(settings?.presenceHideDuringCapture !== false);
    };
    void chrome.storage.sync.get("userSettings").then((result) => {
      apply(result.userSettings as Partial<UserSettings> | undefined);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.userSettings) return;
      apply(changes.userSettings.newValue as Partial<UserSettings> | undefined);
    });
  } catch {
    /* presence is optional — never let it break content-script init */
  }
}

let hideDuringCapture = true;

export function setPresenceCaptureHide(hide: boolean): void {
  hideDuringCapture = hide;
}

export function suspendPresence(): void {
  // Owner-facing knob: when capture-hiding is off, the cursor stays visible
  // in the agent's screenshots and the per-turn blink disappears entirely.
  if (!hideDuringCapture) return;
  coordinator?.suspend();
}

export function resumePresence(): void {
  coordinator?.resume();
}

/** Driven by the AGENT_ACTIVITY signal: cursor visible for the whole
 *  session, faded out when the run ends (never blinks per-action). */
export function setPresenceSessionActive(active: boolean): void {
  try {
    getCoordinator().setSessionActive(active);
  } catch {
    /* fail-open */
  }
}

/** Test seam / content-script accessor. */
export function getPresenceCoordinator(): PresenceCoordinator {
  return getCoordinator();
}

const TOOL_TO_KIND: Partial<Record<ToolName, PresenceActionKind>> = {
  [ToolName.CLICK_ELEMENT]: "click",
  [ToolName.CLICK_COORDINATES]: "click",
  [ToolName.RIGHT_CLICK]: "right_click",
  [ToolName.SET_CHECKBOX]: "checkbox",
  [ToolName.TYPE_TEXT]: "type",
  [ToolName.SELECT_OPTION]: "select",
  [ToolName.HOVER_ELEMENT]: "hover",
  [ToolName.PRESS_KEY]: "key",
  [ToolName.DRAG_AND_DROP]: "drag",
  [ToolName.SCROLL_PAGE]: "scroll",
  [ToolName.UPLOAD_FILE]: "upload",
};

function scrollDirectionOf(
  args: Record<string, unknown>,
): "up" | "down" | "left" | "right" {
  const dir = String(args.direction ?? "down").toLowerCase();
  return dir === "up" || dir === "left" || dir === "right" ? dir : "down";
}

/**
 * Pre-dispatch choreography hook. Resolves at the dispatch point; resolves
 * immediately for read-only tools, `off` mode, or on any internal error.
 */
export async function presenceBeforeAction(
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const kind = TOOL_TO_KIND[toolName];
    if (!kind) return;
    const coord = getCoordinator();
    if (coord.getMode() === "off") return;

    const target =
      "id" in args && args.id != null ? getTaggedElement(args.id) : null;
    if (kind === "drag") {
      const source = getTaggedElement(args.sourceId);
      const dropTarget = getTaggedElement(args.targetId);
      if (!source || !dropTarget) return;
      await coord.perform(
        buildScript({ kind, target: source, dragTarget: dropTarget }),
      );
      return;
    }
    const point =
      toolName === ToolName.CLICK_COORDINATES &&
      typeof args.x === "number" &&
      typeof args.y === "number"
        ? { x: args.x, y: args.y }
        : null;
    // Element-targeted actions with a stale id get no choreography — the
    // real handler will produce the grounding error untouched.
    if (!target && !point && kind !== "key" && kind !== "scroll") return;

    await coord.perform(
      buildScript({
        kind,
        target,
        point,
        optionLabel:
          kind === "select" && typeof args.value === "string"
            ? args.value
            : null,
        key: kind === "key" && typeof args.key === "string" ? args.key : null,
        scrollDirection: kind === "scroll" ? scrollDirectionOf(args) : null,
        typedTextLength:
          kind === "type" && typeof args.text === "string"
            ? args.text.length
            : undefined,
      }),
    );
  } catch {
    /* fail-open — the action dispatches regardless */
  }
}

/** Post-dispatch hook: failure feedback (RFC §5 blocked-action grammar). */
export function presenceAfterAction(
  toolName: ToolName,
  success: boolean,
): void {
  try {
    if (success || !TOOL_TO_KIND[toolName]) return;
    coordinator?.errorPulse();
  } catch {
    /* fail-open */
  }
}
