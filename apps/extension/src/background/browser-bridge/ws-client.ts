/**
 * Extension-side WebSocket client for the browser MCP host (RFC LP-8, M2 Stage 2b).
 *
 * Runs in the service worker; connects to the host's loopback WebSocket server,
 * receives `{ id, request }` frames, runs them through `handleBrowserToolRequest`
 * (translation → AgentRunner → response), and replies `{ id, response }`.
 * A `{ id, cancel: true }` frame aborts the matching in-flight run's signal
 * (fire-and-forget: cancel frames never get a reply; the run's own response
 * frame completes the lifecycle and the host drops it as already-resolved).
 * Reconnects on close so it survives SW recycling (pair with the keepalive
 * alarm). Loopback-only.
 *
 * Deliberate non-goal: in-flight runs are NOT aborted when the socket closes —
 * disconnects are often transient (2s reconnect), and killing a mission on a
 * blip is worse than an orphaned run bounded by the driver's run timeout.
 *
 * The `AgentRunner` is injected — the one remaining seam is the SW startup code
 * that constructs this client with an orchestrator-backed runner + the host port
 * (that wiring lives next to the agent runtime / the in-flight WIP).
 */

import type {
  BrowserToolRequest,
  BrowserToolResponse,
} from "@shared-types/browser-bridge";

import { handleBrowserToolRequest, type AgentRunner } from "./handler";

type WebSocketCtor = new (url: string) => WebSocket;

export interface BrowserBridgeClientOptions {
  url: string;
  runner: AgentRunner;
  /** Injectable for tests; defaults to the global WebSocket. */
  webSocketImpl?: WebSocketCtor;
  reconnectMs?: number;
}

interface HostFrame {
  id?: unknown;
  request?: unknown;
  cancel?: unknown;
}

export class BrowserBridgeClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  /** One controller per in-flight request frame, so a cancel can target it. */
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly opts: BrowserBridgeClientOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    const Ctor = this.opts.webSocketImpl ?? (WebSocket as unknown as WebSocketCtor);
    const ws = new Ctor(this.opts.url);
    this.ws = ws;

    ws.onmessage = (event: MessageEvent) => {
      void this.onMessage(ws, event);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!this.stopped) {
        setTimeout(() => this.connect(), this.opts.reconnectMs ?? 2000);
      }
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }

  private async onMessage(ws: WebSocket, event: MessageEvent): Promise<void> {
    let frame: HostFrame;
    try {
      frame = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (typeof frame.id !== "string") return;
    if (frame.cancel === true) {
      // Unknown or already-settled ids are silently ignored, mirroring the
      // host's unknown-id response guard.
      this.controllers.get(frame.id)?.abort();
      return;
    }
    if (!frame.request) return;

    const controller = new AbortController();
    this.controllers.set(frame.id, controller);
    let response: BrowserToolResponse;
    try {
      response = await handleBrowserToolRequest(
        frame.request as BrowserToolRequest,
        this.opts.runner,
        { signal: controller.signal },
      );
    } catch (error) {
      response = { status: "error", reason: (error as Error).message };
    } finally {
      this.controllers.delete(frame.id);
    }
    ws.send(JSON.stringify({ id: frame.id, response }));
  }
}
