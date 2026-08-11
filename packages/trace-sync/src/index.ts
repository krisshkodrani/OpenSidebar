const MAGIC = "OS-TRACE-1\n";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type TraceBundleSummary = {
  traceId: string;
  title: string;
  createdAt: string;
  entryCount: number;
  screenshotCount: number;
  bundleSchemaVersion: string;
};

export type EncryptedTraceHeader = TraceBundleSummary & {
  envelopeVersion: 1;
  algorithm: "AES-256-GCM+A256KW";
  keyFingerprint: string;
  iv: string;
  wrappedDataKey: string;
};

export type DecryptedTrace = {
  header: EncryptedTraceHeader;
  bundle: Record<string, unknown>;
};

const base64url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

const fromBase64url = (value: string) => {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const bytes = (value: ArrayBuffer) => new Uint8Array(value);

export async function createRecoveryKey(): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return base64url(raw);
}

export async function recoveryKeyFingerprint(
  recoveryKey: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    fromBase64url(recoveryKey),
  );
  return base64url(bytes(digest).slice(0, 16));
}

function assertRecoveryKey(value: string) {
  const raw = fromBase64url(value);
  if (raw.byteLength !== 32)
    throw new Error("Recovery key must contain 256 bits.");
  return raw;
}

export function summarizeTraceBundle(
  bundle: Record<string, unknown>,
): TraceBundleSummary {
  const session =
    bundle.session && typeof bundle.session === "object"
      ? (bundle.session as Record<string, unknown>)
      : {};
  const entries = Array.isArray(bundle.entries) ? bundle.entries : [];
  const screenshots = Array.isArray(bundle.screenshots)
    ? bundle.screenshots
    : [];
  const traceId = String(session.id ?? bundle.traceId ?? "").trim();
  if (!traceId) throw new Error("Trace bundle is missing a trace id.");
  return {
    traceId,
    title: String(session.task ?? session.title ?? "Untitled trace").slice(
      0,
      240,
    ),
    createdAt: String(
      session.startedAt ?? session.createdAt ?? new Date().toISOString(),
    ),
    entryCount: entries.length,
    screenshotCount: screenshots.length,
    bundleSchemaVersion: String(bundle.schemaVersion ?? "unknown"),
  };
}

export async function encryptTraceBundle(
  bundle: Record<string, unknown>,
  recoveryKey: string,
): Promise<Uint8Array> {
  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    assertRecoveryKey(recoveryKey),
    "AES-KW",
    false,
    ["wrapKey"],
  );
  const dataKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const fingerprint = await recoveryKeyFingerprint(recoveryKey);
  const summary = summarizeTraceBundle(bundle);
  const headerBase = {
    ...summary,
    // A task title may contain page content. Keep the server-visible index
    // generic; the real title is recovered from the encrypted bundle.
    title: "Encrypted trace",
    envelopeVersion: 1 as const,
    algorithm: "AES-256-GCM+A256KW" as const,
    keyFingerprint: fingerprint,
    iv: base64url(iv),
  };
  const aad = encoder.encode(JSON.stringify(headerBase));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    dataKey,
    encoder.encode(JSON.stringify(bundle)),
  );
  const wrappedDataKey = await crypto.subtle.wrapKey(
    "raw",
    dataKey,
    wrappingKey,
    "AES-KW",
  );
  const header: EncryptedTraceHeader = {
    ...headerBase,
    wrappedDataKey: base64url(bytes(wrappedDataKey)),
  };
  const prefix = encoder.encode(`${MAGIC}${JSON.stringify(header)}\n`);
  const output = new Uint8Array(prefix.length + ciphertext.byteLength);
  output.set(prefix);
  output.set(bytes(ciphertext), prefix.length);
  return output;
}

function parseEnvelope(envelope: Uint8Array) {
  const probe = decoder.decode(
    envelope.slice(0, Math.min(envelope.length, 16_384)),
  );
  if (!probe.startsWith(MAGIC))
    throw new Error("This is not an OpenSidebar encrypted trace.");
  const end = probe.indexOf("\n", MAGIC.length);
  if (end < 0) throw new Error("Encrypted trace header is incomplete.");
  const header = JSON.parse(
    probe.slice(MAGIC.length, end),
  ) as EncryptedTraceHeader;
  if (header.envelopeVersion !== 1 || header.algorithm !== "AES-256-GCM+A256KW")
    throw new Error("Encrypted trace version is not supported.");
  return {
    header,
    ciphertext: envelope.slice(encoder.encode(probe.slice(0, end + 1)).length),
  };
}

export function inspectEncryptedTrace(
  envelope: Uint8Array,
): EncryptedTraceHeader {
  return parseEnvelope(envelope).header;
}

export async function decryptTraceBundle(
  envelope: Uint8Array,
  recoveryKey: string,
): Promise<DecryptedTrace> {
  const { header, ciphertext } = parseEnvelope(envelope);
  const fingerprint = await recoveryKeyFingerprint(recoveryKey);
  if (fingerprint !== header.keyFingerprint)
    throw new Error("This recovery key cannot unlock the trace.");
  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    assertRecoveryKey(recoveryKey),
    "AES-KW",
    false,
    ["unwrapKey"],
  );
  const dataKey = await crypto.subtle.unwrapKey(
    "raw",
    fromBase64url(header.wrappedDataKey),
    wrappingKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const { wrappedDataKey: _wrapped, ...headerBase } = header;
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64url(header.iv),
      additionalData: encoder.encode(JSON.stringify(headerBase)),
    },
    dataKey,
    ciphertext,
  );
  const bundle = JSON.parse(decoder.decode(plaintext));
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle))
    throw new Error("Decrypted trace bundle is invalid.");
  return { header, bundle };
}
