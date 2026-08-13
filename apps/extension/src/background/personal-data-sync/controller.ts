import type {
  ExtensionSessionV1,
  LocalPersonalDataSyncPreferencesV1,
  PersonalDataCategory,
  PersonalDataConflictV1,
  PersonalDataDocumentEnvelopeV1,
  PersonalDataKeyRequestV1,
  PersonalDataStatusV1,
  SavedPrompt,
  UserWebsiteSkill,
} from "@shared-types";
import { CLOUD_EXTENSION_SESSION_KEY, CloudAuthenticatedFetch } from "../../cloud/authenticated-fetch";
import { chromePersistencePort } from "../environment/chrome";
import {
  loadPersonalizationState,
  savePersonalizationState,
  type PersonalizationState,
} from "../../utils/personal-profile";
import { WEBSITE_SKILLS_STORAGE_KEY } from "../../utils/website-skills";
import { IndexedDbPersonalDataKeyStore } from "./key-store";
import {
  clearPersonalDataKeys,
  createAndStorePersonalDataKey,
  decryptPersonalData,
  encryptPersonalData,
  ensureDeviceIdentity,
  loadPersonalDataKey,
  unwrapPersonalDataKeyFromDevice,
  wrapPersonalDataKeyForDevice,
} from "./crypto";

export const PERSONAL_DATA_SYNC_PREFERENCES_KEY = "opensidebar:personalDataSync:preferences";
export const PERSONAL_DATA_SYNC_CONFLICTS_KEY = "opensidebar:personalDataSync:conflicts";
const SAVED_PROMPTS_KEY = "opensidebar:savedPrompts";
const keyStore = new IndexedDbPersonalDataKeyStore();
const cloud = new CloudAuthenticatedFetch(chromePersistencePort.local);

type CategoryValue = SavedPrompt[] | UserWebsiteSkill[] | PersonalizationState;
type SyncResult = { ok: boolean; detail?: string; status?: PersonalDataStatusV1; conflicts?: PersonalDataConflictV1[] };

const emptyPreferences = (accountId: string): LocalPersonalDataSyncPreferencesV1 => ({
  schemaVersion: 1,
  accountId,
  preferencesEnabled: true,
  categories: { saved_prompts: false, website_skills: false, profile: false },
  lastSyncedRevisions: {},
  lastSyncedHashes: {},
});
const session = async () => (await chromePersistencePort.local.get(CLOUD_EXTENSION_SESSION_KEY))[
  CLOUD_EXTENSION_SESSION_KEY
] as ExtensionSessionV1 | undefined;
const preferences = async (accountId: string) => {
  const value = (await chromePersistencePort.local.get(PERSONAL_DATA_SYNC_PREFERENCES_KEY))[
    PERSONAL_DATA_SYNC_PREFERENCES_KEY
  ] as LocalPersonalDataSyncPreferencesV1 | undefined;
  return value?.schemaVersion === 1 && value.accountId === accountId ? value : emptyPreferences(accountId);
};
const savePreferences = (value: LocalPersonalDataSyncPreferencesV1) =>
  chromePersistencePort.local.set({ [PERSONAL_DATA_SYNC_PREFERENCES_KEY]: value });
const conflicts = async () => ((await chromePersistencePort.local.get(PERSONAL_DATA_SYNC_CONFLICTS_KEY))[
  PERSONAL_DATA_SYNC_CONFLICTS_KEY
] as PersonalDataConflictV1[] | undefined) ?? [];
const saveConflicts = (value: PersonalDataConflictV1[]) =>
  chromePersistencePort.local.set({ [PERSONAL_DATA_SYNC_CONFLICTS_KEY]: value });
const stable = (value: unknown) => JSON.stringify(value, (_, item) => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
});
const hash = async (value: unknown) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
};
const readLocal = async (category: PersonalDataCategory): Promise<CategoryValue> => {
  if (category === "profile") {
    const state = await loadPersonalizationState(chromePersistencePort);
    // updatedAt is local persistence metadata, not part of the synced profile value.
    return { ...state, updatedAt: 0 };
  }
  const key = category === "saved_prompts" ? SAVED_PROMPTS_KEY : WEBSITE_SKILLS_STORAGE_KEY;
  const value = (await chromePersistencePort.local.get(key))[key];
  if (!Array.isArray(value)) return [];
  return category === "saved_prompts"
    ? (value as SavedPrompt[]).filter((item) => !item.id.startsWith("builtin:"))
    : value as UserWebsiteSkill[];
};
const writeLocal = async (category: PersonalDataCategory, value: CategoryValue) => {
  if (category === "profile") {
    const state = value as PersonalizationState;
    await savePersonalizationState({ enabled: state.enabled, notesMarkdown: state.notesMarkdown,
      digest: state.digest, analyzer: state.analyzer }, chromePersistencePort);
    return;
  }
  const key = category === "saved_prompts" ? SAVED_PROMPTS_KEY : WEBSITE_SKILLS_STORAGE_KEY;
  if (category === "saved_prompts") {
    const current = (await chromePersistencePort.local.get(key))[key];
    const builtins = Array.isArray(current)
      ? (current as SavedPrompt[]).filter((item) => item.id.startsWith("builtin:"))
      : [];
    await chromePersistencePort.local.set({ [key]: [...builtins, ...(value as SavedPrompt[])] });
  } else {
    await chromePersistencePort.local.set({ [key]: value });
  }
};
const baseKey = (accountId: string, category: PersonalDataCategory) =>
  `opensidebar:personalDataSync:base:${accountId}:${category}`;
