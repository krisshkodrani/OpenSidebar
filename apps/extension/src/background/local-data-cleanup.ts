import type { PersistenceStorageArea } from "./environment/types";
import {
  RECORD_SKILL_INTRO_DISMISSED_KEY,
  WEBSITE_SKILLS_STORAGE_KEY,
} from "../utils/website-skills";

const dynamicPrefixes = [
  "opensidebar:composerDraft:v1:",
  "opensidebar:remoteMissionAttempt:v1:",
];

const fixedKeys = [
  "opensidebar:savedPrompts",
  "opensidebar:savedPromptsSeeded",
  "opensidebar:savedPromptsVersion",
  WEBSITE_SKILLS_STORAGE_KEY,
  RECORD_SKILL_INTRO_DISMISSED_KEY,
  "opensidebar_logs",
  "opensidebar:workspaces",
  "opensidebar:nextWorkspaceNum",
  "opensidebar:checkpoints:v1",
  "opensidebar:remoteMissionDelivery:v1",
  "opensidebar:remoteMissionStatus:v1",
];

export async function clearLocalExtensionData(storage: PersistenceStorageArea) {
  const localData = await storage.get(null);
  const dynamicKeys = Object.keys(localData).filter((key) =>
    dynamicPrefixes.some((prefix) => key.startsWith(prefix)),
  );
  await storage.remove([...fixedKeys, ...dynamicKeys]);
}
