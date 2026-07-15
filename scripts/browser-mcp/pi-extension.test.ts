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

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { BROWSER_TOOLS } from "./tools";

// Ephemeral port so this never collides with a real bridge on 8787.
process.env.OPENSIDEBAR_WS_PORT = "0";

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
});
