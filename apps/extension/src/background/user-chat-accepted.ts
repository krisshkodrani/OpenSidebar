import { MessageSource, type RuntimeMessage } from "../types";

export function broadcastUserChatAccepted(
  message: Extract<RuntimeMessage, { type: "USER_CHAT" }>,
  workspaceId: string,
): void {
  const text = message.payload.text.trim();
  if (!text) return;
  chrome.runtime
    .sendMessage({
      type: "USER_CHAT_ACCEPTED",
      requestId: crypto.randomUUID(),
      source: MessageSource.BACKGROUND,
      workspaceId,
      payload: {
        text,
        tabId: message.payload.tabId,
        workspaceId,
        messageId: message.payload.messageId ?? message.requestId,
        timestamp: message.payload.timestamp ?? Date.now(),
        isFeedback: message.payload.isFeedback,
      },
    })
    .catch(() => {});
}
