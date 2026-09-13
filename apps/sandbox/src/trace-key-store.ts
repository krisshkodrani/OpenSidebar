const DATABASE = "opensidebar-private-keys";
const STORE = "keys";
const RECOVERY_KEY = "trace-recovery-v1";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open private key storage."));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Private key storage failed."));
    });
  } finally {
    db.close();
  }
}

export async function readTraceRecoveryKey() {
  const value = await transaction("readonly", (store) =>
    store.get(RECOVERY_KEY),
  );
  return typeof value === "string" ? value : "";
}

export async function writeTraceRecoveryKey(value: string) {
  await transaction("readwrite", (store) => store.put(value, RECOVERY_KEY));
}
