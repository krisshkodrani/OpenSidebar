/**
 * Structured Logger for OpenSidebar
 *
 * - Auto-detects execution context (background/content/sidepanel/offscreen)
 * - Color-coded, collapsible DevTools output
 * - Uses console.warn / console.error for appropriate levels
 * - DEBUG logs stripped in production via __DEV__ gate
 * - Persists to chrome.storage.local via StorageLogger ring buffer
 * - Scoped loggers carry requestId for cross-context tracing
 */

import { storageLogger, sanitizeData, type StorageLogEntry } from "./storage-logger";

declare const __DEV__: boolean;

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogSource = "background" | "content" | "sidepanel" | "offscreen";

export type LogCategory =
  | "agent"
  | "memory"
  | "tools"
  | "ui"
  | "system"
  | "navigation"
  | "workspace"
  | "keepalive"
  | "sidebar";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: LogSource;
  category: LogCategory;
  requestId?: string;
  message: string;
  data?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class Logger {
  private source: LogSource;
  private minLevel: LogLevel = (typeof __DEV__ !== "undefined" && __DEV__) ? "DEBUG" : "INFO";

  constructor() {
    this.source = this.detectSource();
  }

  private detectSource(): LogSource {
    if (typeof chrome !== "undefined" && chrome.runtime) {
      const url = typeof window !== "undefined" ? window.location.href : "";
      if (url.includes("sidepanel")) return "sidepanel";
      if (url.includes("offscreen")) return "offscreen";
      if (url.startsWith("http")) return "content";
      if (typeof window === "undefined") return "background";
    }
    if (typeof self !== "undefined" && typeof window === "undefined") {
      return "background";
    }
    return "content";
  }

  /**
   * Set minimum log level at runtime.
   * Useful for debugging production: window.__logger.setLevel("DEBUG")
   */
  public setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Create a scoped logger that automatically attaches a requestId.
   */
  public withRequestId(requestId: string): ScopedLogger {
    return new ScopedLogger(this, requestId);
  }

  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
    requestId?: string,
  ) {
    // Level gate
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      source: this.source,
      category,
      requestId,
      message,
      data,
    };

    // Persist to chrome.storage.local (async, non-blocking)
    const storageEntry: StorageLogEntry = {
      ts: entry.ts,
      lvl: level,
      src: this.source,
      cat: category,
      msg: message,
      rid: requestId,
      data: sanitizeData(data),
    };
    storageLogger.push(storageEntry);

    // DevTools styling
    const colorMap: Record<LogSource, string> = {
      background:
        "background: #0ea5e9; color: white; padding: 2px 4px; border-radius: 2px;",
      content:
        "background: #22c55e; color: white; padding: 2px 4px; border-radius: 2px;",
      sidepanel:
        "background: #a855f7; color: white; padding: 2px 4px; border-radius: 2px;",
      offscreen:
        "background: #f59e0b; color: white; padding: 2px 4px; border-radius: 2px;",
    };

    const levelIcon: Record<LogLevel, string> = {
      DEBUG: "🐛",
      INFO: "ℹ️",
      WARN: "⚠️",
      ERROR: "🚨",
    };

    const prefix = `%c${this.source}%c ${levelIcon[level]} [${category}] ${message}`;
    const styles = [
      colorMap[this.source],
      "color: inherit; background: transparent;",
    ];

    // Pick the right console method for proper DevTools filtering
    /* eslint-disable no-console -- Logger must use console for DevTools output */
    const consoleFn =
      level === "ERROR" ? console.error
      : level === "WARN" ? console.warn
      : console.log;

    if (data || requestId) {
      console.groupCollapsed(prefix, ...styles);
      consoleFn("Details:", entry);
      if (requestId) consoleFn("Request ID:", requestId);
      if (data) consoleFn("Payload:", data);
      if (data && data.error && (data as any).stack) console.error((data as any).stack);
      console.groupEnd();
    } else {
      consoleFn(prefix, ...styles);
    }
    /* eslint-enable no-console */
  }

  public debug(
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
    requestId?: string,
  ) {
    this.log("DEBUG", category, message, data, requestId);
  }

  public info(
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
    requestId?: string,
  ) {
    this.log("INFO", category, message, data, requestId);
  }

  public warn(
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
    requestId?: string,
  ) {
    this.log("WARN", category, message, data, requestId);
  }

  public error(
    category: LogCategory,
    message: string,
    data?: Record<string, unknown>,
    requestId?: string,
  ) {
    this.log("ERROR", category, message, data, requestId);
  }
}

/**
 * Scoped logger that automatically attaches a requestId to every call.
 * Created via logger.withRequestId(id).
 */
export class ScopedLogger {
  constructor(
    private parent: Logger,
    private requestId: string,
  ) {}

  public debug(category: LogCategory, message: string, data?: Record<string, unknown>) {
    this.parent.debug(category, message, data, this.requestId);
  }

  public info(category: LogCategory, message: string, data?: Record<string, unknown>) {
    this.parent.info(category, message, data, this.requestId);
  }

  public warn(category: LogCategory, message: string, data?: Record<string, unknown>) {
    this.parent.warn(category, message, data, this.requestId);
  }

  public error(category: LogCategory, message: string, data?: Record<string, unknown>) {
    this.parent.error(category, message, data, this.requestId);
  }
}

export const logger = new Logger();
