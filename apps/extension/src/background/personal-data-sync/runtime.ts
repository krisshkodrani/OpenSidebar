import type { PersonalDataCategory, RuntimeMessage } from "@shared-types";
import { PERSONAL_PROFILE_STORAGE_KEY } from "../../utils/personal-profile";
import { WEBSITE_SKILLS_STORAGE_KEY } from "../../utils/website-skills";
import {
  decidePersonalDataKeyRequest,
  deletePersonalDataCloudCopy,
  listPersonalDataKeyRequests,
  localPersonalDataSyncPreferences,
  personalDataStatus,
  resetPersonalDataSync,
  resolvePersonalDataConflict,
  setPersonalDataCategoryEnabled,
  syncPersonalData,
} from "./controller";

const ALARM = "opensidebar:personal-data-sync";
const localKey: Record<string, PersonalDataCategory> = {
  "opensidebar:savedPrompts": "saved_prompts",
  [WEBSITE_SKILLS_STORAGE_KEY]: "website_skills",
  [PERSONAL_PROFILE_STORAGE_KEY]: "profile",
};
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function run(category?: PersonalDataCategory) {
  if (running) return;
  const preferences = await localPersonalDataSyncPreferences();
  if (!preferences || !(category ? preferences.categories[category] : Object.values(preferences.categories).some(Boolean)))
    return;
  running = true;
  try { await syncPersonalData(category); } finally { running = false; }
}

export function initPersonalDataSyncRuntime() {
  chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void run();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || running) return;
    const category = Object.keys(changes).map((key) => localKey[key]).find(Boolean);
    if (!category) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(category), 1_500);
  });
  void run();
}

export function routePersonalDataSyncMessage(
  message: RuntimeMessage,
  sendResponse: (response?: unknown) => void,
) {
  let action: Promise<unknown> | null = null;
  switch (message.type) {
    case "PERSONAL_DATA_SYNC_STATUS":
      action = Promise.all([personalDataStatus(), localPersonalDataSyncPreferences()])
        .then(([status, preferences]) => ({ ...status, preferences }));
      break;
    case "PERSONAL_DATA_SYNC_NOW":
      action = syncPersonalData(message.payload?.category);
      break;
    case "PERSONAL_DATA_SYNC_SET_CATEGORY":
      action = setPersonalDataCategoryEnabled(message.payload.category, message.payload.enabled);
      break;
    case "PERSONAL_DATA_SYNC_KEY_REQUESTS":
      action = listPersonalDataKeyRequests();
      break;
    case "PERSONAL_DATA_SYNC_KEY_DECISION":
      action = decidePersonalDataKeyRequest(message.payload.id, message.payload.approved);
      break;
    case "PERSONAL_DATA_SYNC_RESOLVE":
      action = resolvePersonalDataConflict(message.payload.id, message.payload.resolution);
      break;
    case "PERSONAL_DATA_SYNC_DELETE_CLOUD":
      action = deletePersonalDataCloudCopy(message.payload.category);
      break;
    case "PERSONAL_DATA_SYNC_RESET":
      action = resetPersonalDataSync();
      break;
  }
  if (!action) return false;
  void action.then(sendResponse).catch((error) => sendResponse({ ok: false,
    detail: error instanceof Error ? error.message : String(error) }));
  return true;
}
