/**
 * At-rest encryption for sensitive profile data (RFC LP-8, M1 "Lockdown").
 *
 * Only `sensitive`-kind digest item values (and source quotes) are encrypted;
 * the rest of the personalization state stays plaintext so the common read path
 * is fast and diffable. Encryption is AES-GCM via WebCrypto. The content key
 * lives in `chrome.storage.local` (never synced) under its own key, separate
 * from the profile blob.
 *
 * Threat model: stop plaintext PII from sitting in the profile record on disk /
 * in an exported storage dump, and keep the key out of `chrome.storage.sync`
 * (Google cloud). It is not a defense against a determined local attacker who
 * already has both the key and the blob.
 *
 * Wire format for an encrypted field: `enc:v1:<ivBase64>.<ciphertextBase64>`.
 */

import type { PersonalProfileStorage } from "./personal-profile";

export const PROFILE_CEK_STORAGE_KEY = "opensidebar:personalProfile:cek";

const ENC_PREFIX = "enc:v1:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEncryptedValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error("WebCrypto SubtleCrypto is unavailable in this context.");
  }
  return c.subtle;
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Load the content-encryption key, generating + persisting one on first use. */
export async function getProfileEncryptionKey(
  storage: PersonalProfileStorage,
): Promise<CryptoKey> {
  const stored = await storage.local.get(PROFILE_CEK_STORAGE_KEY);
  const existing = stored[PROFILE_CEK_STORAGE_KEY];
  if (typeof existing === "string" && existing.length > 0) {
    return subtle().importKey(
      "raw",
      b64ToBytes(existing),
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
  }
  const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = await subtle().exportKey("raw", key);
  await storage.local.set({ [PROFILE_CEK_STORAGE_KEY]: bufToB64(raw) });
  return key;
}

export async function encryptField(
  key: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = (globalThis.crypto as Crypto).getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    new Uint8Array(new TextEncoder().encode(plaintext)),
  );
  return `${ENC_PREFIX}${bufToB64(iv)}.${bufToB64(ct)}`;
}

export async function decryptField(
  key: CryptoKey,
  payload: string,
): Promise<string> {
  if (!isEncryptedValue(payload)) return payload;
  const body = payload.slice(ENC_PREFIX.length);
  const dot = body.indexOf(".");
  if (dot < 0) throw new Error("Malformed encrypted profile field.");
  const iv = b64ToBytes(body.slice(0, dot));
  const ct = b64ToBytes(body.slice(dot + 1));
  const pt = await subtle().decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

const SENSITIVE_FIELDS = ["value", "sourceQuote"] as const;

function digestItems(raw: unknown): Record<string, unknown>[] | null {
  if (!isRecord(raw)) return null;
  const digest = raw.digest;
  if (!isRecord(digest) || !Array.isArray(digest.items)) return null;
  return digest.items.filter(isRecord) as Record<string, unknown>[];
}

function needsNotesEncrypt(state: unknown): boolean {
  return (
    isRecord(state) &&
    typeof state.notesMarkdown === "string" &&
    state.notesMarkdown.length > 0 &&
    !isEncryptedValue(state.notesMarkdown)
  );
}

function needsItemsEncrypt(items: Record<string, unknown>[] | null): boolean {
  return (
    !!items &&
    items.some(
      (it) =>
        it.kind === "sensitive" &&
        SENSITIVE_FIELDS.some(
          (f) => typeof it[f] === "string" && !isEncryptedValue(it[f]),
        ),
    )
  );
}

/**
 * Encrypt sensitive data in a plaintext state for storage: the free-text
 * `notesMarkdown` (the canonical sensitive source) and each `sensitive`-kind
 * digest item's value/sourceQuote. Returns a clone with ciphertext; the input is
 * not mutated. No-op (and no key created) when there is nothing to protect.
 */
export async function encryptStateForStorage(
  state: unknown,
  storage: PersonalProfileStorage,
): Promise<unknown> {
  if (!isRecord(state)) return state;
  const items = digestItems(state);
  const encryptNotes = needsNotesEncrypt(state);
  const encryptItems = needsItemsEncrypt(items);
  if (!encryptNotes && !encryptItems) return state;

  const key = await getProfileEncryptionKey(storage);
  const next: Record<string, unknown> = { ...state };
  if (encryptNotes) {
    next.notesMarkdown = await encryptField(key, state.notesMarkdown as string);
  }
  if (encryptItems) {
    const digest = state.digest as Record<string, unknown>;
    const nextItems = await Promise.all(
      (digest.items as unknown[]).map(async (it) => {
        if (!isRecord(it) || it.kind !== "sensitive") return it;
        const item: Record<string, unknown> = { ...it };
        for (const f of SENSITIVE_FIELDS) {
          if (typeof item[f] === "string" && !isEncryptedValue(item[f])) {
            item[f] = await encryptField(key, item[f] as string);
          }
        }
        return item;
      }),
    );
    next.digest = { ...digest, items: nextItems };
  }
  return next;
}

/**
 * Decrypt sensitive data in a raw stored state, BEFORE schema normalization (so
 * length truncation applies to plaintext, never ciphertext). Returns the input
 * unchanged when nothing is encrypted.
 */
export async function decryptStoredState(
  raw: unknown,
  storage: PersonalProfileStorage,
): Promise<unknown> {
  if (!isRecord(raw)) return raw;
  const items = digestItems(raw);
  const decryptNotes = isEncryptedValue(raw.notesMarkdown);
  const decryptItems =
    !!items &&
    items.some(
      (it) =>
        it.kind === "sensitive" && SENSITIVE_FIELDS.some((f) => isEncryptedValue(it[f])),
    );
  if (!decryptNotes && !decryptItems) return raw;

  const key = await getProfileEncryptionKey(storage);
  const next: Record<string, unknown> = { ...raw };
  if (decryptNotes) {
    next.notesMarkdown = await decryptField(key, raw.notesMarkdown as string);
  }
  if (decryptItems) {
    const digest = raw.digest as Record<string, unknown>;
    const nextItems = await Promise.all(
      (digest.items as unknown[]).map(async (it) => {
        if (!isRecord(it) || it.kind !== "sensitive") return it;
        const item: Record<string, unknown> = { ...it };
        for (const f of SENSITIVE_FIELDS) {
          if (isEncryptedValue(item[f])) {
            item[f] = await decryptField(key, item[f] as string);
          }
        }
        return item;
      }),
    );
    next.digest = { ...digest, items: nextItems };
  }
  return next;
}
