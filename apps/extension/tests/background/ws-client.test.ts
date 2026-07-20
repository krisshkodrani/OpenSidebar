import { describe, expect, test } from "vitest";
import { BrowserBridgeClient } from "../../src/background/browser-bridge/ws-client";
import type {
  AgentRunner,
  AgentRunOutcome,
} from "../../src/background/browser-bridge/handler";

/** A minimal fake WebSocket the test can drive. */
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  /** Simulate an inbound host frame. */
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent);
  }
}

function runner(outcome: AgentRunOutcome): AgentRunner {
  return { async run() { return outcome; } };
}

describe("BrowserBridgeClient", () => {
  test("dispatches a request to the handler and replies with the correlated id", async () => {
    const client = new BrowserBridgeClient({
      url: "ws://127.0.0.1:0",
      runner: runner({ status: "completed", data: { ok: true } }),
      webSocketImpl: FakeWebSocket as unknown as new (url: string) => WebSocket,
    });
    client.start();
    const ws = FakeWebSocket.last!;

    ws.emit({ id: "7", request: { tool: "browser_navigate", args: { url: "https://x.test" } } });
    await new Promise((r) => setTimeout(r, 0));

    expect(ws.sent).toHaveLength(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.id).toBe("7");
    expect(reply.response).toEqual({ status: "ok", result: { ok: true } });
  });

  test("ping replies pong without invoking the runner", async () => {
    let runCalls = 0;
    const client = new BrowserBridgeClient({
      url: "ws://127.0.0.1:0",
      runner: { async run() { runCalls += 1; return { status: "completed" }; } },
      webSocketImpl: FakeWebSocket as unknown as new (url: string) => WebSocket,
    });
    client.start();
    const ws = FakeWebSocket.last!;

    ws.emit({ id: "1", request: { tool: "browser_ping", args: {} } });
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.parse(ws.sent[0]).response).toEqual({ status: "ok", result: "pong" });
    expect(runCalls).toBe(0);
  });

  test("ignores malformed frames", async () => {
    const client = new BrowserBridgeClient({
      url: "ws://127.0.0.1:0",
      runner: runner({ status: "completed" }),
      webSocketImpl: FakeWebSocket as unknown as new (url: string) => WebSocket,
    });
    client.start();
    const ws = FakeWebSocket.last!;
    ws.emit({ noId: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.sent).toHaveLength(0);
  });

  test("a cancel frame aborts the matching in-flight run's signal", async () => {
    // The runner resolves only when its signal aborts — exactly how a real
    // stopped task eventually completes after a cancel.
    const signals: AbortSignal[] = [];
    const abortDriven: AgentRunner = {
      run(_task, opts) {
        signals.push(opts!.signal!);
        return new Promise((resolve) => {
          opts!.signal!.addEventListener("abort", () =>
            resolve({ status: "error", reason: "Stopped by user" }),
          );
        });
      },
    };
    const client = new BrowserBridgeClient({
      url: "ws://127.0.0.1:0",
      runner: abortDriven,
      webSocketImpl: FakeWebSocket as unknown as new (url: string) => WebSocket,
    });
    client.start();
    const ws = FakeWebSocket.last!;

    ws.emit({ id: "9", request: { tool: "browser_run_task", args: { instruction: "x" } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.sent).toHaveLength(0); // still running

    ws.emit({ id: "9", cancel: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(signals[0].aborted).toBe(true);
    // The run's own response frame still completes the lifecycle...
    expect(ws.sent).toHaveLength(1);
    const reply = JSON.parse(ws.sent[0]);
    expect(reply.id).toBe("9");
    expect(reply.response.status).toBe("error");
  });

  test("a cancel frame for an unknown id is ignored and gets no reply", async () => {
    const client = new BrowserBridgeClient({
      url: "ws://127.0.0.1:0",
      runner: runner({ status: "completed" }),
      webSocketImpl: FakeWebSocket as unknown as new (url: string) => WebSocket,
    });
    client.start();
    const ws = FakeWebSocket.last!;

    ws.emit({ id: "nope", cancel: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(ws.sent).toHaveLength(0);
  });

  test("the controller is cleaned up once the run settles", async () => {
    const signals: AbortSignal[] = [];
    const capturing: AgentRunner = {
      async run(_task, opts) {
        signals.push(opts!.signal!);
        return { status: "completed" };
      },
    };
    const client = new BrowserBridgeClient({
      url: "ws://127.0.0.1:0",
      runner: capturing,
      webSocketImpl: FakeWebSocket as unknown as new (url: string) => WebSocket,
    });
    client.start();
    const ws = FakeWebSocket.last!;

    ws.emit({ id: "5", request: { tool: "browser_run_task", args: { instruction: "x" } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.sent).toHaveLength(1);

    // A late cancel must find nothing to abort.
    ws.emit({ id: "5", cancel: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(signals[0].aborted).toBe(false);
    expect(ws.sent).toHaveLength(1);
  });
});
