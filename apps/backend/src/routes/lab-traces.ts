import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "../server.js";
import {
  createLabBugBriefFromTrace,
  createLabResearchSeedFromTrace,
  fetchLabTraceDiagnosis,
  fetchLabTracePathologies,
  fetchLabTraceSession,
  fetchSimilarLabTraceFailures,
} from "../lab-trace-client.js";

export async function handleLabTraceRoutes(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { pathname, searchParams, method, sendJson, sendError } = ctx;

  if (method !== "GET") {
    if (pathname === "/lab/bug-brief" && method === "POST") {
      const body = (await ctx.parseJsonBody(_req)) as { sessionId?: string };
      const sessionId = body?.sessionId;
      if (!sessionId) {
        sendError(res, "Missing body field: sessionId");
        return;
      }

      try {
        sendJson(res, createLabBugBriefFromTrace(sessionId), 201);
      } catch (err) {
        sendError(
          res,
          err instanceof Error ? err.message : "Failed to create bug brief",
          400,
        );
      }
      return;
    }

    if (pathname === "/lab/research-seed" && method === "POST") {
      const body = (await ctx.parseJsonBody(_req)) as { sessionId?: string };
      const sessionId = body?.sessionId;
      if (!sessionId) {
        sendError(res, "Missing body field: sessionId");
        return;
      }

      try {
        sendJson(res, createLabResearchSeedFromTrace(sessionId), 201);
      } catch (err) {
        sendError(
          res,
          err instanceof Error ? err.message : "Failed to create research seed",
          400,
        );
      }
      return;
    }

    sendError(res, "Method not allowed", 405);
    return;
  }

  if (pathname === "/lab/traces/session") {
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) {
      sendError(res, "Missing query parameter: sessionId");
      return;
    }

    try {
      sendJson(res, fetchLabTraceSession(sessionId));
    } catch (err) {
      sendError(
        res,
        err instanceof Error ? err.message : "Failed to fetch trace session",
        404,
      );
    }
    return;
  }

  if (pathname === "/lab/traces/similar") {
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) {
      sendError(res, "Missing query parameter: sessionId");
      return;
    }

    const limit = Number(searchParams.get("limit")) || 5;
    try {
      sendJson(res, fetchSimilarLabTraceFailures(sessionId, limit));
    } catch (err) {
      sendError(
        res,
        err instanceof Error ? err.message : "Failed to fetch similar failures",
        400,
      );
    }
    return;
  }

  if (pathname === "/lab/traces/pathologies") {
    const limit = Number(searchParams.get("limit")) || 5;
    const domain = searchParams.get("domain");
    const fixture = searchParams.get("fixture");

    try {
      sendJson(
        res,
        fetchLabTracePathologies({
          domain,
          fixture,
          limit,
        }),
      );
    } catch (err) {
      sendError(
        res,
        err instanceof Error ? err.message : "Failed to fetch trace pathologies",
        400,
      );
    }
    return;
  }

  if (pathname === "/lab/traces/diagnosis") {
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) {
      sendError(res, "Missing query parameter: sessionId");
      return;
    }

    const limit = Number(searchParams.get("limit")) || 5;
    try {
      sendJson(res, fetchLabTraceDiagnosis(sessionId, limit));
    } catch (err) {
      sendError(
        res,
        err instanceof Error ? err.message : "Failed to build trace diagnosis",
        400,
      );
    }
    return;
  }

  sendError(res, "Not found", 404);
}
