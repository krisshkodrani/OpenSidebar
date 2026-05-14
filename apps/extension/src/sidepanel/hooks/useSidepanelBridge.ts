import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../utils";
import { MessageSource } from "../../types";
import { initializeBridge } from "../bridge";
import { uiRuntime } from "../runtime";
import { useStore } from "../store";

export interface DebugScreenshot {
  dataUrl: string;
  context: string;
  timestamp: number;
}

export function useSidepanelBridge(): {
  screenshot: DebugScreenshot | null;
  clearScreenshot: () => void;
} {
  const showDebugScreenshots = useStore(
    (s) => s.settings.showDebugScreenshots,
  );
  const [screenshot, setScreenshot] = useState<DebugScreenshot | null>(null);
  const screenshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScreenshot = useCallback(() => {
    setScreenshot(null);
    if (screenshotTimerRef.current) {
      clearTimeout(screenshotTimerRef.current);
      screenshotTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const cleanup = initializeBridge(useStore, {
      onScreenshot: (payload) => {
        if (!useStore.getState().settings.showDebugScreenshots) return;
        if (screenshotTimerRef.current) {
          clearTimeout(screenshotTimerRef.current);
        }
        setScreenshot(payload);
        screenshotTimerRef.current = setTimeout(() => {
          setScreenshot(null);
          screenshotTimerRef.current = null;
        }, 30000);
      },
      onClose: (windowId) => {
        if (uiRuntime.source !== MessageSource.SIDEPANEL) {
          return;
        }
        uiRuntime.getCurrentWindow().then((currentWindow) => {
          if (currentWindow?.id === windowId) {
            logger.info("ui", "Panel close requested, flushing and closing", {
              windowId,
            });
            useStore.getState().setActiveWorkspaceId(null);
            globalThis.close();
          }
        });
      },
    });
    return () => {
      cleanup();
      if (screenshotTimerRef.current) {
        clearTimeout(screenshotTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (showDebugScreenshots === false && screenshot) {
      clearScreenshot();
    }
  }, [clearScreenshot, screenshot, showDebugScreenshots]);

  return { screenshot, clearScreenshot };
}
