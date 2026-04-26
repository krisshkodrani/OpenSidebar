/**
 * Memory routes — REST endpoints backed by native SQLite memory.
 *
 * POST   /memory        — Create memory
 * GET    /memory/search — Full-text search
 * GET    /memory/list   — List memories (optional category filter)
 * GET    /memory/domain — Domain-scoped lookup
 * GET    /memory/:id    — Get single memory
 * DELETE /memory/:id    — Delete memory
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "../server.js";
import type { MemoryInput, MemoryCategory } from "../types.js";
import {
  createMemory,
  queryMemories,
  queryMemoriesByDomain,
  fetchMemory,
  fetchMemoryList,
  removeMemory,
} from "../services/memory-service.js";

const VALID_CATEGORIES: MemoryCategory[] = [
  "execution-result",
  "user-preference",
  "site-knowledge",
  "learned-pattern",
];
const MAX_MEMORY_LIMIT = 100;

export async function handleMemoryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { pathname, searchParams, method, parseJsonBody, sendJson, sendEmpty, sendError } = ctx;

  // POST /memory — Create
  if (pathname === "/memory" && method === "POST") {
    const body = (await parseJsonBody(req)) as Partial<MemoryInput>;

    if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
      sendError(res, `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`);
      return;
    }
    if (!body.title || !body.content) {
      sendError(res, "Missing required fields: title, content");
      return;
    }

    const result = await createMemory({
      category: body.category,
      title: body.title,
      content: body.content,
      workspaceId: body.workspaceId,
      metadata: body.metadata,
    });

    sendJson(res, result, 201);
    return;
  }

  // GET /memory/search?q=...&limit=5
  if (pathname === "/memory/search" && method === "GET") {
    const query = searchParams.get("q");
    if (!query) {
      sendError(res, "Missing query parameter: q");
      return;
    }
    const limit = parseLimit(searchParams.get("limit"), 5);
    const results = await queryMemories(query, limit);
    sendJson(res, { results });
    return;
  }

  // GET /memory/domain?d=example.com&limit=10
  if (pathname === "/memory/domain" && method === "GET") {
    const domain = searchParams.get("d");
    if (!domain) {
      sendError(res, "Missing query parameter: d (domain)");
      return;
    }
    const limit = parseLimit(searchParams.get("limit"), 10);
    const results = await queryMemoriesByDomain(domain, limit);
    sendJson(res, { results });
    return;
  }

  // GET /memory/list?category=...&limit=20
  if (pathname === "/memory/list" && method === "GET") {
    const category = searchParams.get("category") || undefined;
    const limit = parseLimit(searchParams.get("limit"), 20);
    const results = await fetchMemoryList(category, limit);
    sendJson(res, { results });
    return;
  }

  // GET /memory/:slug
  const idMatch = pathname.match(/^\/memory\/([a-z0-9_-]+)$/);
  if (idMatch && method === "GET") {
    const result = await fetchMemory(idMatch[1]);
    if (!result) {
      sendError(res, "Memory not found", 404);
      return;
    }
    sendJson(res, result);
    return;
  }

  // DELETE /memory/:slug
  if (idMatch && method === "DELETE") {
    await removeMemory(idMatch[1]);
    sendEmpty(res);
    return;
  }

  sendError(res, "Not found", 404);
}

function parseLimit(raw: string | null, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.floor(parsed);
  if (integer < 1) return fallback;
  return Math.min(integer, MAX_MEMORY_LIMIT);
}
