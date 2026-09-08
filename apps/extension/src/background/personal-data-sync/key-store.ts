const DB_NAME = "opensidebar-personal-data-crypto";
const STORE_NAME = "keys";

export interface PersonalDataKeyStore {
  get<T>(id: string): Promise<T | null>;
  set<T>(id: string, value: T): Promise<void>;
  remove(id: string): Promise<void>;
}

export class IndexedDbPersonalDataKeyStore implements PersonalDataKeyStore {
  private open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async get<T>(id: string): Promise<T | null> {
    const db = await this.open();
    return new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }
  async set<T>(id: string, value: T): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }
  async remove(id: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    }).finally(() => db.close());
  }
}
