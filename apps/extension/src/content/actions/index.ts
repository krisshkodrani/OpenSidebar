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

import {
  ToolName,
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
