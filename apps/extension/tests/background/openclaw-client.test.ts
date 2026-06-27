import { describe, expect, test, vi } from "vitest";
import {
  HttpKnowledgeStore,
  HttpPlannerGateway,
} from "../../src/utils/openclaw-client";
import { reconcile, stamp, type SyncMap } from "../../src/utils/knowledge-sync";
import { routePlannerCompletion } from "../../src/utils/llm-routing";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  } as unknown as Response;
}

describe("HttpPlannerGateway", () => {
  test("probe sets availability from /health", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, true));
    const gw = new HttpPlannerGateway({ baseUrl: "http://127.0.0.1:9", fetchImpl });
    expect(gw.available()).toBe(false);
    expect(await gw.probe()).toBe(true);
    expect(gw.available()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:9/health",
      expect.anything(),
    );
  });

  test("probe marks unavailable when /health throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const gw = new HttpPlannerGateway({ baseUrl: "http://127.0.0.1:9", fetchImpl });
    expect(await gw.probe()).toBe(false);
    expect(gw.available()).toBe(false);
  });

  test("completePlan POSTs the query and returns the completion", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ content: "PLAN", injectedContext: "memory" }),
    );
    const gw = new HttpPlannerGateway({ baseUrl: "http://127.0.0.1:9", fetchImpl });
    const result = await gw.completePlan({ query: "do x" });
    expect(result).toEqual({ content: "PLAN", injectedContext: "memory" });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init).toMatchObject({ method: "POST" });
  });

  test("integrates with routePlannerCompletion when healthy", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: "GW-PLAN" }));
    const gw = new HttpPlannerGateway({ baseUrl: "http://127.0.0.1:9", fetchImpl });
    await gw.probe();
    const { route, result } = await routePlannerCompletion(
      gw,
      async (g) => (await (g as HttpPlannerGateway).completePlan({ query: "q" })).content,
      async () => "DIRECT",
    );
    expect(route).toBe("openclaw-gateway");
    expect(result).toBe("GW-PLAN");
  });
});

describe("HttpKnowledgeStore", () => {
  test("getAll returns the namespaced SyncMap", async () => {
    const remote: SyncMap = { a: stamp("R", 5) };
    const fetchImpl = vi.fn(async () => jsonResponse(remote));
    const store = new HttpKnowledgeStore({ baseUrl: "http://127.0.0.1:9", fetchImpl });
    expect(await store.getAll("profile")).toEqual(remote);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:9/api/knowledge/profile",
      expect.anything(),
    );
  });

  test("putItems PUTs items and throws on non-200", async () => {
    const okFetch = vi.fn(async () => jsonResponse({}, true));
    const store = new HttpKnowledgeStore({ baseUrl: "http://127.0.0.1:9", fetchImpl: okFetch });
    await store.putItems("skills", { s1: stamp("x", 1) });
    const [, init] = okFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "PUT" });

    const badFetch = vi.fn(async () => jsonResponse({}, false, 500));
    const bad = new HttpKnowledgeStore({ baseUrl: "http://127.0.0.1:9", fetchImpl: badFetch });
    await expect(bad.putItems("skills", {})).rejects.toThrow(/500/);
  });

  test("drives a reconcile round-trip against a fake daemon", async () => {
    const daemon: SyncMap = { a: stamp("remote-new", 9) };
    const fetchImpl = vi.fn(async () => jsonResponse(daemon));
    const store = new HttpKnowledgeStore({ baseUrl: "http://127.0.0.1:9", fetchImpl });
    const local: SyncMap = { a: stamp("local-old", 1), b: stamp("local-only", 2) };
    const { merged, pull, push } = reconcile(local, await store.getAll("profile"));
    expect(merged.a.value).toBe("remote-new");
    expect(pull).toEqual(["a"]);
    expect(push).toEqual(["b"]);
  });
});
