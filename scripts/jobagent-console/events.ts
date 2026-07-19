/**
 * JobAgent console — SSE event hub (pi Phase 9).
 *
 * One process-wide hub; every connected browser tab gets every event. Events
 * are the UI's live-update channel (queue-changed, run-status, run-log,
 * approval-pending, approval-resolved, bridge-status). A comment heartbeat
 * every 25s keeps intermediaries from closing idle streams.
 */
import type { ServerResponse } from "node:http";

export type ConsoleEventType =
  | "queue-changed"
  | "run-status"
  | "run-log"
  | "approval-pending"
  | "approval-resolved"
  | "bridge-status";

export interface ConsoleEvent {
  type: ConsoleEventType;
  data: unknown;
}

const HEARTBEAT_MS = 25_000;

export class EventHub {
  private clients = new Set<ServerResponse>();
  private heartbeat: NodeJS.Timeout | null = null;

  /** Attach an HTTP response as an SSE stream (headers written here). */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const client of this.clients) client.write(": ping\n\n");
      }, HEARTBEAT_MS);
      this.heartbeat.unref();
    }
  }

  broadcast(event: ConsoleEvent): void {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        /* already gone */
      }
    }
    this.clients.clear();
  }
}
