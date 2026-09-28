import { MessageSource, type FrameGeometryReport } from "../types";

const GEOMETRY_PING = "opensidebar:frame-geometry-ping";
let installed = false;

/** A child asks its parent to identify the iframe element hosting this window. */
export function requestParentFrameGeometry(nonce: string): void {
  if (window.parent === window) return;
  window.parent.postMessage({ type: GEOMETRY_PING, nonce }, "*");
}

/** Installs in the top frame and in child frames that may host nested frames. */
export function installFrameGeometryRelay(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: unknown; nonce?: unknown } | null;
    if (!data || data.type !== GEOMETRY_PING ||
        typeof data.nonce !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(data.nonce)) return;
    const element = [...document.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>("iframe, frame")]
      .find((candidate) => candidate.contentWindow === event.source);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const report: FrameGeometryReport = {
      type: "FRAME_GEOMETRY_REPORT",
      requestId: crypto.randomUUID(),
      source: MessageSource.CONTENT,
      payload: {
        nonce: data.nonce,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: style.display !== "none" && style.visibility !== "hidden" &&
          rect.width > 0 && rect.height > 0,
      },
    };
    void chrome.runtime.sendMessage(report).catch(() => undefined);
  });
}