const loadBase = async (accountId: string, category: PersonalDataCategory) =>
  (await chromePersistencePort.local.get(baseKey(accountId, category)))[baseKey(accountId, category)] as CategoryValue | undefined;
const saveBase = (accountId: string, category: PersonalDataCategory, value: CategoryValue) =>
  chromePersistencePort.local.set({ [baseKey(accountId, category)]: value });

function mergeCollections(base: unknown[], local: unknown[], remote: unknown[], category: PersonalDataCategory) {
  const byId = (values: unknown[]) => new Map(values.map((value) => [(value as { id: string }).id, value]));
  const [b, l, r] = [byId(base), byId(local), byId(remote)];
  const merged: unknown[] = [];
  const found: Array<{ entityId: string; localValue: unknown; cloudValue: unknown }> = [];
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const [before, here, there] = [b.get(id), l.get(id), r.get(id)];
    if (stable(here) === stable(there)) { if (here !== undefined) merged.push(here); continue; }
    if (stable(here) === stable(before)) { if (there !== undefined) merged.push(there); continue; }
    if (stable(there) === stable(before)) { if (here !== undefined) merged.push(here); continue; }
    found.push({ entityId: id, localValue: here, cloudValue: there });
  }
  return { merged, conflicts: found.map((item) => ({ schemaVersion: 1 as const, id: crypto.randomUUID(),
    category, ...item, createdAt: new Date().toISOString() })) };
}

async function reconcile(category: PersonalDataCategory, accountId: string, local: CategoryValue, remote: CategoryValue) {
  const base = await loadBase(accountId, category);
  if (stable(local) === stable(remote)) return { value: local, conflicts: [] as PersonalDataConflictV1[] };
  if (base !== undefined && stable(local) === stable(base)) return { value: remote, conflicts: [] };
  if (base !== undefined && stable(remote) === stable(base)) return { value: local, conflicts: [] };
  if (category !== "profile") {
    const result = mergeCollections(Array.isArray(base) ? base : [], local as unknown[], remote as unknown[], category);
    return { value: result.merged as CategoryValue, conflicts: result.conflicts };
  }
  return { value: local, conflicts: [{ schemaVersion: 1 as const, id: crypto.randomUUID(), category,
    localValue: local, cloudValue: remote, createdAt: new Date().toISOString() }] };
}

export async function personalDataStatus(): Promise<SyncResult> {
  const current = await session();
  if (!current) return { ok: false, detail: "Sign in to OpenSidebar before using account sync." };
  const response = await cloud.request("/personal-data/status");
  if (!response.ok) return { ok: false, detail: `Sync status is unavailable (${response.status}).` };
  return { ok: true, status: await response.json() as PersonalDataStatusV1, conflicts: await conflicts() };
}

export async function initializePersonalDataSync(): Promise<SyncResult> {
  const current = await session();
  if (!current) return { ok: false, detail: "Sign in to OpenSidebar before using account sync." };
  const identity = await ensureDeviceIdentity(keyStore, current.account.accountId);
  const response = await cloud.request("/personal-data/device-key", { method: "PUT",
    body: JSON.stringify({ schemaVersion: 1, publicKeyJwk: identity.publicKeyJwk }) });
  if (!response.ok) return { ok: false, detail: `Encrypted sync setup failed (${response.status}).` };
  const result = await response.json() as { approved: boolean; keyEpoch: number };
  if (result.approved && !await loadPersonalDataKey(keyStore, current.account.accountId))
    await createAndStorePersonalDataKey(keyStore, current.account.accountId);
  if (!result.approved) {
    const requested = await cloud.request("/personal-data/key-requests", { method: "POST",
      body: JSON.stringify({ schemaVersion: 1, publicKeyJwk: identity.publicKeyJwk }) });
    if (!requested.ok && requested.status !== 409) return { ok: false, detail: `Browser approval request failed (${requested.status}).` };
  }
  return personalDataStatus();
}

