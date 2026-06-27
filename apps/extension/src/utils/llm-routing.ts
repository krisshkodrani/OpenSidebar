/**
 * Hybrid LLM routing (RFC LP-8, M4 "Hybrid Mind").
 *
 * Locked decision: the executor (the page-level hot loop) always calls the
 * provider directly — no network hop on the latency-critical path. The planner
 * (strategic) prefers OpenClaw's gateway, which injects cross-session memory and
 * site skills, and falls back to a direct provider call when the daemon is
 * absent or the gateway errors — preserving standalone operation.
 *
 * This module is the pure routing decision + the gateway contract + a
 * graceful-fallback runner. The live wiring into the planner pool
 * (`llm/client.ts` / `TaskPlanner`) is Stage 2 and needs the daemon.
 */

export type LlmTier = "executor" | "planner";
export type LlmRoute = "direct" | "openclaw-gateway";

export interface RoutingContext {
  tier: LlmTier;
  gatewayAvailable: boolean;
}

/** Decide where a call goes. Executor is always direct; planner prefers the gateway. */
export function resolveLlmRoute(ctx: RoutingContext): LlmRoute {
  if (ctx.tier === "executor") return "direct";
  return ctx.gatewayAvailable ? "openclaw-gateway" : "direct";
}

/**
 * OpenClaw planner gateway (implemented in Stage 2 over the M2 bridge / a local
 * OpenClaw HTTP endpoint). `available()` lets the router skip it cheaply when the
 * daemon is down.
 */
export interface PlannerGateway {
  available(): boolean;
}

/**
 * Run a planner completion with the hybrid policy: prefer the gateway when
 * present, but fall back to the direct provider call when the gateway is absent
 * OR throws. Returns which route actually served, so callers can trace it.
 */
export async function routePlannerCompletion<T>(
  gateway: PlannerGateway | null,
  viaGateway: (gateway: PlannerGateway) => Promise<T>,
  direct: () => Promise<T>,
): Promise<{ route: LlmRoute; result: T }> {
  if (gateway && gateway.available()) {
    try {
      return { route: "openclaw-gateway", result: await viaGateway(gateway) };
    } catch {
      // Gateway failed mid-call — degrade to direct rather than failing the task.
    }
  }
  return { route: "direct", result: await direct() };
}
