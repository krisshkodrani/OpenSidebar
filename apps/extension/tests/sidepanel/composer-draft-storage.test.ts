import { describe, expect, test } from "vitest";
import { createFakePersistencePort } from "../fakes/persistence";
import {
  COMPOSER_DRAFT_MAX_CHARS,
  composerDraftKey,
  discardComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from "../../src/sidepanel/composer-draft-storage";

const scope = {
  accountId: "account-a",
  workspaceId: "workspace-a",
  mode: "task" as const,
};

describe("composer draft storage", () => {
  test("stores drafts locally under an account/workspace/mode key", async () => {
    const { port, local } = createFakePersistencePort();
    await writeComposerDraft(port.local, scope, "Finish this later");
    expect(await readComposerDraft(port.local, scope)).toBe("Finish this later");
    expect(local.store.has(composerDraftKey(scope))).toBe(true);
  });

  test("isolates accounts and removes an explicitly discarded draft", async () => {
    const { port } = createFakePersistencePort();
    await writeComposerDraft(port.local, scope, "private draft");
    expect(
      await readComposerDraft(port.local, { ...scope, accountId: "account-b" }),
    ).toBe("");
    await discardComposerDraft(port.local, scope);
    expect(await readComposerDraft(port.local, scope)).toBe("");
  });

  test("bounds draft size and removes empty values", async () => {
    const { port, local } = createFakePersistencePort();
    await writeComposerDraft(port.local, scope, "x".repeat(COMPOSER_DRAFT_MAX_CHARS + 50));
    expect((await readComposerDraft(port.local, scope)).length).toBe(
      COMPOSER_DRAFT_MAX_CHARS,
    );
    await writeComposerDraft(port.local, scope, "");
    expect(local.store.has(composerDraftKey(scope))).toBe(false);
  });
});