export async function listPersonalDataKeyRequests() {
  const response = await cloud.request("/personal-data/key-requests");
  if (!response.ok) return { ok: false, detail: `Approval requests are unavailable (${response.status}).` };
  const value = await response.json() as { requests: PersonalDataKeyRequestV1[] };
  const current = await session();
  if (current) {
    const own = value.requests.find((item) => item.requestingDeviceId === current.device.id && item.state === "approved" && item.wrappedKey);
    if (own?.wrappedKey && !await loadPersonalDataKey(keyStore, current.account.accountId))
      await unwrapPersonalDataKeyFromDevice(keyStore, current.account.accountId, own.wrappedKey);
  }
  return { ok: true, requests: value.requests };
}

export async function decidePersonalDataKeyRequest(id: string, approved: boolean) {
  const current = await session();
  if (!current) return { ok: false, detail: "Sign in first." };
  let body: string | undefined;
  if (approved) {
    const listing = await listPersonalDataKeyRequests();
    const request = listing.ok ? listing.requests?.find((item) => item.id === id) : null;
    const key = await loadPersonalDataKey(keyStore, current.account.accountId);
    const status = await personalDataStatus();
    if (!request || !key || !status.status) return { ok: false, detail: "The approval request cannot be unlocked on this browser." };
    body = JSON.stringify({ wrappedKey: await wrapPersonalDataKeyForDevice({ key,
      recipientPublicKeyJwk: request.publicKeyJwk, senderDeviceId: current.device.id,
      recipientDeviceId: request.requestingDeviceId, keyEpoch: status.status.keyEpoch }) });
  }
  const response = await cloud.request(`/personal-data/key-requests/${id}/${approved ? "approve" : "deny"}`,
    { method: "POST", ...(body ? { body } : {}) });
  return response.ok ? { ok: true } : { ok: false, detail: `Approval decision failed (${response.status}).` };
}

export async function setPersonalDataCategoryEnabled(category: PersonalDataCategory, enabled: boolean) {
  const current = await session();
  if (!current) return { ok: false, detail: "Sign in first." };
  const next = await preferences(current.account.accountId);
  next.categories[category] = enabled;
  await savePreferences(next);
  if (enabled) {
    const result = await syncPersonalData(category);
    if (!result.ok) {
      next.categories[category] = false;
      await savePreferences(next);
    }
    return result;
  }
  return { ok: true };
}

export async function syncPersonalData(only?: PersonalDataCategory): Promise<SyncResult> {
  const current = await session();
  if (!current) return { ok: false, detail: "Sign in to OpenSidebar before syncing." };
  const prefs = await preferences(current.account.accountId);
  const requested = only ? [only] : (["saved_prompts", "website_skills", "profile"] as PersonalDataCategory[]);
  if (!requested.some((item) => prefs.categories[item])) {
    const idle = await personalDataStatus();
    return idle.ok ? { ...idle, conflicts: await conflicts() } : idle;
  }
  let statusResult = await personalDataStatus();
  if (!statusResult.ok || !statusResult.status?.currentDeviceApproved) {
    statusResult = await initializePersonalDataSync();
    if (!statusResult.ok || !statusResult.status?.currentDeviceApproved)
      return { ...statusResult, detail: statusResult.detail ?? "Approve this browser from an existing browser." };
  }
  let key = await loadPersonalDataKey(keyStore, current.account.accountId);
  if (!key) { await listPersonalDataKeyRequests(); key = await loadPersonalDataKey(keyStore, current.account.accountId); }
  if (!key) return { ok: false, detail: "This browser is approved but its encryption key is unavailable." };
  const selected = (only ? [only] : (["saved_prompts", "website_skills", "profile"] as PersonalDataCategory[]))
    .filter((item) => prefs.categories[item] && (item !== "profile" || statusResult.status!.capabilities.profile));
  let activeConflicts = await conflicts();
  for (const category of selected) {
    const metadata = statusResult.status!.documents[category];
    const local = await readLocal(category);
    let next = local;
    let remoteValue: CategoryValue | undefined;
    if (metadata) {
      const response = await cloud.request(`/personal-data/documents/${category}`);
      if (!response.ok) return { ok: false, detail: `Could not download ${category} (${response.status}).` };
      const envelope = await response.json() as PersonalDataDocumentEnvelopeV1;
      const remote = await decryptPersonalData<CategoryValue>({ accountId: current.account.accountId, envelope, key });
      remoteValue = remote;
      const result = await reconcile(category, current.account.accountId, local, remote);
      if (result.conflicts.length) {
        activeConflicts = [...activeConflicts.filter((item) => item.category !== category), ...result.conflicts];
        await saveConflicts(activeConflicts);
        continue;
      }
      next = result.value;
      if (stable(next) !== stable(local)) await writeLocal(category, next);
    }
    if (!metadata || stable(next) !== stable(remoteValue)) {
      const revision = (metadata?.revision ?? 0) + 1;
      const encrypted = await encryptPersonalData({ accountId: current.account.accountId, category,
        revision, keyEpoch: statusResult.status!.keyEpoch, value: next, key });
      const response = await cloud.request(`/personal-data/documents/${category}`, { method: "PUT",
        headers: { "if-match": String(metadata?.revision ?? 0) }, body: JSON.stringify(encrypted) });
      if (response.status === 409) return { ok: false, detail: `${category} changed on another browser; sync again to reconcile.` };
      if (!response.ok) return { ok: false, detail: `Could not upload ${category} (${response.status}).` };
      prefs.lastSyncedRevisions[category] = revision;
    } else if (metadata) prefs.lastSyncedRevisions[category] = metadata.revision;
    prefs.lastSyncedHashes[category] = await hash(next);
    await saveBase(current.account.accountId, category, next);
    activeConflicts = activeConflicts.filter((item) => item.category !== category);
  }
  prefs.lastSuccessfulSyncAt = new Date().toISOString();
  await Promise.all([savePreferences(prefs), saveConflicts(activeConflicts)]);
  return { ok: true, status: (await personalDataStatus()).status, conflicts: activeConflicts };
}

