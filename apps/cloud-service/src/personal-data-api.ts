import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import type {
  PersonalDataCategory,
  PersonalDataDocumentEnvelopeV1,
  PersonalDataWrappedKeyV1,
} from "@opensidebar/shared-types";
import type { ControlPrincipal } from "./control-repository.js";
import type { PersonalDataObjectPort } from "./personal-data-object-store.js";
import type { PersonalDataRepository } from "./personal-data-repository.js";

type Variables = { principal: ControlPrincipal; authKind: "bearer" | "cookie"; csrfHash: string };
const categories = new Set<PersonalDataCategory>(["saved_prompts", "website_skills", "profile"]);
const caps: Record<PersonalDataCategory, number> = {
  saved_prompts: 1 * 1024 * 1024,
  website_skills: 2 * 1024 * 1024,
  profile: 256 * 1024,
};
const category = (value: string): PersonalDataCategory | null => categories.has(value as PersonalDataCategory) ? value as PersonalDataCategory : null;
type PersonalDataContext = Context<{ Variables: Variables }>;
const problem = (c: PersonalDataContext, status: 400 | 403 | 404 | 409 | 412 | 413 | 503, code: string, message: string) => {
  c.header("Cache-Control", "no-store");
  return c.json({ error: { code, message } }, status);
};
const publicJwk = (value: unknown): value is JsonWebKey => {
  const key = value as JsonWebKey | null;
  return Boolean(key && key.kty === "EC" && key.crv === "P-256" && typeof key.x === "string" && typeof key.y === "string" && !key.d);
};
const verificationCode = (id: string, key: JsonWebKey) => createHash("sha256")
  .update(`${id}:${key.x}:${key.y}`).digest("hex").slice(0, 12).toUpperCase();
const wrappedKey = (value: unknown): value is PersonalDataWrappedKeyV1 => {
  const item = value as PersonalDataWrappedKeyV1 | null;
  return Boolean(item && item.schemaVersion === 1 && item.algorithm === "ECDH-P256+HKDF-SHA256+A256KW" &&
    Number.isInteger(item.keyEpoch) && item.keyEpoch > 0 && typeof item.senderDeviceId === "string" &&
    typeof item.recipientDeviceId === "string" && publicJwk(item.senderEphemeralPublicKeyJwk) &&
    typeof item.salt === "string" && typeof item.wrappedPersonalDataKey === "string");
};
const envelope = (value: unknown, expected: PersonalDataCategory): value is PersonalDataDocumentEnvelopeV1 => {
  const item = value as PersonalDataDocumentEnvelopeV1 | null;
  return Boolean(item && item.schemaVersion === 1 && item.algorithm === "AES-256-GCM" && item.category === expected &&
    Number.isInteger(item.revision) && item.revision > 0 && Number.isInteger(item.keyEpoch) && item.keyEpoch > 0 &&
    typeof item.nonce === "string" && typeof item.ciphertext === "string");
};

