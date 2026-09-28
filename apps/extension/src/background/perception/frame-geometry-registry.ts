import type { ElementRect, FrameGeometryReport } from "../../types";

export interface FrameGeometry {
  rect: ElementRect;
  visible: boolean;
}

interface PendingGeometry {
  tabId: number;
  parentFrameId: number;
  finish(value: FrameGeometry | null): void;
}

const pending = new Map<string, PendingGeometry>();
let installed = false;

function isGeometryReport(value: unknown): value is FrameGeometryReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<FrameGeometryReport>;
  const rect = report.payload?.rect;
  return report.type === "FRAME_GEOMETRY_REPORT" &&
    typeof report.payload?.nonce === "string" &&
    typeof report.payload.visible === "boolean" &&
    Boolean(rect && [rect.x, rect.y, rect.width, rect.height]
      .every((part) => typeof part === "number" && Number.isFinite(part)));
}

function installReceiver(): void {
  if (installed) return;
  installed = true;
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isGeometryReport(message)) return false;
    const waiting = pending.get(message.payload.nonce);
    if (!waiting || sender.tab?.id !== waiting.tabId ||
        sender.frameId !== waiting.parentFrameId) return false;
    waiting.finish({ rect: message.payload.rect, visible: message.payload.visible });
    return false;
  });
}

export function expectFrameGeometry(
  tabId: number,
  parentFrameId: number,
  timeoutMs: number,
): { nonce: string; result: Promise<FrameGeometry | null> } {
  installReceiver();
  const nonce = crypto.randomUUID();
  const result = new Promise<FrameGeometry | null>((resolve) => {
    const timer = setTimeout(() => finish(null), timeoutMs);
    const finish = (value: FrameGeometry | null) => {
      if (!pending.has(nonce)) return;
      clearTimeout(timer);
      pending.delete(nonce);
      resolve(value);
    };
    pending.set(nonce, { tabId, parentFrameId, finish });
  });
  return { nonce, result };
}
