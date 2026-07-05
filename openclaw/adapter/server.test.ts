import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOpenClawAdapter } from "./server";

let base = "";
const server = createOpenClawAdapter();

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("OpenClaw adapter", () => {
  it("serves /health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns a stub plan with subtasks from /api/planner", async () => {
    const res = await fetch(`${base}/api/planner`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "buy milk" }),
    });
    const body = (await res.json()) as { content: string };
    expect(JSON.parse(body.content).subtasks).toEqual(["buy milk"]);
  });

  it("PUTs and GETs knowledge with last-writer-wins", async () => {
    // empty initially
    expect(await (await fetch(`${base}/api/knowledge/profile`)).json()).toEqual({});

    await fetch(`${base}/api/knowledge/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: { a: { value: "v1", updatedAt: 1 } } }),
    });
    // older write is ignored (LWW)
    await fetch(`${base}/api/knowledge/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: { a: { value: "stale", updatedAt: 0 } } }),
    });
    // newer write wins
    await fetch(`${base}/api/knowledge/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: { a: { value: "v2", updatedAt: 5 } } }),
    });

    const map = (await (await fetch(`${base}/api/knowledge/profile`)).json()) as Record<
      string,
      { value: unknown }
    >;
    expect(map.a.value).toBe("v2");
  });
});
