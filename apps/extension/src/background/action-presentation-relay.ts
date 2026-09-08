import { MessageSource, type RuntimeMessage } from "../types";

/** Relay content-originated action phases to workspace-scoped UI consumers. */
export function routeActionPresentation(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
  resolveWorkspaceId: (tabId: number) => Promise<string>,
): boolean {
  if (
    message.source !== MessageSource.CONTENT ||
    message.type !== "ACTION_PRESENTATION"
  ) return false;
  const tabId = sender.tab?.id;
  if (tabId == null) return false;
  void resolveWorkspaceId(tabId)
    .then((workspaceId) =>
      chrome.runtime.sendMessage({
        ...message,
        requestId: crypto.randomUUID(),
        source: MessageSource.BACKGROUND,
        workspaceId,
      }),
    )
    .catch(() => undefined);
  sendResponse({ ok: true });
  return true;
}
