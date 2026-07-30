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
import {
  DelegatedTaskService,
  type DelegatedTaskServiceOptions,
} from "./delegated-task-service";

type WebSocketCtor = new (url: string) => WebSocket;

export interface BrowserBridgeClientOptions {
  url: string;
  /** Shared bridge secret, paired locally and never sent over the wire. */
  authToken: string;
  runner: AgentRunner;
  /** Injectable for tests; defaults to the global WebSocket. */
  webSocketImpl?: WebSocketCtor;
  reconnectMs?: number;
  delegatedTaskOptions?: DelegatedTaskServiceOptions;
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
  private readonly delegatedTasks: DelegatedTaskService;
  private authenticated = false;
  private clientNonce = "";
  private serverNonce = "";

  constructor(private readonly opts: BrowserBridgeClientOptions) {
    this.delegatedTasks = new DelegatedTaskService(
      opts.runner,
      opts.delegatedTaskOptions,
    );
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  /** Human Stop path: cancel the currently admitted delegated task, if any. */
  async stopActiveDelegatedTask(): Promise<void> {
    const status = (await this.delegatedTasks.handle({
      tool: "browser_bridge_status",
      args: {},
    })) as { activeTaskId: string | null };
    if (!status.activeTaskId) return;
    await this.delegatedTasks.handle({
      tool: "cancel_browser_task",
      args: { task_id: status.activeTaskId },
    });
  }

  private connect(): void {
    const Ctor = this.opts.webSocketImpl ?? (WebSocket as unknown as WebSocketCtor);
    const ws = new Ctor(this.opts.url);
    this.ws = ws;
    this.authenticated = false;
    this.clientNonce = randomNonce();
    this.serverNonce = "";

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "auth_hello",
          clientNonce: this.clientNonce,
        }),
      );
    };
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
    let decoded: unknown;
    try {
      decoded = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    const authFrame = decoded as {
      type?: unknown;
      serverNonce?: unknown;
      proof?: unknown;
    };
    if (!this.authenticated) {
      if (
        authFrame.type === "auth_challenge" &&
        typeof authFrame.serverNonce === "string" &&
        typeof authFrame.proof === "string"
      ) {
        const expected = await hmac(
          this.opts.authToken,
          `server:${this.clientNonce}:${authFrame.serverNonce}`,
        );
        if (!constantTimeEqual(expected, authFrame.proof)) {
          ws.close();
          return;
        }
        this.serverNonce = authFrame.serverNonce;
        ws.send(
          JSON.stringify({
            type: "auth_response",
            proof: await hmac(
              this.opts.authToken,
              `client:${this.clientNonce}:${this.serverNonce}`,
            ),
          }),
        );
        return;
      }
      if (authFrame.type === "auth_ok" && this.serverNonce) {
        this.authenticated = true;
      }
      return;
    }
    const frame = decoded as HostFrame;
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
        this.delegatedTasks,
      );
    } catch (error) {
      response = { status: "error", reason: (error as Error).message };
    } finally {
      this.controllers.delete(frame.id);
    }
    ws.send(JSON.stringify({ id: frame.id, response }));
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function hmac(token: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}
