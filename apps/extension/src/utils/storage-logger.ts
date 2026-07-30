/**
 * Storage Logger - persists structured logs to chrome.storage.local
 *
 * Uses a ring buffer with a fixed cap (MAX_ENTRIES). Old entries roll off
 * automatically. Writes are batched to avoid hammering storage on every call.
 *
 * Sensitive data (API keys, tokens) is automatically redacted before storage.
 */

import type { LogLevel, LogSource, LogCategory } from "./logger";

export interface StorageLogEntry {
  ts: string;
  lvl: LogLevel;
  src: LogSource;
  cat: LogCategory;
  msg: string;
  rid?: string;
  sid?: string;
  data?: Record<string, unknown>;
}

export interface StorageLoggerStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  remove(keys: string | string[]): Promise<void>;
}

const STORAGE_KEY = "opensidebar_logs";
const MAX_ENTRIES = 2000;
const FLUSH_INTERVAL = 5000;
const FLUSH_SIZE = 20;

/**
 * Sanitize sensitive data from log payloads.
 * Redacts keys containing apikey, api_key, token, secret, password.
 * Strips query params from URLs only when param names look auth-related.
 */
export function sanitizeData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return undefined;

  const sensitiveKeys = /apikey|api_key|token|secret|password/i;
  const sensitiveParams = /token|key|secret|auth|session|password/i;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (sensitiveKeys.test(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    if (value instanceof Error) {
      sanitized[key] = {
        message: value.message,
        name: value.name,
        stack: value.stack,
      };
      continue;
    }

    if (typeof value === "string" && value.startsWith("http")) {
      try {
        const url = new URL(value);
        let stripped = false;
        for (const param of url.searchParams.keys()) {
          if (sensitiveParams.test(param)) {
            url.searchParams.delete(param);
            stripped = true;
          }
        }
        sanitized[key] = stripped ? url.toString() : value;
        continue;
      } catch {
        // Not a valid URL, keep as-is
      }
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

class StorageLogger {
  private buffer: StorageLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;

  /**
   * Check if chrome.storage.local is available
   */
  private isAvailable(): boolean {
    return (
      typeof chrome !== "undefined" &&
      chrome.storage !== undefined &&
      chrome.storage.local !== undefined
    );
  }

  /**
   * Add a log entry to the buffer. Triggers flush when threshold is met.
   */
  push(entry: StorageLogEntry): void {
    if (!this.isAvailable()) return;

    this.buffer.push(entry);

    if (this.buffer.length >= FLUSH_SIZE) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL);
    }
  }

  /**
   * Flush buffered entries to chrome.storage.local
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.isFlushing || this.buffer.length === 0 || !this.isAvailable())
      return;

    this.isFlushing = true;
    const entries = this.buffer.splice(0);

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const existing: StorageLogEntry[] = result[STORAGE_KEY] || [];
      const merged = [...existing, ...entries];

      // Ring buffer: keep only the newest MAX_ENTRIES
      const trimmed =
        merged.length > MAX_ENTRIES
          ? merged.slice(merged.length - MAX_ENTRIES)
          : merged;

      await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
    } catch {
      // Storage write failed - drop entries rather than retrying forever
    } finally {
      this.isFlushing = false;

      // Best-effort drain to local log server for disk persistence
      this.drainToServer(entries);

      // Flush any entries that arrived during the write
      if (this.buffer.length >= FLUSH_SIZE) {
        this.flush();
      }
    }
  }

  /**
   * Fire-and-forget POST to the local log server.
   * Silent fail when server isn't running (connection-refused resolves in <1ms).
   * Compiled out of production builds — the shipped extension must never
   * call localhost (dev observability only).
   */
  private drainToServer(entries: StorageLogEntry[]): void {
    if (typeof __DEV__ !== "undefined" && !__DEV__) return;
    const serverUrl =
      typeof __LOCAL_OBSERVABILITY_SERVER_URL__ === "string"
        ? __LOCAL_OBSERVABILITY_SERVER_URL__.replace(/\/+$/, "")
        : "";
    if (!serverUrl) return;
    try {
      fetch(`${serverUrl}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries),
        signal: AbortSignal.timeout(2000),
      }).catch(() => {});
    } catch {
      // fetch itself may throw in some contexts - ignore
    }
  }

  /**
   * Get all stored log entries
   */
  async getAll(
    storage: StorageLoggerStorageArea | null = null,
  ): Promise<StorageLogEntry[]> {
    if (!storage && !this.isAvailable()) return [];

    try {
      const result = storage
        ? await storage.get(STORAGE_KEY)
        : await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || [];
    } catch {
      return [];
    }
  }

  /**
   * Clear all stored logs
   */
  async clear(storage: StorageLoggerStorageArea | null = null): Promise<void> {
    if (!storage && !this.isAvailable()) return;

    try {
      if (storage) {
        await storage.remove(STORAGE_KEY);
      } else {
        await chrome.storage.local.remove(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Export logs as a downloadable JSONL blob URL
   */
  async exportAsJsonl(
    storage: StorageLoggerStorageArea | null = null,
  ): Promise<string> {
    const entries = await this.getAll(storage);
    const lines = entries.map((e) => JSON.stringify(e)).join("\n");
    const blob = new Blob([lines], { type: "application/x-ndjson" });
    return URL.createObjectURL(blob);
  }
}

export const storageLogger = new StorageLogger();
