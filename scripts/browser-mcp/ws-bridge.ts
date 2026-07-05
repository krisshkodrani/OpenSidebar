/**
 * Host-side WebSocket transport for the browser MCP host (RFC LP-8, M2 Stage 2b).
 *
 * Runs a loopback WebSocket server; the OpenSidebar extension service worker
 * connects as a client (browser-native `WebSocket`, no dependency). Each thick
 * tool call is sent with a correlation id and awaits the matching response, so
 * `WebSocketBridge` satisfies the `BrowserBridge` contract over the wire.
 *
 * Loopback-only by default (the LP-8 privacy invariant). The extension-side WS
 * client + the `AgentRunner` hookup that runs a real `AgentLoop` are the
 * remaining live-edit step (they touch the in-flight orchestrator WIP).
 *
 * Wire frames (JSON):
 *   host → ext:  { id, request: BrowserToolRequest }
 *   ext → host:  { id, response: BrowserToolResponse }
 */

import { WebSocketServer, type WebSocket } from "ws";

import type {
  BrowserBridge,
  BrowserToolRequest,
  BrowserToolResponse,
} from "./bridge.js";

interface Pending {
  resolve: (r: BrowserToolResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WebSocketBridgeOptions {
  /** 0 picks an ephemeral port (useful in tests). */
  port?: number;
  host?: string;
  timeoutMs?: number;
}

export class WebSocketBridge implements BrowserBridge {
  private readonly wss: WebSocketServer;
  private client: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private readonly timeoutMs: number;
  /** Resolves once the server is listening (so `port` is known). */
  readonly listening: Promise<void>;

  constructor(opts: WebSocketBridgeOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.wss = new WebSocketServer({
      port: opts.port ?? 8787,
      host: opts.host ?? "127.0.0.1",
    });
    this.listening = new Promise((resolve) =>
      this.wss.once("listening", () => resolve()),
    );
    this.wss.on("connection", (socket: WebSocket) => {
      // Single extension client; a new connection supersedes the old.
      this.client = socket;
      socket.on("message", (data) => this.onMessage(data.toString()));
      socket.on("close", () => {
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
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    pending.resolve(msg.response ?? { status: "error", reason: "malformed response" });
  }

  async call(request: BrowserToolRequest): Promise<BrowserToolResponse> {
    if (!this.connected || !this.client) {
      return { status: "error", reason: "OpenSidebar extension is not connected." };
    }
    const id = `${++this.seq}`;
    const client = this.client;
    return new Promise<BrowserToolResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ status: "error", reason: "browser tool call timed out" });
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      client.send(JSON.stringify({ id, request }));
    });
  }

  async close(): Promise<void> {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    this.client?.close();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}