export function createPersonalDataApi(input: {
  repository: PersonalDataRepository;
  objects: PersonalDataObjectPort;
  readsEnabled: boolean;
  writesEnabled: boolean;
  profileEnabled: boolean;
  testerSubjects: ReadonlySet<string>;
}) {
  const api = new Hono<{ Variables: Variables }>();
  const enabled = (principal: ControlPrincipal) => input.testerSubjects.has(principal.accountId);
  const capabilities = (principal: ControlPrincipal) => ({ schemaVersion: 1 as const,
    reads: input.readsEnabled && enabled(principal), writes: input.writesEnabled && enabled(principal),
    profile: input.profileEnabled && enabled(principal), namedTester: enabled(principal) });
  const requireRead = (c: PersonalDataContext) => capabilities(c.get("principal")).reads;
  const requireWrite = (c: PersonalDataContext) => capabilities(c.get("principal")).writes;

  api.get("/status", async (c) => {
    const principal = c.get("principal");
    const capsValue = capabilities(principal);
    const documents = capsValue.reads ? await input.repository.documents(principal.accountId) : [];
    const requests = capsValue.reads ? await input.repository.requests(principal.accountId, principal.deviceId,
      await input.repository.approvedDevice(principal.accountId, principal.deviceId)) : [];
    return c.json({ schemaVersion: 1, capabilities: capsValue,
      keyEpoch: capsValue.reads ? await input.repository.keyEpoch(principal.accountId) : 0,
      currentDeviceApproved: capsValue.reads && await input.repository.approvedDevice(principal.accountId, principal.deviceId),
      approvedDevices: capsValue.reads
        ? await input.repository.approvedDevices(principal.accountId, principal.deviceId)
        : [],
      documents: Object.fromEntries(documents.map((item) => [item.metadata.category, item.metadata])),
      pendingRequestCount: requests.filter((item) => item.state === "pending").length });
  });
  api.put("/device-key", async (c) => {
    if (!requireWrite(c)) return problem(c, 503, "personal_data_writes_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    const body = await c.req.json().catch(() => null);
    if (!publicJwk(body?.publicKeyJwk)) return problem(c, 400, "invalid_device_key", "A public P-256 device key is required.");
    return c.json({ schemaVersion: 1, ...(await input.repository.registerDeviceKey(principal.accountId, principal.deviceId, body.publicKeyJwk)) });
  });
  api.get("/key-requests", async (c) => {
    if (!requireRead(c)) return problem(c, 503, "personal_data_reads_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    const canApprove = await input.repository.approvedDevice(principal.accountId, principal.deviceId);
    const requests = await input.repository.requests(principal.accountId, principal.deviceId, canApprove);
    return c.json({ schemaVersion: 1, requests: requests.map((item) => ({ ...item,
      verificationCode: verificationCode(item.id, item.publicKeyJwk) })) });
  });
  api.post("/key-requests", async (c) => {
    if (!requireWrite(c)) return problem(c, 503, "personal_data_writes_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    if (await input.repository.approvedDevice(principal.accountId, principal.deviceId))
      return problem(c, 409, "device_already_approved", "This browser already has encrypted-data access.");
    const body = await c.req.json().catch(() => null);
    if (!publicJwk(body?.publicKeyJwk)) return problem(c, 400, "invalid_device_key", "A public P-256 device key is required.");
    const existing = (await input.repository.requests(principal.accountId, principal.deviceId, false))
      .find((item) => item.requestingDeviceId === principal.deviceId && item.state === "pending");
    if (existing)
      return c.json({ schemaVersion: 1, id: existing.id,
        verificationCode: verificationCode(existing.id, existing.publicKeyJwk), expiresAt: existing.expiresAt });
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await input.repository.createKeyRequest({ id, accountId: principal.accountId, deviceId: principal.deviceId,
      publicKeyJwk: body.publicKeyJwk, expiresAt });
    return c.json({ schemaVersion: 1, id, verificationCode: verificationCode(id, body.publicKeyJwk), expiresAt: expiresAt.toISOString() }, 201);
  });
  api.post("/key-requests/:id/approve", async (c) => {
    if (!requireWrite(c)) return problem(c, 503, "personal_data_writes_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    if (!await input.repository.approvedDevice(principal.accountId, principal.deviceId))
      return problem(c, 403, "device_not_approved", "This browser cannot approve encrypted-data access.");
    const body = await c.req.json().catch(() => null);
    if (!wrappedKey(body?.wrappedKey) || body.wrappedKey.senderDeviceId !== principal.deviceId)
      return problem(c, 400, "invalid_wrapped_key", "A valid wrapped personal-data key is required.");
    const pending = (await input.repository.requests(principal.accountId, principal.deviceId, true))
      .find((item) => item.id === c.req.param("id") && item.state === "pending");
    if (
      !pending ||
      body.wrappedKey.recipientDeviceId !== pending.requestingDeviceId ||
      body.wrappedKey.keyEpoch !== await input.repository.keyEpoch(principal.accountId)
    )
      return problem(c, 409, "key_request_unavailable", "The request or key epoch is no longer current.");
    if (!await input.repository.decideRequest(principal.accountId, c.req.param("id"), "approved", body.wrappedKey))
      return problem(c, 409, "key_request_unavailable", "The request is no longer pending.");
    return c.json({ ok: true });
  });
  api.post("/key-requests/:id/deny", async (c) => {
    if (!requireWrite(c)) return problem(c, 503, "personal_data_writes_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    if (!await input.repository.approvedDevice(principal.accountId, principal.deviceId))
      return problem(c, 403, "device_not_approved", "This browser cannot deny encrypted-data access.");
    if (!await input.repository.decideRequest(principal.accountId, c.req.param("id"), "denied"))
      return problem(c, 409, "key_request_unavailable", "The request is no longer pending.");
    return c.json({ ok: true });
  });
  api.get("/documents/:category", async (c) => {
    if (!requireRead(c)) return problem(c, 503, "personal_data_reads_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    if (!await input.repository.approvedDevice(principal.accountId, principal.deviceId))
      return problem(c, 403, "device_not_approved", "Approve this browser before restoring encrypted data.");
    const kind = category(c.req.param("category"));
    if (!kind || (kind === "profile" && !input.profileEnabled)) return problem(c, 404, "category_unavailable", "Sync category is unavailable.");
    const item = await input.repository.document(principal.accountId, kind);
    if (!item) return problem(c, 404, "document_not_found", "No cloud copy exists.");
    const stored = await input.objects.get(item.objectKey);
    return new Response(new Uint8Array(stored).buffer, { headers: { "content-type": "application/vnd.opensidebar.personal-data+json", "cache-control": "no-store" } });
  });
  api.put("/documents/:category", async (c) => {
    if (!requireWrite(c)) return problem(c, 503, "personal_data_writes_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    if (!await input.repository.approvedDevice(principal.accountId, principal.deviceId))
      return problem(c, 403, "device_not_approved", "Approve this browser before syncing encrypted data.");
    const kind = category(c.req.param("category"));
    if (!kind || (kind === "profile" && !input.profileEnabled)) return problem(c, 404, "category_unavailable", "Sync category is unavailable.");
    const body = await c.req.json().catch(() => null);
    if (!envelope(body, kind)) return problem(c, 400, "invalid_envelope", "Encrypted document envelope is invalid.");
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    if (bytes.byteLength > caps[kind]) return problem(c, 413, "document_too_large", "Encrypted document exceeds the category limit.");
    const epoch = await input.repository.keyEpoch(principal.accountId);
    if (body.keyEpoch !== epoch) return problem(c, 409, "key_epoch_conflict", "Encrypted document uses a stale key epoch.");
    const expected = Number(c.req.header("if-match"));
    if (!Number.isInteger(expected) || expected < 0 || body.revision !== expected + 1)
      return problem(c, 412, "if_match_required", "A matching prior revision is required.");
    const objectKey = input.objects.key(principal.accountId, kind, body.revision);
    const digest = await input.objects.put(objectKey, bytes);
    const saved = await input.repository.putDocument(principal.accountId, expected, { category: kind,
      revision: body.revision, keyEpoch: body.keyEpoch, objectKey, ciphertextSizeBytes: bytes.byteLength,
      ciphertextSha256: digest, updatedByDeviceId: principal.deviceId });
    if (!saved.saved) { await input.objects.delete(objectKey).catch(() => undefined); return problem(c, 409, "revision_conflict", "Cloud copy changed on another browser."); }
    if (saved.supersededKey && saved.supersededKey !== objectKey) {
      try {
        await input.objects.delete(saved.supersededKey);
        await input.repository.completeObjectDeletion(principal.accountId, saved.supersededKey);
      } catch { await input.repository.noteObjectDeletionFailure(principal.accountId, saved.supersededKey); }
    }
    return c.json((await input.repository.document(principal.accountId, kind))!.metadata);
  });
  api.delete("/documents/:category", async (c) => {
    if (!requireWrite(c)) return problem(c, 503, "personal_data_writes_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    const kind = category(c.req.param("category"));
    if (!kind) return problem(c, 404, "category_unavailable", "Sync category is unavailable.");
    const existing = await input.repository.document(principal.accountId, kind);
    if (existing) {
      await input.objects.delete(existing.objectKey);
      await input.repository.deleteDocument(principal.accountId, kind, existing.objectKey);
    }
    return c.body(null, 204);
  });
  api.post("/reset", async (c) => {
    if (!requireWrite(c)) return problem(c, 503, "personal_data_writes_disabled", "Personal-data sync is not enabled.");
    const principal = c.get("principal");
    const documents = await input.repository.documents(principal.accountId);
    for (const item of documents) await input.objects.delete(item.objectKey).catch(() => undefined);
    for (const item of documents) await input.repository.deleteDocument(principal.accountId, item.metadata.category, item.objectKey);
    return c.json({ schemaVersion: 1, keyEpoch: await input.repository.reset(principal.accountId, principal.deviceId) });
  });
  return api;
}
