/**
 * OpenClaw gateway client (RFC LP-8, M3/M4 Stage 2 — daemon-side, client half).
 *
 * Implements the `PlannerGateway` (M4) and `KnowledgeStore` (M3) over an HTTP
 * contract that OpenSidebar *defines* and OpenClaw's loopback gateway (or the
 * opinionated `openclaw/` adapter) must satisfy. This is the direction the
 * integration spec calls for ("OpenSidebar POSTs to OpenClaw's local gateway") —
 * the contract below is authoritative; this is the client of it, not a guess at a
 * pre-existing API.
 *
 * Contract (all loopback):
 *   GET  {baseUrl}/health                       -> 200 when reachable
 *   POST {baseUrl}/api/planner   { query, context? }
 *                                               -> { content, injectedContext? }
 *   GET  {baseUrl}/api/knowledge/{namespace}    -> SyncMap
 *   PUT  {baseUrl}/api/knowledge/{namespace}    { items: SyncMap }  -> 200
 */

import type { KnowledgeStore, SyncMap } from "./knowledge-sync";
import type { PlannerGateway } from "./llm-routing";

export interface OpenClawClientOptions {
  /** Loopback base URL, e.g. http://127.0.0.1:18789 */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface PlannerGatewayRequest {
  query: string;
  context?: string;
}

export interface PlannerGatewayResult {
  content: string;
  injectedContext?: string;
}

class OpenClawBase {
  protected readonly baseUrl: string;
  protected readonly fetchImpl: typeof fetch;
  protected readonly timeoutMs: number;

  constructor(opts: OpenClawClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  protected async request(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** PlannerGateway over the OpenClaw HTTP contract (M4). */
export class HttpPlannerGateway extends OpenClawBase implements PlannerGateway {
  private healthy = false;

  available(): boolean {
    return this.healthy;
  }

  /** Refresh the cached health flag (call on connect / via the keepalive alarm). */
  async probe(): Promise<boolean> {
    try {
      const res = await this.request("/health");
      this.healthy = res.ok;
    } catch {
      this.healthy = false;
    }
    return this.healthy;
  }

  async completePlan(req: PlannerGatewayRequest): Promise<PlannerGatewayResult> {
    const res = await this.request("/api/planner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      throw new Error(`OpenClaw planner gateway returned ${res.status}`);
    }
    return (await res.json()) as PlannerGatewayResult;
  }
}

/** KnowledgeStore over the OpenClaw HTTP contract (M3). */
export class HttpKnowledgeStore extends OpenClawBase implements KnowledgeStore {
  async getAll(namespace: string): Promise<SyncMap> {
    const res = await this.request(`/api/knowledge/${encodeURIComponent(namespace)}`);
    if (!res.ok) {
      throw new Error(`OpenClaw knowledge GET ${namespace} returned ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as SyncMap)
      : {};
  }

  async putItems(namespace: string, items: SyncMap): Promise<void> {
    const res = await this.request(`/api/knowledge/${encodeURIComponent(namespace)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      throw new Error(`OpenClaw knowledge PUT ${namespace} returned ${res.status}`);
    }
  }
}
