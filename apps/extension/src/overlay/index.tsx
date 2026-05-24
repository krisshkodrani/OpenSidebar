import React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import App from "../sidepanel/App";
import { UiPortalProvider } from "../ui";
import sidepanelCss from "../sidepanel/index.css?inline";
import {
  setUiRuntimePortForTesting,
  type UiRuntimePort,
} from "../sidepanel/runtime";
import { createOpenSidebarOverlayHost } from "./host";
import {
  createOverlayUiRuntimeHarness,
  type OverlayUiRuntimeOptions,
  type OverlayUiRuntimeHarness,
} from "./runtime";

export const OPENSIDEBAR_OVERLAY_CONFIG_ID = "opensidebar-overlay-config";
export const OPENSIDEBAR_OVERLAY_MOUNT_EVENT = "opensidebar:overlay:mount";
export const OPENSIDEBAR_OVERLAY_DISPOSE_EVENT = "opensidebar:overlay:dispose";

export interface OpenSidebarOverlayInstance {
  dispose(): void;
}

export interface MountOpenSidebarOverlayOptions {
  runtimePort?: UiRuntimePort;
  runtimeHarness?: OverlayUiRuntimeHarness;
  runtimeOptions?: OverlayUiRuntimeOptions;
  sidepanelCss?: string;
  glass?: boolean;
}

let activeInstance: OpenSidebarOverlayInstance | null = null;

export function mountOpenSidebarOverlay(
  options: MountOpenSidebarOverlayOptions = {},
): OpenSidebarOverlayInstance {
  activeInstance?.dispose();
  let disposing = false;
  let runtimeHarness = options.runtimeHarness ?? null;
  if (!options.runtimePort && !runtimeHarness) {
    runtimeHarness = createOverlayUiRuntimeHarness(options.runtimeOptions);
  }
  const runtimePort = options.runtimePort ?? runtimeHarness?.port;
  if (!runtimePort) {
    throw new Error("OpenSidebar overlay runtime port was not created.");
  }
  const overlayHost = createOpenSidebarOverlayHost({
    sidepanelCss: options.sidepanelCss ?? sidepanelCss,
    glass: options.glass,
    onClose: () => {
      if (!disposing) activeInstance?.dispose();
    },
  });
  const restoreRuntime = setUiRuntimePortForTesting(runtimePort);
  if (runtimeHarness && typeof window !== "undefined") {
    window.__opensidebarOverlayRuntime = runtimeHarness;
  }
  const root: Root = createRoot(overlayHost.mountElement);
  root.render(
    <React.StrictMode>
      <UiPortalProvider container={overlayHost.portalElement}>
        <App
          themeRoot={overlayHost.themeRoot}
          activityHudRoot={overlayHost.activityHudElement}
        />
      </UiPortalProvider>
    </React.StrictMode>,
  );

  activeInstance = {
    dispose() {
      if (disposing) return;
      disposing = true;
      root.unmount();
      restoreRuntime();
      runtimeHarness?.dispose();
      overlayHost.dispose();
      if (
        runtimeHarness &&
        typeof window !== "undefined" &&
        window.__opensidebarOverlayRuntime === runtimeHarness
      ) {
        delete window.__opensidebarOverlayRuntime;
      }
      if (activeInstance === this) {
        activeInstance = null;
      }
    },
  };
  return activeInstance;
}

function mountWhenReady(): void {
  if (typeof document === "undefined") return;
  const readOptions = () =>
    typeof window === "undefined"
      ? undefined
      : window.__opensidebarOverlayConfig ?? readConfigElement();
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => mountOpenSidebarOverlay(readOptions()),
      { once: true },
    );
    return;
  }
  mountOpenSidebarOverlay(readOptions());
}

function readConfigElement(): MountOpenSidebarOverlayOptions | undefined {
  const raw = document.getElementById(OPENSIDEBAR_OVERLAY_CONFIG_ID)
    ?.textContent;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as MountOpenSidebarOverlayOptions;
  } catch {
    return undefined;
  }
}

declare global {
  interface Window {
    __opensidebarOverlay?: {
      mount: typeof mountOpenSidebarOverlay;
      dispose: () => void;
    };
    __opensidebarOverlayConfig?: Pick<
      MountOpenSidebarOverlayOptions,
      "runtimeOptions" | "sidepanelCss" | "glass"
    >;
    __opensidebarOverlayRuntime?: OverlayUiRuntimeHarness;
  }
}

if (typeof window !== "undefined") {
  window.__opensidebarOverlay = {
    mount: mountOpenSidebarOverlay,
    dispose() {
      activeInstance?.dispose();
    },
  };
  window.addEventListener(OPENSIDEBAR_OVERLAY_MOUNT_EVENT, () => {
    mountOpenSidebarOverlay(window.__opensidebarOverlayConfig ?? readConfigElement());
  });
  window.addEventListener(OPENSIDEBAR_OVERLAY_DISPOSE_EVENT, () => {
    activeInstance?.dispose();
  });
  mountWhenReady();
}
