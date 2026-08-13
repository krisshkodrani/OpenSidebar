type DraftStorageArea = {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

export const COMPOSER_DRAFT_MAX_CHARS = 16_000;
const PREFIX = "opensidebar:composerDraft:v1:";

export type ComposerDraftScope = {
  accountId: string;
  workspaceId: string;
  mode: "task" | "guidance";
};

export type StoredComposerDraftV1 = {
  schemaVersion: 1;
  text: string;
  updatedAt: string;
};

const segment = (value: string) => encodeURIComponent(value.slice(0, 160));
export const composerDraftKey = (scope: ComposerDraftScope) =>
  `${PREFIX}${segment(scope.accountId)}:${segment(scope.workspaceId)}:${scope.mode}`;

export async function readComposerDraft(
  storage: DraftStorageArea,
  scope: ComposerDraftScope,
) {
  const key = composerDraftKey(scope);
  const value = (await storage.get(key))[key] as Partial<StoredComposerDraftV1> | undefined;
  return value?.schemaVersion === 1 && typeof value.text === "string"
    ? value.text.slice(0, COMPOSER_DRAFT_MAX_CHARS)
    : "";
}

export async function writeComposerDraft(
  storage: DraftStorageArea,
  scope: ComposerDraftScope,
  text: string,
) {
  const key = composerDraftKey(scope);
  const bounded = text.slice(0, COMPOSER_DRAFT_MAX_CHARS);
  if (!bounded) {
    await storage.remove(key);
    return;
  }
  const value: StoredComposerDraftV1 = {
    schemaVersion: 1,
    text: bounded,
    updatedAt: new Date().toISOString(),
  };
  await storage.set({ [key]: value });
}

export const discardComposerDraft = (
  storage: DraftStorageArea,
  scope: ComposerDraftScope,
) => storage.remove(composerDraftKey(scope));
