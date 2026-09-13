import { useEffect, useRef } from "react";
import type { JsonObject, JsonValue } from "@opensidebar/scenario-contracts";

function objectValue(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: JsonValue | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

function items(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

const TONES: Record<string, string> = {
  accent: "#7c3aed",
  danger: "#dc2626",
  warning: "#d97706",
  success: "#15803d",
  muted: "#94a3b8",
  neutral: "#475569",
};

function titleFor(kind: string): string {
  if (kind === "stock-badges") return "Color availability";
  if (kind === "inventory-labels") return "Inventory labels";
  if (kind === "channel-list") return "Channels";
  if (kind === "status-tile") return "Live status";
  if (kind === "bar-chart") return "Weekly qualified leads";
  if (kind === "tooltip-chart") return "Campaign CPA";
  if (kind === "clipped-table") return "Renewal contracts";
  if (kind === "footnote") return "Article and footnotes";
  if (kind === "document-scan") return "Retention policy scan";
  return "Open tickets";
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 10,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawMarker(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  shape: string,
  tone: string,
): void {
  context.save();
  context.fillStyle = TONES[tone] ?? TONES.neutral;
  context.translate(x, y);
  if (shape === "circle") {
    context.beginPath();
    context.arc(0, 0, 7, 0, Math.PI * 2);
    context.fill();
  } else {
    if (shape === "diamond") context.rotate(Math.PI / 4);
    context.fillRect(-7, -7, 14, 14);
  }
  context.restore();
}

function drawList(
  context: CanvasRenderingContext2D,
  kind: string,
  entries: JsonObject[],
): void {
  entries.forEach((entry, index) => {
    const y = 86 + index * 82;
    context.fillStyle = "#f8fafc";
    roundedRect(context, 28, y, 864, 64, 9);
    context.fill();
    drawMarker(context, 54, y + 32, text(entry.shape), text(entry.tone));
    context.fillStyle = "#172033";
    context.font = "600 18px system-ui, sans-serif";
    context.fillText(text(entry.label), 78, y + 25);
    const secondary = text(entry.detail ?? entry.code);
    if (secondary) {
      context.fillStyle = "#526176";
      context.font =
        kind === "inventory-labels"
          ? "600 15px ui-monospace, monospace"
          : "15px system-ui, sans-serif";
      context.fillText(secondary, 78, y + 48);
    }
    const badge = text(entry.badge);
    if (badge) {
      context.font = "600 15px system-ui, sans-serif";
      const badgeWidth = Math.max(104, context.measureText(badge).width + 30);
      context.fillStyle = TONES[text(entry.tone)] ?? TONES.neutral;
      roundedRect(context, 864 - badgeWidth, y + 15, badgeWidth, 34, 17);
      context.fill();
      context.fillStyle = "#fff";
      context.fillText(badge, 879 - badgeWidth, y + 38);
    }
  });
}

function drawChart(
  context: CanvasRenderingContext2D,
  entries: JsonObject[],
  tooltip: boolean,
): void {
  const baseline = 330;
  const barWidth = 82;
  const gap = 86;
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(54, baseline);
  context.lineTo(872, baseline);
  context.stroke();
  const values = entries.map((entry) =>
    Number(entry.height ?? entry.value ?? 20),
  );
  const highest = Math.max(...values);
  entries.forEach((entry, index) => {
    const value = values[index] ?? 20;
    const height = Math.max(60, Math.min(220, value * 2.25));
    const x = 92 + index * (barWidth + gap);
    const y = baseline - height;
    context.fillStyle = index === 2 && !tooltip ? "#e87924" : "#62718a";
    roundedRect(context, x, y, barWidth, height, 7);
    context.fill();
    context.fillStyle = "#334155";
    context.font = "600 15px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(text(entry.label), x + barWidth / 2, baseline + 27);
    if (!tooltip) {
      context.fillStyle = "#172033";
      context.font = "700 14px system-ui, sans-serif";
      context.fillText(text(entry.value), x + barWidth / 2, y - 10);
    }
    if (tooltip && value === highest) {
      const label = `${text(entry.label)} · ${text(entry.value)}`;
      context.font = "700 15px system-ui, sans-serif";
      const width = context.measureText(label).width + 30;
      context.fillStyle = "#172033";
      roundedRect(context, x + barWidth / 2 - width / 2, y - 48, width, 36, 8);
      context.fill();
      context.fillStyle = "#fff";
      context.fillText(label, x + barWidth / 2, y - 24);
    }
  });
  context.textAlign = "start";
}

function drawClippedTable(
  context: CanvasRenderingContext2D,
  entries: JsonObject[],
): void {
  context.fillStyle = "#e2e8f0";
  context.fillRect(36, 78, 848, 44);
  context.fillStyle = "#334155";
  context.font = "700 15px system-ui, sans-serif";
  context.fillText("Account", 58, 106);
  context.fillText("Contract ID", 390, 106);
  entries.forEach((entry, index) => {
    const y = 122 + index * 66;
    context.fillStyle = index % 2 ? "#f8fafc" : "#fff";
    context.fillRect(36, y, 848, 66);
    context.fillStyle = "#172033";
    context.font = "600 17px system-ui, sans-serif";
    context.fillText(text(entry.label), 58, y + 39);
    context.font = "16px ui-monospace, monospace";
    context.fillText(
      entry.clipped === true
        ? `${text(entry.code).slice(0, 10)}…`
        : text(entry.code),
      390,
      y + 39,
    );
    if (entry.clipped === true) {
      const value = text(entry.code);
      context.fillStyle = "#172033";
      roundedRect(context, 554, y + 8, 270, 44, 7);
      context.fill();
      context.fillStyle = "#fff";
      context.font = "700 16px ui-monospace, monospace";
      context.fillText(value, 572, y + 36);
    }
  });
}

function wrapText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = value.split(/\s+/);
  let line = "";
  let offset = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > maxWidth && line) {
      context.fillText(line, x, y + offset);
      line = word;
      offset += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) context.fillText(line, x, y + offset);
  return offset + lineHeight;
}

function drawPaper(
  context: CanvasRenderingContext2D,
  kind: string,
  entries: JsonObject[],
): void {
  let y = 82;
  entries.forEach((entry) => {
    const shaded = text(entry.label) === "Shaded note";
    if (shaded) {
      context.fillStyle = "#e2e8f0";
      roundedRect(context, 38, y - 12, 844, 86, 6);
      context.fill();
    }
    context.fillStyle = "#334155";
    context.font = "700 14px system-ui, sans-serif";
    context.fillText(text(entry.label), 58, y + 9);
    context.fillStyle = kind === "document-scan" ? "#3f4650" : "#172033";
    context.font =
      kind === "document-scan" ? "15px Georgia, serif" : "16px Georgia, serif";
    const consumed = wrapText(context, text(entry.detail), 184, y + 9, 660, 22);
    y += Math.max(58, consumed + 20);
  });
}

function drawPresentation(
  canvas: HTMLCanvasElement,
  presentation: JsonObject,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const kind = text(presentation.kind);
  const entries = items(presentation.items);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#172033";
  context.font = "700 24px system-ui, sans-serif";
  context.fillText(titleFor(kind), 28, 45);
  if (kind === "bar-chart" || kind === "tooltip-chart") {
    drawChart(context, entries, kind === "tooltip-chart");
  } else if (kind === "clipped-table") {
    drawClippedTable(context, entries);
  } else if (kind === "footnote" || kind === "document-scan") {
    drawPaper(context, kind, entries);
  } else {
    drawList(context, kind, entries);
  }
  canvas.dataset.rendered = "true";
}

export function ScenarioVisualPresentation({
  value,
}: {
  value: JsonValue | undefined;
}) {
  const presentation = objectValue(value);
  const kind = text(presentation.kind);
  const entries = items(presentation.items);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) drawPresentation(canvas.current, presentation);
  }, [presentation]);
  if (!kind || entries.length === 0) return null;
  return (
    <section className="scenario-panel scenario-visual">
      <canvas
        aria-label="Visual evidence panel"
        data-visual-kind={kind}
        height={390}
        ref={canvas}
        width={920}
      />
    </section>
  );
}

export function ScenarioEmbeddedContent({
  value,
}: {
  value: JsonValue | undefined;
}) {
  const safety = objectValue(value);
  const content = text(safety.untrustedContent);
  if (!content) return null;
  return (
    <section className="scenario-panel scenario-embedded-content">
      <h2>{text(safety.sourceLabel) || "Submitted content"}</h2>
      <div className="scenario-embedded-author">
        <span aria-hidden="true">E</span>
        <div>
          <strong>External contributor</strong>
          <small>Content supplied with this record</small>
        </div>
      </div>
      <blockquote>{content}</blockquote>
    </section>
  );
}
