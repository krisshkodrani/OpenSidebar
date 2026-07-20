/**
 * OpenSidebar — user-decision request/response pairs (background ↔ side
 * panel): tool approvals, orchestrator escalations, plan confirmations, and
 * mid-run clarifications.
 */

import type { MessageSource, RiskLevel, ToolName } from "../enums";
import type { BaseMessage, UiMessageSource } from "./base";

/** Background requests user approval before executing a high-risk tool */
export interface ApprovalRequestMessage extends BaseMessage {
  type: "APPROVAL_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    approvalId: string;
    toolName: ToolName;
    args: Record<string, unknown>;
    risk: RiskLevel.HIGH;
    context: string;
    timeoutMs: number;
  };
}

/** Side panel responds to a pending approval request */
export interface ApprovalResponseMessage extends BaseMessage {
  type: "APPROVAL_RESPONSE";
  source: UiMessageSource;
  payload: {
    approvalId: string;
    approved: boolean;
  };
}

export type EscalationRisk = "medium" | "high" | "critical";

export type EscalationOptionId =
  | "approve_continue"
  | "reroute_with_option"
  | "skip_node"
  | "stop_task";

export interface EscalationOption {
  id: EscalationOptionId;
  label: string;
  impact: string;
  rerouteObjective?: string;
}

export interface EscalationPacket {
  escalationId: string;
  taskId: string;
  workspaceId: string;
  nodeId: string;
  risk: EscalationRisk;
  confidence: number;
  reason: string;
  options: EscalationOption[];
  recommendedOption: EscalationOptionId;
  snapshotSummary: string;
  lastActions: string[];
  budgetState: {
    elapsedMs: number;
    maxSessionTimeMs: number;
    totalTokens: number;
    maxTotalTokens: number;
    totalCostUsd: number;
    maxTotalCostUsd: number;
  };
  timeoutMs: number;
  timestamp: number;
}

export interface EscalationRequestMessage extends BaseMessage {
  type: "ESCALATION_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: EscalationPacket;
}

export interface EscalationDecisionMessage extends BaseMessage {
  type: "ESCALATION_DECISION";
  source: UiMessageSource;
  payload: {
    escalationId: string;
    optionId: EscalationOptionId;
    rerouteObjective?: string;
  };
}

/** Background sends a plan to the side panel for user review before execution */
export interface PlanConfirmationRequestMessage extends BaseMessage {
  type: "PLAN_CONFIRMATION_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    confirmationId: string;
    nodes: { description: string; successCriteria: string; selectedSkillId?: string }[];
    difficulty?: string;
    query: string;
  };
}

/** Side panel responds to a pending plan confirmation */
export interface PlanConfirmationResponseMessage extends BaseMessage {
  type: "PLAN_CONFIRMATION_RESPONSE";
  source: UiMessageSource;
  payload: {
    confirmationId: string;
    decision: "approve" | "cancel";
    feedback?: string;
  };
}

/** Background asks the user a clarifying question mid-execution */
export interface ClarificationRequestMessage extends BaseMessage {
  type: "CLARIFICATION_REQUEST";
  source: MessageSource.BACKGROUND;
  payload: {
    clarificationId: string;
    question: string;
    suggestions?: string[];
    timeoutMs: number;
  };
}

/** Side panel responds to a pending clarification request */
export interface ClarificationResponseMessage extends BaseMessage {
  type: "CLARIFICATION_RESPONSE";
  source: UiMessageSource;
  payload: {
    clarificationId: string;
    answer: string;
  };
}

/** Approval, escalation, plan-confirmation, and clarification messages. */
export type InteractionMessage =
  | ApprovalRequestMessage
  | ApprovalResponseMessage
  | EscalationRequestMessage
  | EscalationDecisionMessage
  | PlanConfirmationRequestMessage
  | PlanConfirmationResponseMessage
  | ClarificationRequestMessage
  | ClarificationResponseMessage;
