/**
 * Host-side checks for the pi extension (.pi/extensions/opensidebar.ts).
 *
 * No pi runtime and no Chrome: the factory is called with a fake ExtensionAPI
 * that records registrations. Guards the two contracts that matter:
 *   1. Every BROWSER_TOOLS entry is registered VERBATIM — same name, same
 *      description, and the SAME schema object (tools.ts stays the single
 *      source of truth; a copy or hand-port would drift).
 *   2. execute() with no connected extension returns a structured "not
 *      connected" response instead of hanging or throwing.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import type { BrowserToolRequest, BrowserToolResponse } from "./bridge";
import { BROWSER_TOOLS } from "./tools";
import { WebSocketBridge } from "./ws-bridge";

// Ephemeral port so this never collides with a real bridge on 8787.
process.env.OPENSIDEBAR_WS_PORT = "0";
process.env.BROWSER_MCP_AUTH_TOKEN =
  "test-browser-bridge-token-32-bytes-minimum";

type Registered = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (
    id: string,
    params: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
};

const registered: Registered[] = [];
const fakePi = {
  registerTool(tool: Registered) {
    registered.push(tool);
  },
};

describe("pi extension registration", () => {
  beforeAll(async () => {
    const { default: factory } = await import(
      "../../.pi/extensions/opensidebar"
    );
    factory(fakePi as never);
  });

  afterAll(async () => {
    // The bridge singleton starts lazily on first execute(); close it so
    // vitest exits cleanly.
    const mod = await import("../../.pi/extensions/opensidebar");
    void mod; // module has no export for the bridge; the server dies with the process
  });

  test("registers every browser tool with its schema passed through verbatim", () => {
    expect(registered.map((t) => t.name).sort()).toEqual(
      BROWSER_TOOLS.map((t) => t.name).sort(),
    );
    for (const tool of BROWSER_TOOLS) {
      const reg = registered.find((t) => t.name === tool.name)!;
      expect(reg.description).toBe(tool.description);
      // Identity, not deep-equal: the schema must BE tools.ts's object.
      expect(reg.parameters).toBe(tool.inputSchema);
    }
  });

  test("execute without a connected extension returns a structured error", async () => {
    const ping = registered.find((t) => t.name === "browser_ping")!;
    const result = await ping.execute("call-1", {});
    const payload = JSON.parse(result.content[0].text) as {
      status: string;
      reason?: string;
    };
    expect(payload.status).toBe("error");
    expect(payload.reason).toContain("not connected");
  }, 15_000);

  test("an already-aborted signal short-circuits before dispatch", async () => {
    const ping = registered.find((t) => t.name === "browser_ping")!;
    const controller = new AbortController();
    controller.abort();
    await expect(
      ping.execute("call-2", {}, controller.signal),
    ).rejects.toThrow(/aborted before dispatch/);
  });

  test("every call carries the same process-level session id", async () => {
    const requests: BrowserToolRequest[] = [];
    const spy = vi
      .spyOn(WebSocketBridge.prototype, "call")
      .mockImplementation(async (request) => {
        requests.push(request);
        return { status: "ok", result: null };
      });
    try {
      const ping = registered.find((t) => t.name === "browser_ping")!;
      const run = registered.find((t) => t.name === "browser_run_task")!;
      await ping.execute("call-3", {});
      await run.execute("call-4", { instruction: "x" });

      expect(requests).toHaveLength(2);
      expect(requests[0].session).toMatch(/^pi-/);
      expect(requests[1].session).toBe(requests[0].session);
      // The session is transport metadata — it must never leak into a schema.
      for (const tool of BROWSER_TOOLS) {
        expect(JSON.stringify(tool.inputSchema)).not.toContain("session");
      }
    } finally {
      spy.mockRestore();
    }
  });

  test("aborting mid-call rejects with '<tool> aborted'", async () => {
    const spy = vi
      .spyOn(WebSocketBridge.prototype, "call")
      .mockImplementation(
        (_request, opts?: { signal?: AbortSignal }) =>
          new Promise<BrowserToolResponse>((resolve) => {
            // Resolve only on abort — mirrors the host's local resolution.
            const canceled = () =>
              resolve({ status: "error", reason: "canceled by caller" });
            if (opts?.signal?.aborted) canceled();
            else opts?.signal?.addEventListener("abort", canceled);
          }),
      );
    try {
      const run = registered.find((t) => t.name === "browser_run_task")!;
      const controller = new AbortController();
      const pending = run.execute("call-5", { instruction: "x" }, controller.signal);
      controller.abort();
      await expect(pending).rejects.toThrow(/browser_run_task aborted/);
    } finally {
      spy.mockRestore();
    }
  });
});
