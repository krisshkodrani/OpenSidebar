/**
 * Actions - Tool execution in the page context
 *
 * Implements all DOM-manipulating tools:
 * - click_element, type_text, scroll_page
 * - hover_element, find_element, select_option
 * - press_key, drag_and_drop
 * - hide_element
 *
 * Each function receives arguments from the tool call and performs
 * the corresponding DOM action on the tagged element.
 */

import { presenceAfterAction, presenceBeforeAction } from "../presence";
import {
  ToolName,
  MessageSource,
  type RuntimeMessage,
  ClickElementArgs,
  ClickCoordinatesArgs,
  TypeTextArgs,
  ScrollPageArgs,
  SelectOptionArgs,
  PressKeyArgs,
  DragAndDropArgs,
  HideElementArgs,
  ReadElementArgs,
  ExtractFormStateArgs,
  RightClickArgs,
  SetCheckboxArgs,
} from "../../types";
import { getTaggedElement } from "./helpers";
import {
  executeClick,
  executeType,
  executeHover,
  executeSelectOption,
  executePressKey,
  executeDragAndDrop,
  executeRightClick,
  executeSetCheckbox,
  executeClickCoordinates,
} from "./interaction";
import {
  executeScroll,
  executeRead,
  executeFindElement,
  executeReadElement,
  executeExtractFormState,
} from "./inspection";
import { executeHideElement, executeUploadFile } from "./page-manipulation";

// Re-export all submodules for barrel compatibility
export * from "./helpers";
export * from "./interaction";
export * from "./inspection";
export * from "./page-manipulation";

export async function executeAction(
  toolName: ToolName,
  args: Record<string, unknown>,
  toolCallId = `content:${crypto.randomUUID()}`,
): Promise<{ success: boolean; result: string; navigated: boolean }> {
  const presentation = createActionPresentation(toolName, args, toolCallId);
  presentation?.emit("acquiring");
  let actingEmitted = false;
  const emitActing = () => {
    if (actingEmitted) return;
    actingEmitted = true;
    presentation?.emit("acting");
  };
  // LP-24 presence layer: pre-dispatch choreography (fail-open, presentation
  // only — resolves immediately for read tools and `off` mode).
  await presenceBeforeAction(toolName, args, emitActing);
  emitActing();
  try {
    const outcome = await executeActionInner(toolName, args);
    presenceAfterAction(toolName, outcome.success);
    presentation?.emit(outcome.success ? "applied" : "failed");
    return outcome;
  } catch (error) {
    presenceAfterAction(toolName, false);
    presentation?.emit("failed");
    throw error;
  }
}

const PRESENTED_TOOLS = new Set<ToolName>([
  ToolName.CLICK_ELEMENT,
  ToolName.CLICK_COORDINATES,
  ToolName.RIGHT_CLICK,
  ToolName.SET_CHECKBOX,
  ToolName.TYPE_TEXT,
  ToolName.SELECT_OPTION,
  ToolName.HOVER_ELEMENT,
  ToolName.PRESS_KEY,
  ToolName.DRAG_AND_DROP,
  ToolName.SCROLL_PAGE,
  ToolName.UPLOAD_FILE,
]);

let actionPresentationSequence = Date.now() * 1000;

function safeTargetLabel(args: Record<string, unknown>): string | null {
  if (args.id == null) return null;
  const target = getTaggedElement(args.id);
  if (!target) return null;
  const raw =
    target.getAttribute("aria-label") ??
    target.getAttribute("title") ??
    target.closest("label")?.textContent ??
    target.textContent;
  const label = raw?.replace(/\s+/g, " ").trim().slice(0, 60);
  return label || null;
}

