/**
 * OpenSidebar — shared base shape for every RuntimeMessage variant.
 */

import type { MessageSource } from "../enums";

export type UiMessageSource = MessageSource.SIDEPANEL | MessageSource.UI;

/** Base shape shared by every runtime message */
export interface BaseMessage {
  /** Unique request ID for correlating async responses */
  requestId: string;
  /** Where this message originated */
  source: MessageSource | string;
  /** Workspace this message belongs to (null = global / unscoped) */
  workspaceId?: string | null;
}
