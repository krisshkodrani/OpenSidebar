import type { ChatEntry } from "../types";
import type { PersistenceStorageArea } from "./environment/types";

const MAX_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 1600;
const MAX_LINE_CHARS = 260;

type CurrentChat = { text: string; messageId?: string; timestamp?: number };

function normalize(text: unknown): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function entryText(entry: Partial<ChatEntry>): string {
  const completionSummary =
    typeof entry.completionData?.summary === "string"
      ? entry.completionData.summary
      : "";
  return normalize(entry.content || completionSummary);
}

export async function buildWorkspaceConversationContext(
  storage: PersistenceStorageArea,
  workspaceId: string,
  current: CurrentChat,
): Promise<string> {
  const storageKey = `chatMessages:${workspaceId}`;
  const stored = (await storage.get(storageKey))[storageKey];
  if (!Array.isArray(stored)) return "";
  const currentText = normalize(current.text);
  return (stored as Partial<ChatEntry>[])
    .filter((entry) => {
      if (entry.isStreaming) return false;
      if (entry.role !== "user" && entry.role !== "assistant") return false;
      if (current.messageId && entry.id === current.messageId) return false;
      if (
        entry.role === "user" &&
        current.timestamp &&
        typeof entry.timestamp === "number" &&
        entry.timestamp >= current.timestamp &&
        entryText(entry) === currentText
      )
        return false;
      return entryText(entry).length > 0;
    })
    .slice(-MAX_MESSAGES)
    .map((entry) => {
      const role = entry.role === "user" ? "User" : "Assistant";
      return `- ${role}: ${entryText(entry).slice(0, MAX_LINE_CHARS)}`;
    })
    .join("\n")
    .slice(0, MAX_CONTEXT_CHARS);
}
