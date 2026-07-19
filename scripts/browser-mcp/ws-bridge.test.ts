import { once } from "events";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";

import { BROWSER_TOOL_CANCELED_REASON } from "./bridge";
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

  it("aborting a call sends a cancel frame and resolves with the canceled reason", async () => {
    const bridge = await WebSocketBridge.create({ port: 0 });
    const frames: Array<Record<string, unknown>> = [];
    const client = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await once(client, "open");
    client.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
    // client never replies — the extension is "busy running the mission"

    const controller = new AbortController();
    const call = bridge.call(
      { tool: "browser_run_task", args: { instruction: "x" } },
      { signal: controller.signal },
    );
    // Let the request frame reach the fake extension before aborting.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();

    const res = await call;
    expect(res).toEqual({ status: "error", reason: BROWSER_TOOL_CANCELED_REASON });

    await new Promise((r) => setTimeout(r, 50));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ request: { tool: "browser_run_task" } });
    expect(frames[1]).toEqual({ id: frames[0].id, cancel: true });

    client.close();
    await bridge.close();
  });

  it("drops a late response after an abort — the call stays canceled", async () => {
    const bridge = await WebSocketBridge.create({ port: 0 });
    let requestId = "";
    const client = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await once(client, "open");
    client.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.request) requestId = frame.id;
    });

    const controller = new AbortController();
    const call = bridge.call(
      { tool: "browser_run_task", args: { instruction: "x" } },
      { signal: controller.signal },
    );
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    expect(await call).toMatchObject({ reason: BROWSER_TOOL_CANCELED_REASON });

    // The extension's stopped-run response arrives late: unknown id, dropped.
    client.send(JSON.stringify({ id: requestId, response: { status: "error", reason: "Stopped by user" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(await call).toMatchObject({ reason: BROWSER_TOOL_CANCELED_REASON });

    client.close();
    await bridge.close();
  });

  it("an already-aborted signal resolves canceled without sending any frame", async () => {
    const bridge = await WebSocketBridge.create({ port: 0 });
    const frames: unknown[] = [];
    const client = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    await once(client, "open");
    client.on("message", (raw) => frames.push(JSON.parse(raw.toString())));

    const controller = new AbortController();
    controller.abort();
    const res = await bridge.call(
      { tool: "browser_ping", args: {} },
      { signal: controller.signal },
    );

    expect(res).toEqual({ status: "error", reason: BROWSER_TOOL_CANCELED_REASON });
    await new Promise((r) => setTimeout(r, 50));
    expect(frames).toHaveLength(0);

    client.close();
    await bridge.close();
  });

  it("a signal that never aborts round-trips normally", async () => {
    const bridge = await WebSocketBridge.create({ port: 0 });
    const client = await fakeExtension(bridge.port, (request) => ({
      status: "ok",
      result: request.tool,
    }));

    const controller = new AbortController();
    const res = await bridge.call(
      { tool: "browser_ping", args: {} },
      { signal: controller.signal },
    );
    expect(res).toEqual({ status: "ok", result: "browser_ping" });

    // Aborting after settle must be inert (listener already removed).
    controller.abort();
    client.close();
    await bridge.close();
  });
});
