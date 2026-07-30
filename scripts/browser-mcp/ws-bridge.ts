/**
 * Host-side WebSocket transport for the browser MCP host (RFC LP-8, M2 Stage 2b).
 *
 * Runs a loopback WebSocket server; the OpenSidebar extension service worker
 * connects as a client (browser-native `WebSocket`, no dependency). Each thick
 * tool call is sent with a correlation id and awaits the matching response, so
 * `WebSocketBridge` satisfies the `BrowserBridge` contract over the wire.
 *
 * The listener is loopback-only and mutually authenticates the extension with
 * a fresh nonce exchange before accepting request or response frames.
 *
 * Wire frames (JSON):
 *   host → ext:  { id, request: BrowserToolRequest }
 *   host → ext:  { id, cancel: true }   — caller aborted; stop the run. The host
 *                 resolves the call locally, so the extension's late response
 *                 lands on an unknown id and is dropped.
 *   ext → host:  { id, response: BrowserToolResponse }
 */

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

import {
  BROWSER_TOOL_CANCELED_REASON,
  type BrowserBridge,
  type BrowserToolCallOptions,
  type BrowserToolRequest,
  type BrowserToolResponse,
} from "./bridge.js";

interface Pending {
  /** Resolves the call exactly once and releases every resource it holds. */
  settle: (r: BrowserToolResponse) => void;
}

export interface WebSocketBridgeOptions {
  /** 0 picks an ephemeral port (useful in tests). */
  port?: number;
  host?: string;
  timeoutMs?: number;
  /**
   * Shared secret paired with the extension. Production callers must provide
   * at least 32 characters; tests may explicitly opt into a shorter token.
   */
  authToken?: string;
  allowInsecureTestToken?: boolean;
}

export class WebSocketBridge implements BrowserBridge {
  private readonly wss: WebSocketServer;
  private client: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private readonly timeoutMs: number;
  private readonly authToken: string;
  /** Resolves once the server is listening (so `port` is known). */
  readonly listening: Promise<void>;

  constructor(opts: WebSocketBridgeOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.authToken = opts.authToken ?? "";
    if (
      !this.authToken ||
      (!opts.allowInsecureTestToken && this.authToken.length < 32)
    ) {
      throw new Error(
        "BROWSER_MCP_AUTH_TOKEN must be configured with at least 32 characters.",
      );
    }
    const host = opts.host ?? "127.0.0.1";
    if (!["127.0.0.1", "::1", "localhost"].includes(host.toLowerCase())) {
      throw new Error("Browser MCP WebSocket must bind to a loopback host.");
    }
    this.wss = new WebSocketServer({
      port: opts.port ?? 8787,
      host,
    });
    this.listening = new Promise((resolve) =>
      this.wss.once("listening", () => {
        // Do not let the bridge server keep its host process alive: inside a
        // pi extension, a referenced server means `pi -p` NEVER exits after
        // answering (found live 2026-07-16). The MCP host and tests stay
        // alive via their own transports/handles. `_server` is ws's internal
        // http server — no public accessor exists.
        (this.wss as unknown as { _server?: { unref?: () => void } })._server?.unref?.();
        resolve();
      }),
    );
    this.wss.on("connection", (socket: WebSocket) => {
      let clientNonce = "";
      let serverNonce = "";
      let authenticated = false;
      const authTimer = setTimeout(() => socket.close(4001, "authentication timeout"), 5000);
      socket.on("message", (data) => {
        const raw = data.toString();
        if (authenticated) {
          this.onMessage(raw);
          return;
        }
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          socket.close(4001, "authentication required");
          return;
        }
        if (
          frame.type === "auth_hello" &&
          typeof frame.clientNonce === "string" &&
          /^[A-Za-z0-9_-]{32,}$/.test(frame.clientNonce)
        ) {
          clientNonce = frame.clientNonce;
          serverNonce = randomBytes(32).toString("base64url");
          socket.send(
            JSON.stringify({
              type: "auth_challenge",
              serverNonce,
              proof: this.sign(`server:${clientNonce}:${serverNonce}`),
            }),
          );
          return;
        }
        if (
          frame.type === "auth_response" &&
          clientNonce &&
          serverNonce &&
          typeof frame.proof === "string" &&
          this.verify(
            String(frame.proof),
            `client:${clientNonce}:${serverNonce}`,
          )
        ) {
          authenticated = true;
          clearTimeout(authTimer);
          // Only an authenticated extension may supersede the active client.
          this.client?.close(4000, "superseded by authenticated extension");
          this.client = socket;
          socket.send(JSON.stringify({ type: "auth_ok" }));
          return;
        }
        socket.close(4001, "authentication failed");
      });
      socket.on("close", () => {
        clearTimeout(authTimer);
        if (this.client === socket) this.client = null;
      });
    });
  }

  static async create(opts: WebSocketBridgeOptions = {}): Promise<WebSocketBridge> {
    const bridge = new WebSocketBridge(opts);
    await bridge.listening;
    return bridge;
  }

  get port(): number {
    const addr = this.wss.address();
    return typeof addr === "object" && addr ? addr.port : 0;
  }

  get connected(): boolean {
    return this.client !== null && this.client.readyState === this.client.OPEN;
  }

  private sign(value: string): string {
    return createHmac("sha256", this.authToken).update(value).digest("base64url");
  }

  private verify(proof: string, value: string): boolean {
    const expected = Buffer.from(this.sign(value));
    const actual = Buffer.from(proof);
    return (
      expected.length === actual.length &&
      timingSafeEqual(expected, actual)
    );
  }

  private onMessage(raw: string): void {
    let msg: { id?: string; response?: BrowserToolResponse };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg.id) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    pending.settle(msg.response ?? { status: "error", reason: "malformed response" });
  }

  async call(
    request: BrowserToolRequest,
    opts: BrowserToolCallOptions = {},
  ): Promise<BrowserToolResponse> {
    const { signal } = opts;
    if (signal?.aborted) {
      return { status: "error", reason: BROWSER_TOOL_CANCELED_REASON };
    }
    if (!this.connected || !this.client) {
      return { status: "error", reason: "OpenSidebar extension is not connected." };
    }
    const id = `${++this.seq}`;
    const client = this.client;
    return new Promise<BrowserToolResponse>((resolve) => {
      let settled = false;
      const settle = (response: BrowserToolResponse) => {
        if (settled) return;
        settled = true;
        this.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(response);
      };
      const onAbort = () => {
        // Tell the extension to stop the run, then resolve locally — the
        // caller aborted and must not wait for the stop to drain.
        try {
          client.send(JSON.stringify({ id, cancel: true }));
        } catch {
          // Socket already gone; local resolution is all that is left.
        }
        settle({ status: "error", reason: BROWSER_TOOL_CANCELED_REASON });
      };
      const timer = setTimeout(() => {
        settle({ status: "error", reason: "browser tool call timed out" });
      }, this.timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, { settle });
      client.send(JSON.stringify({ id, request }));
    });
  }

  async close(): Promise<void> {
    // Settle rather than strand: outstanding callers get a terminal response
    // instead of a promise that never resolves.
    for (const pending of [...this.pending.values()]) {
      pending.settle({ status: "error", reason: "bridge closed" });
    }
    this.client?.close();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
