import type {
  PersonalDataCategory,
  PersonalDataDocumentEnvelopeV1,
  PersonalDataWrappedKeyV1,
} from "@shared-types";
import type { PersonalDataKeyStore } from "./key-store";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (value: ArrayBuffer | Uint8Array) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
const unb64 = (value: string) => {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (item) => item.charCodeAt(0));
};
const devicePrivateId = (accountId: string) => `device-private:${accountId}`;
const devicePublicId = (accountId: string) => `device-public:${accountId}`;
const localWrapId = (accountId: string) => `local-wrap:${accountId}`;
const wrappedPdkId = (accountId: string) => `wrapped-pdk:${accountId}`;

export async function ensureDeviceIdentity(store: PersonalDataKeyStore, accountId: string) {
  let privateKey = await store.get<CryptoKey>(devicePrivateId(accountId));
  let publicKey = await store.get<CryptoKey>(devicePublicId(accountId));
  if (!privateKey || !publicKey) {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    await store.set(devicePrivateId(accountId), privateKey);
    await store.set(devicePublicId(accountId), publicKey);
  }
  return { privateKey, publicKey, publicKeyJwk: await crypto.subtle.exportKey("jwk", publicKey) };
}

async function localWrappingKey(store: PersonalDataKeyStore, accountId: string) {
  let key = await store.get<CryptoKey>(localWrapId(accountId));
  if (!key) {
    key = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
    await store.set(localWrapId(accountId), key);
  }
  return key;
}

export async function createAndStorePersonalDataKey(store: PersonalDataKeyStore, accountId: string) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await persistPersonalDataKey(store, accountId, key);
  return key;
}

export async function persistPersonalDataKey(store: PersonalDataKeyStore, accountId: string, key: CryptoKey) {
  const wrapped = await crypto.subtle.wrapKey("raw", key, await localWrappingKey(store, accountId), "AES-KW");
  await store.set(wrappedPdkId(accountId), b64(wrapped));
}

export async function loadPersonalDataKey(store: PersonalDataKeyStore, accountId: string) {
  const wrapped = await store.get<string>(wrappedPdkId(accountId));
  if (!wrapped) return null;
  return crypto.subtle.unwrapKey("raw", unb64(wrapped), await localWrappingKey(store, accountId), "AES-KW",
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

const aad = (accountId: string, category: PersonalDataCategory, revision: number, keyEpoch: number) =>
  encoder.encode(JSON.stringify({ accountId, category, revision, keyEpoch, schemaVersion: 1 }));

export async function encryptPersonalData(input: { accountId: string; category: PersonalDataCategory; revision: number; keyEpoch: number; value: unknown; key: CryptoKey }): Promise<PersonalDataDocumentEnvelopeV1> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce,
    additionalData: aad(input.accountId, input.category, input.revision, input.keyEpoch) }, input.key,
    encoder.encode(JSON.stringify(input.value)));
  return { schemaVersion: 1, algorithm: "AES-256-GCM", category: input.category,
    revision: input.revision, keyEpoch: input.keyEpoch, nonce: b64(nonce), ciphertext: b64(ciphertext) };
}

export async function decryptPersonalData<T>(input: { accountId: string; envelope: PersonalDataDocumentEnvelopeV1; key: CryptoKey }): Promise<T> {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(input.envelope.nonce),
    additionalData: aad(input.accountId, input.envelope.category, input.envelope.revision, input.envelope.keyEpoch) },
    input.key, unb64(input.envelope.ciphertext));
  return JSON.parse(decoder.decode(plaintext)) as T;
}

async function transferWrappingKey(privateKey: CryptoKey, publicKeyJwk: JsonWebKey, salt: Uint8Array) {
  const publicKey = await crypto.subtle.importKey("jwk", publicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt).buffer, info: encoder.encode("opensidebar-personal-data-key-v1") },
    material, { name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}

export async function wrapPersonalDataKeyForDevice(input: { key: CryptoKey; recipientPublicKeyJwk: JsonWebKey; senderDeviceId: string; recipientDeviceId: string; keyEpoch: number }): Promise<PersonalDataWrappedKeyV1> {
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const wrapping = await transferWrappingKey(ephemeral.privateKey, input.recipientPublicKeyJwk, salt);
  const wrapped = await crypto.subtle.wrapKey("raw", input.key, wrapping, "AES-KW");
  return { schemaVersion: 1, algorithm: "ECDH-P256+HKDF-SHA256+A256KW", keyEpoch: input.keyEpoch,
    senderDeviceId: input.senderDeviceId, recipientDeviceId: input.recipientDeviceId,
    senderEphemeralPublicKeyJwk: await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
    salt: b64(salt), wrappedPersonalDataKey: b64(wrapped) };
}

export async function unwrapPersonalDataKeyFromDevice(store: PersonalDataKeyStore, accountId: string, wrapped: PersonalDataWrappedKeyV1) {
  const identity = await ensureDeviceIdentity(store, accountId);
  const wrapping = await transferWrappingKey(identity.privateKey, wrapped.senderEphemeralPublicKeyJwk, unb64(wrapped.salt));
  const key = await crypto.subtle.unwrapKey("raw", unb64(wrapped.wrappedPersonalDataKey), wrapping, "AES-KW",
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await persistPersonalDataKey(store, accountId, key);
  return key;
}

export async function clearPersonalDataKeys(store: PersonalDataKeyStore, accountId: string) {
  await Promise.all([devicePrivateId(accountId), devicePublicId(accountId), localWrapId(accountId), wrappedPdkId(accountId)]
    .map((id) => store.remove(id)));
}
