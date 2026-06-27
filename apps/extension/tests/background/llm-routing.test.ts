import { describe, expect, test, vi } from "vitest";
import {
  resolveLlmRoute,
  routePlannerCompletion,
  type PlannerGateway,
} from "../../src/utils/llm-routing";

describe("resolveLlmRoute", () => {
  test("executor always goes direct, regardless of gateway", () => {
    expect(resolveLlmRoute({ tier: "executor", gatewayAvailable: true })).toBe("direct");
    expect(resolveLlmRoute({ tier: "executor", gatewayAvailable: false })).toBe("direct");
  });

  test("planner uses the gateway when available", () => {
    expect(resolveLlmRoute({ tier: "planner", gatewayAvailable: true })).toBe(
      "openclaw-gateway",
    );
  });

  test("planner falls back to direct when the gateway is absent", () => {
    expect(resolveLlmRoute({ tier: "planner", gatewayAvailable: false })).toBe("direct");
  });
});

const gateway = (available: boolean): PlannerGateway => ({ available: () => available });

describe("routePlannerCompletion", () => {
  test("uses the gateway when present and healthy", async () => {
    const direct = vi.fn(async () => "direct");
    const { route, result } = await routePlannerCompletion(
      gateway(true),
      async () => "gateway",
      direct,
    );
    expect(route).toBe("openclaw-gateway");
    expect(result).toBe("gateway");
    expect(direct).not.toHaveBeenCalled();
  });

  test("falls back to direct when the gateway is null", async () => {
    const { route, result } = await routePlannerCompletion(
      null,
      async () => "gateway",
      async () => "direct",
    );
    expect(route).toBe("direct");
    expect(result).toBe("direct");
  });

  test("falls back to direct when the gateway throws mid-call", async () => {
    const { route, result } = await routePlannerCompletion(
      gateway(true),
      async () => {
        throw new Error("gateway down");
      },
      async () => "direct",
    );
    expect(route).toBe("direct");
    expect(result).toBe("direct");
  });

  test("skips the gateway when it reports unavailable", async () => {
    const viaGateway = vi.fn(async () => "gateway");
    const { route } = await routePlannerCompletion(
      gateway(false),
      viaGateway,
      async () => "direct",
    );
    expect(route).toBe("direct");
    expect(viaGateway).not.toHaveBeenCalled();
  });
});