function actionLabel(
  toolName: ToolName,
  args: Record<string, unknown>,
): string {
  const target = safeTargetLabel(args);
  switch (toolName) {
    case ToolName.TYPE_TEXT:
      return target ? `Entering text in ${target}` : "Entering text";
    case ToolName.SELECT_OPTION:
      return target ? `Selecting ${target}` : "Selecting an option";
    case ToolName.SET_CHECKBOX:
      return target ? `Updating ${target}` : "Updating a choice";
    case ToolName.HOVER_ELEMENT:
      return target ? `Inspecting ${target}` : "Inspecting an element";
    case ToolName.PRESS_KEY:
      return "Using the keyboard";
    case ToolName.DRAG_AND_DROP:
      return "Moving an item";
    case ToolName.SCROLL_PAGE:
      return "Scrolling the page";
    case ToolName.UPLOAD_FILE:
      return target ? `Attaching a file to ${target}` : "Attaching a file";
    case ToolName.RIGHT_CLICK:
      return target
        ? `Opening options for ${target}`
        : "Opening context options";
    default:
      return target ? `Opening ${target}` : "Acting on the page";
  }
}

function createActionPresentation(
  toolName: ToolName,
  args: Record<string, unknown>,
  toolCallId: string,
) {
  if (!PRESENTED_TOOLS.has(toolName)) return null;
  const sequence = ++actionPresentationSequence;
  const label = actionLabel(toolName, args);
  return {
    emit(
      phase: "acquiring" | "acting" | "applied" | "failed" | "interrupted",
      error?: string,
    ) {
      try {
        void chrome.runtime
          .sendMessage({
            type: "ACTION_PRESENTATION",
            requestId: crypto.randomUUID(),
            source: MessageSource.CONTENT,
            payload: {
              toolCallId,
              sequence,
              phase,
              label,
              toolName,
              ...(error ? { error: error.slice(0, 160) } : {}),
            },
          } satisfies RuntimeMessage)
          .catch(() => undefined);
      } catch {
        // Presentation telemetry must never affect the real action.
      }
    },
  };
}

async function executeActionInner(
  toolName: ToolName,
  args: Record<string, unknown>,
): Promise<{ success: boolean; result: string; navigated: boolean }> {
  switch (toolName) {
    case ToolName.CLICK_ELEMENT:
      return executeClick(args as unknown as ClickElementArgs);
    case ToolName.TYPE_TEXT:
      return executeType(args as unknown as TypeTextArgs);
    case ToolName.SCROLL_PAGE:
      return executeScroll(args as unknown as ScrollPageArgs);
    case ToolName.READ_PAGE:
      return executeRead();
    case ToolName.HOVER_ELEMENT:
      return executeHover(args as unknown as { id: number });
    case ToolName.FIND_ELEMENT:
      return executeFindElement(args as unknown as { text: string });
    case ToolName.SELECT_OPTION:
      return executeSelectOption(args as unknown as SelectOptionArgs);
    case ToolName.PRESS_KEY:
      return executePressKey(args as unknown as PressKeyArgs);
    case ToolName.DRAG_AND_DROP:
      return executeDragAndDrop(args as unknown as DragAndDropArgs);
    case ToolName.HIDE_ELEMENT:
      return executeHideElement(args as unknown as HideElementArgs);
    case ToolName.READ_ELEMENT:
      return executeReadElement(args as unknown as ReadElementArgs);
    case ToolName.EXTRACT_FORM_STATE:
      return executeExtractFormState(args as unknown as ExtractFormStateArgs);
    case ToolName.RIGHT_CLICK:
      return executeRightClick(args as unknown as RightClickArgs);
    case ToolName.SET_CHECKBOX:
      return executeSetCheckbox(args as unknown as SetCheckboxArgs);
    case ToolName.CLICK_COORDINATES:
      return executeClickCoordinates(args as unknown as ClickCoordinatesArgs);
    case ToolName.UPLOAD_FILE:
      return executeUploadFile(args as Record<string, unknown>);
    default:
      return {
        success: false,
        result: `Unknown tool: ${toolName}`,
        navigated: false,
      };
  }
}
