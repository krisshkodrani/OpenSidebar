import type { RuntimeMessage } from "../types";
import {
  OVERLAY_RECEIVE_MESSAGE_EVENT,
  OVERLAY_SEND_MESSAGE_EVENT,
  type OverlayUiRuntimeHarness,
} from "./runtime";

export interface OverlayUiMessageEventDetail {
  message: unknown;
}

type OverlayWindow = Window & {
  __opensidebarOverlayRuntime?: OverlayUiRuntimeHarness;
};

function resolveWindow(target?: Window): OverlayWindow {
  if (target) return target as OverlayWindow;
  if (typeof window === "undefined") {
    throw new Error("OpenSidebar overlay driver requires a browser window.");
  }
  return window as OverlayWindow;
}

export function emitOverlayRuntimeMessage(
  message: RuntimeMessage,
  target?: Window,
): void {
  const win = resolveWindow(target);
  const EventCtor =
    (win as Window & { CustomEvent?: typeof globalThis.CustomEvent })
      .CustomEvent ??
    (typeof CustomEvent !== "undefined" ? CustomEvent : undefined);
  if (!EventCtor) {
    throw new Error("OpenSidebar overlay driver requires CustomEvent support.");
  }
  win.dispatchEvent(
    new EventCtor(OVERLAY_RECEIVE_MESSAGE_EVENT, {
      detail: { message },
    }),
  );
}

export function subscribeOverlayUiMessages(
  listener: (message: unknown) => void,
  target?: Window,
): () => void {
  const win = resolveWindow(target);
  const eventListener = (event: Event) => {
    listener(
      (event as CustomEvent<Partial<OverlayUiMessageEventDetail>>).detail
        ?.message,
    );
  };
  win.addEventListener(OVERLAY_SEND_MESSAGE_EVENT, eventListener);
  return () => win.removeEventListener(OVERLAY_SEND_MESSAGE_EVENT, eventListener);
}

export function getOverlayRuntimeHarness(
  target?: Window,
): OverlayUiRuntimeHarness | null {
  return resolveWindow(target).__opensidebarOverlayRuntime ?? null;
}
