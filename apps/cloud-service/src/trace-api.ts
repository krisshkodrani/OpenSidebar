import { Hono } from "hono";
import type { CreateTraceUploadIntentV1 } from "@opensidebar/shared-types";
import type { ControlPrincipal } from "./control-repository.js";
import type { TraceRepository } from "./trace-repository.js";
import type { TraceObjectPort } from "./trace-object-store.js";

type Variables = {
  principal: ControlPrincipal;
  authKind: "bearer" | "cookie";
  csrfHash: string;
};
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const fingerprint = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
const parseIntent = (value: unknown): CreateTraceUploadIntentV1 | null => {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const size = Number(body.ciphertextSizeBytes);
  const count = Number(body.entryCount),
    screenshots = Number(body.screenshotCount);
  const createdAt =
    typeof body.createdAt === "string" ? new Date(body.createdAt) : null;
  if (
    typeof body.traceId !== "string" ||
    !uuid(body.traceId) ||
    typeof body.title !== "string" ||
    body.title.trim().length < 1 ||
    new TextEncoder().encode(body.title).length > 240 ||
    typeof body.bundleSchemaVersion !== "string" ||
    body.bundleSchemaVersion.length < 1 ||
    body.bundleSchemaVersion.length > 80 ||
    !fingerprint(body.keyFingerprint) ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 64 * 1024 * 1024 ||
    !Number.isInteger(count) ||
    count < 0 ||
    !Number.isInteger(screenshots) ||
    screenshots < 0 ||
    !createdAt ||
    Number.isNaN(createdAt.getTime())
  )
    return null;
  return {
    traceId: body.traceId,
    // Never trust a client to keep a task-derived title out of the plaintext
    // server index. The decrypted bundle remains the title authority.
    title: "Encrypted trace",
    createdAt: createdAt.toISOString(),
    bundleSchemaVersion: body.bundleSchemaVersion,
    keyFingerprint: body.keyFingerprint as string,
    entryCount: count,
    screenshotCount: screenshots,
    ciphertextSizeBytes: size,
  };
};

