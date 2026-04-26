import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "../server.js";
import type {
  ProfileFileResolveInput,
  ProfileResolveInput,
  ProfileSafeContextInput,
} from "../types.js";
import {
  resolveProfileFields,
  resolveProfileFile,
  resolveSafeProfileContext,
} from "../services/profile-service.js";

export async function handleProfileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { pathname, method, parseJsonBody, sendJson, sendError } = ctx;

  if (pathname === "/profile/resolve" && method === "POST") {
    const body = (await parseJsonBody(req)) as Partial<ProfileResolveInput>;

    if (!Array.isArray(body.fields)) {
      sendError(res, "Missing required field: fields[]", 400);
      return;
    }

    try {
      const result = resolveProfileFields(body.fields);
      sendJson(res, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve profile fields.";
      const status =
        message.includes("not found") || message.includes("top-level `profile`")
          ? 404
          : 400;
      sendError(res, message, status);
    }
    return;
  }

  if (pathname === "/profile/context" && method === "POST") {
    const body = (await parseJsonBody(req)) as Partial<ProfileSafeContextInput>;

    try {
      const result = resolveSafeProfileContext(
        typeof body.query === "string" ? body.query : "",
      );
      sendJson(res, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve profile context.";
      const status =
        message.includes("not found") || message.includes("top-level `profile`")
          ? 404
          : 400;
      sendError(res, message, status);
    }
    return;
  }

  if (pathname === "/profile/file" && method === "POST") {
    const body = (await parseJsonBody(req)) as Partial<ProfileFileResolveInput>;

    if (typeof body.alias !== "string" || !body.alias.trim()) {
      sendError(res, "Missing required field: alias", 400);
      return;
    }

    try {
      const result = resolveProfileFile(body.alias);
      sendJson(res, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve profile file.";
      const status =
        message.includes("not found") || message.includes("not configured")
          ? 404
          : 400;
      sendError(res, message, status);
    }
    return;
  }

  sendError(res, "Not found", 404);
}
