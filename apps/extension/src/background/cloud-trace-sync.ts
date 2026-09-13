import type { TraceEntry, TraceSession, UserSettings } from "@shared-types";
import {
  encryptTraceBundle,
  inspectEncryptedTrace,
  createRecoveryKey,
  type EncryptedTraceHeader,
} from "@trace-sync";
import { CloudAuthenticatedFetch } from "../cloud/authenticated-fetch";
import { logger } from "../utils";

export const TRACE_RECOVERY_KEY_STORAGE = "cloudTraceRecoveryKeyV1";
const API_ORIGIN = "https://opensidebar.com";
const RETRY_DELAYS_MS = [0, 500, 1_500] as const;

const storage = {
  get: (keys?: string | string[]) => chrome.storage.local.get(keys),
  set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
  remove: (keys: string | string[]) => chrome.storage.local.remove(keys),
};

async function recoveryKey() {
  const current = (await chrome.storage.local.get(TRACE_RECOVERY_KEY_STORAGE))[
    TRACE_RECOVERY_KEY_STORAGE
  ];
  if (typeof current === "string" && current.length > 0) return current;
  const created = await createRecoveryKey();
  await chrome.storage.local.set({ [TRACE_RECOVERY_KEY_STORAGE]: created });
  return created;
}

async function requestWithRetry(
  cloud: CloudAuthenticatedFetch,
  path: string,
  init: RequestInit,
) {
  let response: Response | null = null;
  let lastError: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      response = await cloud.request(path, init);
      if (response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response) throw lastError;
  return response;
}

function screenshots(entries: TraceEntry[]) {
  const values: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (entry.perception?.screenshotDataUrl)
      values.push({
        turnNumber: entry.turnNumber,
        kind: "perception",
        dataUrl: entry.perception.screenshotDataUrl,
      });
    for (const capture of [
      entry.pageState?.preDecision,
      entry.pageState?.postTool,
    ])
      for (const screenshot of capture?.screenshots ?? [])
        values.push(screenshot as unknown as Record<string, unknown>);
  }
  return values;
}

export type PreparedCloudTrace = {
  header: EncryptedTraceHeader;
  envelope: Uint8Array;
};

export async function prepareCompletedTrace(
  session: TraceSession,
  entries: TraceEntry[],
): Promise<PreparedCloudTrace | null> {
  const settings = (await chrome.storage.sync.get("userSettings"))
    .userSettings as UserSettings | undefined;
  if (settings?.traceSyncEnabled !== true) return null;
  const bundle: Record<string, unknown> = {
    schemaVersion: "2026-05-30",
    traceKind: "trace.viewer.frozen_bundle",
    frozenAt: new Date().toISOString(),
    session: {
      ...session,
      id: session.sessionId,
      task: session.query,
      startedAt: new Date(session.startTime).toISOString(),
    },
    entries,
    screenshots: screenshots(entries),
  };
  const envelope = await encryptTraceBundle(bundle, await recoveryKey());
  const header = inspectEncryptedTrace(envelope);
  return { header, envelope };
}

export async function uploadPreparedTrace({
  header,
  envelope,
}: PreparedCloudTrace) {
  const cloud = new CloudAuthenticatedFetch(storage, API_ORIGIN);
  const intent = await requestWithRetry(cloud, "/traces/upload-intents", {
    method: "POST",
    body: JSON.stringify({
      traceId: header.traceId,
      title: header.title,
      createdAt: header.createdAt,
      entryCount: header.entryCount,
      screenshotCount: header.screenshotCount,
      bundleSchemaVersion: header.bundleSchemaVersion,
      keyFingerprint: header.keyFingerprint,
      ciphertextSizeBytes: envelope.byteLength,
    }),
  });
  if (!intent.ok)
    throw new Error(`trace_upload_intent_failed_${intent.status}`);
  const urls = (await intent.json()) as {
    uploadUrl: string;
    commitUrl: string;
  };
  const uploaded = await requestWithRetry(
    cloud,
    urls.uploadUrl.replace("/api/v1", ""),
    {
      method: "PUT",
      headers: { "content-type": "application/vnd.opensidebar.trace" },
      body: new Uint8Array(envelope).buffer,
    },
  );
  if (!uploaded.ok) throw new Error(`trace_upload_failed_${uploaded.status}`);
  const digest = ((await uploaded.json()) as { ciphertextSha256: string })
    .ciphertextSha256;
  const committed = await requestWithRetry(
    cloud,
    urls.commitUrl.replace("/api/v1", ""),
    {
      method: "POST",
      body: JSON.stringify({ ciphertextSha256: digest }),
    },
  );
  if (!committed.ok) throw new Error(`trace_commit_failed_${committed.status}`);
  logger.info("trace", "Encrypted trace uploaded", {
    sessionId: header.traceId,
    ciphertextSizeBytes: envelope.byteLength,
  });
  return { kind: "uploaded" as const };
}

export async function uploadCompletedTrace(
  session: TraceSession,
  entries: TraceEntry[],
) {
  const prepared = await prepareCompletedTrace(session, entries);
  return prepared
    ? uploadPreparedTrace(prepared)
    : { kind: "disabled" as const };
}
