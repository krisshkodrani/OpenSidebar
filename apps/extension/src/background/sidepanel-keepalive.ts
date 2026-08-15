import { SIDEPANEL_KEEPALIVE_PORT_NAME } from "../lib/sidepanel-keepalive";

export function registerSidepanelKeepalivePort(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== SIDEPANEL_KEEPALIVE_PORT_NAME) return;

    port.onDisconnect.addListener(() => {
      // Consume disconnect errors while Chrome still exposes runtime.lastError.
      // The sidepanel owns recovery; the receiver only keeps this port valid.
      void chrome.runtime.lastError;
    });
  });
}
