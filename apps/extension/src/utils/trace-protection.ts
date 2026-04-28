export interface TraceRedactionOptions {
  mode?: "runtime" | "export";
  maxStringLength?: number;
}

const RUNTIME_SECRET_KEY =
  /^(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|password|passcode|credential|credentials|cookie|set-cookie|private[_-]?key|client[_-]?secret|secret[_-]?key)$/i;

const EXPORT_SENSITIVE_KEY = /^(email|phone|address|recipient|sender)$/i;

const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const OPENAI_STYLE_KEY = /\b(sk|fk)-[A-Za-z0-9_-]{16,}\b/g;
const LONG_JWT =
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const DATA_URL_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function shouldRedactKey(key: string, mode: "runtime" | "export"): boolean {
  if (RUNTIME_SECRET_KEY.test(key)) return true;
  return mode === "export" && EXPORT_SENSITIVE_KEY.test(key);
}

function redactString(
  value: string,
  mode: "runtime" | "export",
  maxStringLength: number,
): string {
  let redacted = value
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(OPENAI_STYLE_KEY, "$1-[REDACTED]")
    .replace(LONG_JWT, "[REDACTED_JWT]");

  if (mode === "export") {
    redacted = redacted.replace(EMAIL, "[REDACTED_EMAIL]");
    if (DATA_URL_IMAGE.test(redacted)) return "[REDACTED_IMAGE_DATA_URL]";
  }

  if (DATA_URL_IMAGE.test(redacted)) return redacted;

  if (redacted.length > maxStringLength) {
    return `${redacted.slice(0, maxStringLength)}...[TRUNCATED ${redacted.length - maxStringLength} chars]`;
  }

  return redacted;
}

export function redactTracePayload<T>(
  value: T,
  options: TraceRedactionOptions = {},
): T {
  const mode = options.mode ?? "runtime";
  const maxStringLength = options.maxStringLength ?? 200_000;
  const seen = new WeakSet<object>();

  function visit(current: unknown, key = ""): unknown {
    if (typeof current === "string") {
      if (shouldRedactKey(key, mode)) return "[REDACTED]";
      return redactString(current, mode, maxStringLength);
    }
    if (
      current === null ||
      typeof current === "number" ||
      typeof current === "boolean" ||
      typeof current === "undefined"
    ) {
      return current;
    }
    if (Array.isArray(current)) {
      return current.map((item) => visit(item));
    }
    if (typeof current === "object") {
      if (seen.has(current)) return "[Circular]";
      seen.add(current);
      const out: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of Object.entries(
        current as Record<string, unknown>,
      )) {
        out[entryKey] = shouldRedactKey(entryKey, mode)
          ? "[REDACTED]"
          : visit(entryValue, entryKey);
      }
      return out;
    }
    return current;
  }

  return visit(value) as T;
}
