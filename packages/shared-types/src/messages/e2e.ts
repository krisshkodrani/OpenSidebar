/**
 * OpenSidebar — test-only message hooks. These exist for the E2E harness and
 * are never sent in production.
 */

import type { ToolName } from "../enums";
import type { BaseMessage } from "./base";

/** Test-only hook to seed a durable pending interaction without invoking the planner/executor. */
export interface E2ESeedPendingInteractionMessage extends BaseMessage {
  type: "E2E_SEED_PENDING_INTERACTION";
  source: string;
  payload: {
    tabId: number;
    workspaceId: string;
    interaction:
      | {
          kind: "approval";
          toolName: ToolName;
          args?: Record<string, unknown>;
          context: string;
        }
      | {
          kind: "clarification";
          question: string;
          suggestions?: string[];
        };
  };
}

/** Test-only observer update for the page-contained visible E2E rail. */
export interface E2ERailUpdateMessage extends BaseMessage {
  type: "E2E_RAIL_UPDATE";
  source: string;
  payload: {
    prompt?: string;
    status?: string;
    detail?: string;
    planItems?: string[];
    feed?: Array<{
      id: string;
      kind: "status" | "step" | "plan" | "completion";
      text: string;
      timestamp: number;
    }>;
    finalText?: string;
    outcome?: "completed" | "failed" | "stopped" | "";
  };
}

/** Test-only harness messages (never sent in production). */
export type E2eHookMessage =
  | E2ESeedPendingInteractionMessage
  | E2ERailUpdateMessage;