export async function resolvePersonalDataConflict(id: string, resolution: "local" | "cloud" | "both") {
  const current = await session();
  if (!current) return { ok: false, detail: "Sign in first." };
  const all = await conflicts();
  const conflict = all.find((item) => item.id === id);
  if (!conflict) return { ok: false, detail: "Conflict no longer exists." };
  const status = await personalDataStatus();
  const key = await loadPersonalDataKey(keyStore, current.account.accountId);
  const metadata = status.status?.documents[conflict.category];
  if (!key || !metadata) return { ok: false, detail: "The current encrypted cloud copy is unavailable." };
  const response = await cloud.request(`/personal-data/documents/${conflict.category}`);
  if (!response.ok) return { ok: false, detail: "The current encrypted cloud copy could not be read." };
  const remote = await decryptPersonalData<CategoryValue>({ accountId: current.account.accountId,
    envelope: await response.json() as PersonalDataDocumentEnvelopeV1, key });
  const local = await readLocal(conflict.category);
  let value: CategoryValue;
  if (conflict.category === "profile") {
    value = resolution === "cloud" ? remote : local;
  } else {
    const base = await loadBase(current.account.accountId, conflict.category);
    const merged = mergeCollections(Array.isArray(base) ? base : [], local as unknown[], remote as unknown[], conflict.category).merged;
    const chosen = new Map(merged.map((item) => [(item as { id: string }).id, item]));
    for (const item of all.filter((candidate) => candidate.category === conflict.category)) {
      const selected = item.id === id && resolution === "cloud" ? item.cloudValue : item.localValue;
      if (selected === undefined) chosen.delete(item.entityId!);
      else chosen.set(item.entityId!, selected);
      if (item.id === id && resolution === "both" && item.cloudValue !== undefined) {
        const duplicateId = crypto.randomUUID();
        chosen.set(duplicateId, { ...(item.cloudValue as object), id: duplicateId });
      }
    }
    value = [...chosen.values()] as CategoryValue;
  }
  await writeLocal(conflict.category, value);
  const remaining = all.filter((item) => item.id !== id);
  await saveConflicts(remaining);
  await saveBase(current.account.accountId, conflict.category, remote);
  if (remaining.some((item) => item.category === conflict.category))
    return { ok: true, conflicts: remaining };
  return syncPersonalData(conflict.category);
}

export async function deletePersonalDataCloudCopy(category: PersonalDataCategory) {
  const response = await cloud.request(`/personal-data/documents/${category}`, { method: "DELETE" });
  if (!response.ok) return { ok: false, detail: `Cloud copy deletion failed (${response.status}).` };
  return setPersonalDataCategoryEnabled(category, false);
}

export async function resetPersonalDataSync() {
  const current = await session();
  if (!current) return { ok: false, detail: "Sign in first." };
  const response = await cloud.request("/personal-data/reset", { method: "POST" });
  if (!response.ok) return { ok: false, detail: `Encrypted sync reset failed (${response.status}).` };
  await clearPersonalDataKeys(keyStore, current.account.accountId);
  await chromePersistencePort.local.remove([PERSONAL_DATA_SYNC_CONFLICTS_KEY, PERSONAL_DATA_SYNC_PREFERENCES_KEY]);
  return initializePersonalDataSync();
}

export async function localPersonalDataSyncPreferences() {
  const current = await session();
  return current ? preferences(current.account.accountId) : null;
}
