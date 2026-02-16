import { RiskLevel, ToolName } from "../../types";
import { logger } from "../../utils";
import { classifyRisk } from "../security";
import {
  ApprovalPolicyMode,
  resolveApprovalPolicy,
} from "./approval-policy";

export interface PreToolDecision {
  toolName: ToolName;
  riskLevel: RiskLevel;
  allowed: boolean;
  requiresApproval: boolean;
  approvalMode: ApprovalPolicyMode;
  approvalReason: string;
  denyReason?: string;
}

export interface PostToolDecision {
  toolName: ToolName;
  ok: boolean;
  retryable: boolean;
  reason?: string;
}

interface MiddlewareOptions {
  disabledTools: Set<ToolName>;
  bypassApprovals: boolean;
  workspaceId: string | null;
  workerId: string | null;
  maxSessionMs: number;
}

const RETRYABLE_ERROR_MARKERS = [
  "timeout",
  "intercepted",
  "stale",
  "temporarily unavailable",
  "network",
];

export class AgentMiddleware {
  constructor(private readonly options: MiddlewareOptions) {}

  evaluatePreTool(
    toolName: ToolName,
    args: Record<string, unknown>,
    turn: number,
  ): PreToolDecision {
    const riskLevel = classifyRisk(toolName, args);
    const approvalPolicy = resolveApprovalPolicy(
      riskLevel,
      this.options.bypassApprovals,
    );

    if (this.options.disabledTools.has(toolName)) {
      const denyReason = `Tool ${toolName} is disabled by current policy.`;
      logger.warn("policy", "Tool blocked by middleware", {
        turn,
        toolName,
        riskLevel,
        workspaceId: this.options.workspaceId,
        workerId: this.options.workerId,
        denyReason,
      });
      return {
        toolName,
        riskLevel,
        allowed: false,
        requiresApproval: false,
        approvalMode: approvalPolicy.mode,
        approvalReason: approvalPolicy.reason,
        denyReason,
      };
    }

    logger.debug("policy", "Pre-tool decision", {
      turn,
      toolName,
      riskLevel,
      requiresApproval: approvalPolicy.requiresApproval,
      approvalMode: approvalPolicy.mode,
      approvalReason: approvalPolicy.reason,
      bypassApprovals: this.options.bypassApprovals,
      workspaceId: this.options.workspaceId,
      workerId: this.options.workerId,
    });

    return {
      toolName,
      riskLevel,
      allowed: true,
      requiresApproval: approvalPolicy.requiresApproval,
      approvalMode: approvalPolicy.mode,
      approvalReason: approvalPolicy.reason,
    };
  }

  evaluatePostTool(
    toolName: ToolName,
    result: string | null,
    error: string | null,
    durationMs: number,
    turn: number,
  ): PostToolDecision {
    if (!error) {
      logger.debug("policy", "Post-tool decision", {
        turn,
        toolName,
        ok: true,
        retryable: false,
        durationMs,
        resultSnippet: (result || "").slice(0, 140),
      });
      return {
        toolName,
        ok: true,
        retryable: false,
      };
    }

    const lower = error.toLowerCase();
    const retryable = RETRYABLE_ERROR_MARKERS.some((marker) =>
      lower.includes(marker),
    );
    logger.warn("policy", "Post-tool decision", {
      turn,
      toolName,
      ok: false,
      retryable,
      durationMs,
      errorSnippet: error.slice(0, 180),
    });
    return {
      toolName,
      ok: false,
      retryable,
      reason: retryable ? "Transient tool failure." : "Non-retryable tool failure.",
    };
  }

  shouldHaltTurn(turn: number, maxTurns: number, sessionStartTs: number): boolean {
    if (turn >= maxTurns) return true;
    const sessionMs = Date.now() - sessionStartTs;
    if (sessionMs > this.options.maxSessionMs) {
      logger.warn("policy", "Turn halted by session budget", {
        turn,
        sessionMs,
        maxSessionMs: this.options.maxSessionMs,
        workspaceId: this.options.workspaceId,
        workerId: this.options.workerId,
      });
      return true;
    }
    return false;
  }
}
