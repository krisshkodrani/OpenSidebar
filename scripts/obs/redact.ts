/**
 * PII redaction for the agent-facing observability surface (RFC LP-8, M1
 * "Lockdown").
 *
 * The obs MCP server (scripts/obs/mcp-server.ts) exposes full trace entries to
 * any agent registered in `.mcp.json`. Trace content can embed personal data —
 * values typed into forms during a run, and (on the future consent path)
 * injected profile items. We scrub common PII shapes from the agent-facing
 * payload so the obs tools never hand raw PII to a calling agent.
 *
 * Scope: applied only at the MCP/agent boundary (`dispatch`). The human trace
 * viewer and the canonical span spine keep full fidelity. `get_blob` (a base64
 * screenshot) is exempt — it is binary, not text, and must not be regex-mangled.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD = /\b(?:\d[ -]?){13,16}\b/g;
const PHONE = /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export function redactPiiInText(text: string): string {
  return text
    .replace(EMAIL, "[redacted:email]")
    .replace(SSN, "[redacted:ssn]")
    .replace(CREDIT_CARD, "[redacted:cc]")
    .replace(PHONE, "[redacted:phone]");
}

/** Recursively redact PII in every string within a JSON-serializable value. */
export function redactPii<T>(value: T): T {
  if (typeof value === "string") {
    return redactPiiInText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPii(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactPii(val);
    }
    return out as unknown as T;
  }
  return value;
}
