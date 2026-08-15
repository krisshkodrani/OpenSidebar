import type { WorkItemRecordV1 } from "@shared-types/work-surface";
import type { UiRuntimeStorageArea } from "./runtime";

export const WORK_SURFACE_MIGRATION_KEY =
  "opensidebar:workSurfaceMigration:v1";
const WORK_SURFACE_HISTORY_PREFIX = "opensidebar:workSurface:v1:";
const LEGACY_UI_PREFIXES = [
  "chatMessages:",
  "agentState:",
  "opensidebar:composerDraft:v1:",
] as const;
const LEGACY_UI_KEYS = ["opensidebar:remoteMissionStatus:v1"] as const;
export const WORK_SURFACE_HISTORY_LIMIT = 50;

const workspaceSegment = (workspaceId: string | null) =>
  encodeURIComponent((workspaceId ?? "default").slice(0, 160));

export const workSurfaceHistoryKey = (workspaceId: string | null) =>
  `${WORK_SURFACE_HISTORY_PREFIX}${workspaceSegment(workspaceId)}`;

export async function migrateLegacyWorkSurfaceState(
  storage: UiRuntimeStorageArea,
): Promise<boolean> {
  const stored = await storage.get(null);
  if (stored[WORK_SURFACE_MIGRATION_KEY] === true) return false;

  const keys = Object.keys(stored).filter(
    (key) =>
      LEGACY_UI_KEYS.includes(key as (typeof LEGACY_UI_KEYS)[number]) ||
      LEGACY_UI_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  if (keys.length > 0) await storage.remove(keys);
  await storage.set({ [WORK_SURFACE_MIGRATION_KEY]: true });
  return true;
}

export async function readWorkHistory(
  storage: UiRuntimeStorageArea,
  workspaceId: string | null,
): Promise<WorkItemRecordV1[]> {
  const key = workSurfaceHistoryKey(workspaceId);
  const value = (await storage.get(key))[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is WorkItemRecordV1 =>
        Boolean(
          item &&
            typeof item === "object" &&
            (item as WorkItemRecordV1).schemaVersion === 1 &&
            typeof (item as WorkItemRecordV1).workItemId === "string",
        ),
    )
    .slice(0, WORK_SURFACE_HISTORY_LIMIT);
}

export async function archiveWorkItem(
  storage: UiRuntimeStorageArea,
  workspaceId: string | null,
  item: WorkItemRecordV1,
): Promise<WorkItemRecordV1[]> {
  const history = await readWorkHistory(storage, workspaceId);
  const next = [item, ...history.filter((entry) => entry.workItemId !== item.workItemId)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, WORK_SURFACE_HISTORY_LIMIT);
  await storage.set({ [workSurfaceHistoryKey(workspaceId)]: next });
  return next;
}
