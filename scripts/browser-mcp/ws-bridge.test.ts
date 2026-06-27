import { once } from "events";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { dispatch } from "./server";
import { WebSocketBridge } from "./ws-bridge";

/** Connect a fake "extension" client that replies to bridge requests. */
async function fakeExtension(
  port: number,
  reply: (request: { tool: string; args: Record<string, unknown> }) => unknown,
): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(client, "open");
  client.on("message", (raw) => {
    const { id, request } = JSON.parse(raw.toString());
    client.send(JSON.stringify({ id, response: reply(request) }));
  });
  return client;
}

describe("WebSocketBridge", () => {
  it("round-trips a tool call to the connected extension client", async () => {
    const bridge = await WebSocketBridge.create({ port: 0 });
    const client = await fakeExtension(bridge.port, (request) => ({
      status: "ok",
      result: request.tool,
    }));

    const res = await bridge.call({ tool: "browser_ping", args: {} });
    expect(res).toEqual({ status: "ok", result: "browser_ping" });

    client.close();
    await bridge.close();
  });

  it("passes needs_human through end-to-end via dispatch", async () => {
    const bridge = await WebSocketBridge.create({ port: 0 });
    const client = await fakeExtension(bridge.port, () => ({
      status: "needs_human",
      reason: "captcha",
    }));

    const res = await dispatch(bridge, "browser_apply_to_job", {
      url: "https://jobs.test/1",
    });
    expect(res).toEqual({ status: "needs_human", reason: "captcha" });

    client.close();
    await bridge.close();
  });

  it("returns a structured error when no extension is connected", async () => {
    const bridge = await WebSocketBridge.create({ port: 0 });
    const res = await bridge.call({ tool: "browser_ping", args: {} });
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/not connected/i);
    await bridge.close();
  });

  it("times out a non-responsive extension", async () => {
    const bridge = await WebSocketBridge.create({ port: 0, timeoutMs: 50 });
    const client = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await once(client, "open");
    // client never replies
    const res = await bridge.call({ tool: "browser_ping", args: {} });
    expect(res.status).toBe("error");
    expect(res.reason).toMatch(/timed out/i);
    client.close();
    await bridge.close();
  });
});
