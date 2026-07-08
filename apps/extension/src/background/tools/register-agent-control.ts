/**
 * Agent-control tool registrations (RFC LP-16 Phase 4). Fallback executors for
 * escalate/clarify/compose_text — the agent loop intercepts these before the
 * executor runs, so these registrations only supply schema + a no-op result.
 * Verbatim movement from tools/index.ts.
 */
import { ToolName } from "../../types";
import { ToolRegistry } from "./registry";
import { ESCALATE_DEF, CLARIFY_DEF, COMPOSE_TEXT_DEF } from "./definitions";

export function registerAgentControlTools(toolRegistry: ToolRegistry): void {
    toolRegistry.register(ToolName.ESCALATE, ESCALATE_DEF, async (args) => {
      // This executor is a fallback — the loop intercepts escalate before reaching here
      return `Escalation requested: ${(args.reason as string) || "no reason given"}`;
    });
  
    toolRegistry.register(ToolName.CLARIFY, CLARIFY_DEF, async (args) => {
      // This executor is a fallback — the loop intercepts clarify before reaching here
      return `Clarification requested: ${(args.question as string) || "no question given"}`;
    });
  
    toolRegistry.register(ToolName.COMPOSE_TEXT, COMPOSE_TEXT_DEF, async (args) => {
      // This executor is a fallback — the loop intercepts compose_text (writer handoff) before reaching here
      return `Compose requested for field ${(args.id as number) ?? "?"}.`;
    });
}
