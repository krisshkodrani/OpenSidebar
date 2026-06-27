import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "../server.js";
import type { ProfileFileResolveInput } from "../types.js";
import { resolveProfileFile } from "../services/profile-service.js";

export async function handleProfileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const { pathname, method, parseJsonBody, sendJson, sendError } = ctx;

  // Note: `/profile/resolve` and `/profile/context` were removed (RFC LP-8, M1) —
  // they had no callers in the extension. The live personal-info path is the
  // in-extension digest (`utils/personal-profile.ts`). Only `/profile/file`
  // (CV/attachment alias) remains in use.
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