export function createTraceApi(
  repository: TraceRepository,
  objects: TraceObjectPort,
  flags: { uploads: boolean; downloads: boolean },
) {
  const api = new Hono<{ Variables: Variables }>();
  const account = (c: { get(name: "principal"): ControlPrincipal }) =>
    c.get("principal").accountId;
  api.get("/", async (c) =>
    c.json({ schemaVersion: 1, traces: await repository.list(account(c)) }),
  );
  api.get("/usage", async (c) => c.json(await repository.usage(account(c))));
  api.post("/upload-intents", async (c) => {
    if (!flags.uploads)
      return c.json(
        {
          error: {
            code: "trace_uploads_disabled",
            message: "Encrypted trace uploads are not enabled.",
          },
        },
        503,
      );
    const input = parseIntent(await c.req.json().catch(() => null));
    if (!input)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "Trace upload metadata is invalid.",
          },
        },
        400,
      );
    const objectKey = objects.key(account(c), input.traceId);
    const result = await repository.createIntent(account(c), input, objectKey);
    if (result.kind === "quota_exceeded")
      return c.json(
        {
          error: {
            code: "quota_exceeded",
            message: "The 500 MB encrypted trace quota is full.",
          },
        },
        429,
      );
    if (result.kind === "exists" && result.value?.state !== "upload_pending")
      return c.json(
        {
          error: {
            code: "trace_exists",
            message: "This trace is already stored.",
          },
        },
        409,
      );
    return c.json(
      {
        schemaVersion: 1,
        trace: result.value,
        uploadUrl: `/api/v1/traces/${input.traceId}/content`,
        commitUrl: `/api/v1/traces/${input.traceId}/commit`,
      },
      result.kind === "created" ? 201 : 200,
    );
  });
  api.put("/:traceId/content", async (c) => {
    if (!flags.uploads)
      return c.json(
        {
          error: {
            code: "trace_uploads_disabled",
            message: "Encrypted trace uploads are not enabled.",
          },
        },
        503,
      );
    const traceId = c.req.param("traceId"),
      current = uuid(traceId)
        ? await repository.get(account(c), traceId)
        : null;
    if (!current)
      return c.json(
        { error: { code: "trace_not_found", message: "Trace was not found." } },
        404,
      );
    if (current.state !== "upload_pending")
      return c.json(
        {
          error: {
            code: "trace_conflict",
            message: "Trace is not accepting content.",
          },
        },
        409,
      );
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength !== current.ciphertextSizeBytes)
      return c.json(
        {
          error: {
            code: "size_mismatch",
            message: "Encrypted trace size does not match its intent.",
          },
        },
        400,
      );
    const sha256 = await objects.put(objects.key(account(c), traceId), body);
    return c.json({ schemaVersion: 1, ciphertextSha256: sha256 }, 201);
  });
  api.post("/:traceId/commit", async (c) => {
    if (!flags.uploads)
      return c.json(
        {
          error: {
            code: "trace_uploads_disabled",
            message: "Encrypted trace uploads are not enabled.",
          },
        },
        503,
      );
    const traceId = c.req.param("traceId");
    const body: { ciphertextSha256?: string } = await c.req
      .json<{ ciphertextSha256?: string }>()
      .catch(() => ({}) as { ciphertextSha256?: string });
    if (!uuid(traceId) || !/^[a-f0-9]{64}$/.test(body.ciphertextSha256 ?? ""))
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "A valid ciphertext digest is required.",
          },
        },
        400,
      );
    const current = await repository.get(account(c), traceId);
    if (!current)
      return c.json(
        { error: { code: "trace_not_found", message: "Trace was not found." } },
        404,
      );
    const storedDigest = await objects
      .sha256(objects.key(account(c), traceId))
      .catch(() => null);
    if (!storedDigest || storedDigest !== body.ciphertextSha256)
      return c.json(
        {
          error: {
            code: "digest_mismatch",
            message: "Uploaded trace integrity check failed.",
          },
        },
        409,
      );
    const result = await repository.commit(
      account(c),
      traceId,
      body.ciphertextSha256!,
    );
    if (result.kind === "not_found")
      return c.json(
        { error: { code: "trace_not_found", message: "Trace was not found." } },
        404,
      );
    if (result.kind === "conflict")
      return c.json(
        {
          error: {
            code: "trace_conflict",
            message: "Trace cannot be committed.",
          },
        },
        409,
      );
    return c.json(result.value);
  });
  api.get("/:traceId/content", async (c) => {
    if (!flags.downloads)
      return c.json(
        {
          error: {
            code: "trace_downloads_disabled",
            message: "Encrypted trace downloads are not enabled.",
          },
        },
        503,
      );
    const traceId = c.req.param("traceId"),
      current = uuid(traceId)
        ? await repository.get(account(c), traceId)
        : null;
    if (!current || current.state !== "available")
      return c.json(
        { error: { code: "trace_not_found", message: "Trace was not found." } },
        404,
      );
    const stored = await objects.get(objects.key(account(c), traceId));
    const responseBody = new Uint8Array(stored.byteLength);
    responseBody.set(stored);
    return c.body(responseBody, 200, {
      "Content-Type": "application/vnd.opensidebar.trace",
      "Content-Disposition": `attachment; filename="${traceId}.ostrace"`,
    });
  });
  api.delete("/:traceId", async (c) => {
    const traceId = c.req.param("traceId"),
      result = uuid(traceId)
        ? await repository.markDeleting(account(c), traceId)
        : { kind: "not_found" as const };
    if (!result.value)
      return c.json(
        { error: { code: "trace_not_found", message: "Trace was not found." } },
        404,
      );
    try {
      await objects.delete(objects.key(account(c), traceId));
    } catch {
      return c.json(
        {
          error: {
            code: "trace_delete_deferred",
            message: "Encrypted trace deletion is queued for retry.",
          },
        },
        503,
      );
    }
    await repository.remove(account(c), traceId);
    return c.body(null, 204);
  });
  return api;
}
