import type { TraceEntry, TraceSession } from "@shared-types";
import type { EncryptedTraceHeader } from "@trace-sync";
import {
  prepareCompletedTrace,
  uploadPreparedTrace,
  type PreparedCloudTrace,
} from "./cloud-trace-sync";
import { logger } from "../utils";

const DATABASE = "opensidebar-cloud-traces";
const STORE = "upload-queue";
const PAUSED_KEY = "cloudTraceUploadsPausedV1";
const ALARM = "cloud-trace-upload-queue";
const GRACE_MS = 30_000;

export type CloudTraceQueueItem = {
  traceId: string;
  title: string;
  createdAt: string;
  ciphertextSizeBytes: number;
  state: "waiting" | "retrying";
  attempts: number;
  lastError?: string;
};

type StoredItem = CloudTraceQueueItem & {
  header: EncryptedTraceHeader;
  envelope: ArrayBuffer;
  availableAfter: number;
};

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "traceId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("trace_queue_open_failed"));
  });
}

async function operation<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      let result!: T;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () =>
        reject(
          transaction.error ??
            request.error ??
            new Error("trace_queue_operation_failed"),
        );
    });
  } finally {
    db.close();
  }
}

const publicItem = ({
  header: _header,
  envelope: _envelope,
  availableAfter: _availableAfter,
  ...item
}: StoredItem): CloudTraceQueueItem => item;

export async function traceQueuePaused() {
  return (await chrome.storage.local.get(PAUSED_KEY))[PAUSED_KEY] === true;
}

export async function setTraceQueuePaused(paused: boolean) {
  await chrome.storage.local.set({ [PAUSED_KEY]: paused });
  if (!paused) await drainCloudTraceQueue();
}

export async function listCloudTraceQueue() {
  const items = await operation<StoredItem[]>("readonly", (store) =>
    store.getAll(),
  );
  return items
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicItem);
}

export async function excludeQueuedTrace(traceId: string) {
  await operation("readwrite", (store) => store.delete(traceId));
}

export async function enqueueCompletedTrace(
  session: TraceSession,
  entries: TraceEntry[],
) {
  const prepared = await prepareCompletedTrace(session, entries);
  if (!prepared) return { kind: "disabled" as const };
  const item: StoredItem = {
    traceId: prepared.header.traceId,
    title: prepared.header.title,
    createdAt: prepared.header.createdAt,
    ciphertextSizeBytes: prepared.envelope.byteLength,
    state: "waiting",
    attempts: 0,
    header: prepared.header,
    envelope: new Uint8Array(prepared.envelope).buffer,
    availableAfter: Date.now() + GRACE_MS,
  };
  await operation("readwrite", (store) => store.put(item));
  chrome.alarms?.create(ALARM, { delayInMinutes: 1 });
  return { kind: "queued" as const };
}

let activeDrain: Promise<{ uploaded: number; failed: number }> | null = null;

async function performDrain(options: { force?: boolean } = {}) {
  if (await traceQueuePaused()) return { uploaded: 0, failed: 0 };
  const items = await operation<StoredItem[]>("readonly", (store) =>
    store.getAll(),
  );
  let uploaded = 0,
    failed = 0;
  for (const item of items) {
    if (!options.force && item.availableAfter > Date.now()) continue;
    const prepared: PreparedCloudTrace = {
      header: item.header,
      envelope: new Uint8Array(item.envelope),
    };
    try {
      await uploadPreparedTrace(prepared);
      await excludeQueuedTrace(item.traceId);
      uploaded += 1;
    } catch (error) {
      failed += 1;
      await operation("readwrite", (store) =>
        store.put({
          ...item,
          state: "retrying",
          attempts: item.attempts + 1,
          lastError: error instanceof Error ? error.message : "upload_failed",
          availableAfter:
            Date.now() +
            Math.min(60 * 60_000, 30_000 * 2 ** Math.min(item.attempts, 7)),
        }),
      );
    }
  }
  if (failed) chrome.alarms?.create(ALARM, { delayInMinutes: 1 });
  return { uploaded, failed };
}

export function drainCloudTraceQueue(options: { force?: boolean } = {}) {
  if (activeDrain) return activeDrain;
  activeDrain = performDrain(options).finally(() => {
    activeDrain = null;
  });
  return activeDrain;
}

if (typeof chrome !== "undefined" && chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM)
      void drainCloudTraceQueue().catch((error) =>
        logger.warn("trace", "Trace queue drain failed", { error }),
      );
  });
}
