import { describe, expect, test } from "vitest";
import type { PersistenceStorageArea } from "../../src/background/environment/types";
import { buildWorkspaceConversationContext } from
  "../../src/background/workspace-conversation-context";

function storageFor(messages: unknown[]): PersistenceStorageArea {
  return {
    get: async (key: string) => ({ [key]: messages }),
  } as PersistenceStorageArea;
}

describe("workspace conversation context", () => {
  test("preserves a long prior answer when the user refers to it", async () => {
    const summary = `Summary: ${"A detailed point. ".repeat(35)} Final finding: the source has three sections.`;
    const messages = [
      { id: "old-user", role: "user", content: "Summarize the source page." },
      { id: "old-answer", role: "assistant", content: summary },
      { id: "current", role: "user", content: "write the summary above on this page" },
    ];
    const context = await buildWorkspaceConversationContext(
      storageFor(messages), "workspace", {
        text: "write the summary above on this page", messageId: "current",
      });
    expect(context).toContain("Final finding: the source has three sections.");
    expect(context).toContain("Earlier assistant response referenced");
    expect(context).not.toContain("- User: write the summary above on this page");

    const unrelated = await buildWorkspaceConversationContext(
      storageFor(messages), "workspace", { text: "Open the document", messageId: "current" });
    expect(unrelated).not.toContain("Final finding: the source has three sections.");
    expect(unrelated.length).toBeLessThanOrEqual(1600);
  });

  test("marks a prior answer as truncated instead of implying full transfer", async () => {
    const context = await buildWorkspaceConversationContext(storageFor([
      { id: "answer", role: "assistant", content: "a".repeat(7000) },
    ]), "workspace", { text: "Copy your previous answer" });
    expect(context).toContain("Earlier response truncated");
    expect(context.length).toBeLessThan(6400);
  });
});
