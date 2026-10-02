import type { DomSnapshot, ToolName } from "../../../types";
import type { CompletionEvidence } from "./kernel-types";
import { cleanLabel, compactKey } from "./text-utils";

export function extractDownloadFileResultEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  turn: number;
}): CompletionEvidence[] {
  if (params.toolName !== "download_file") return [];

  const parsed = parseDownloadFileResult(params.result);
  if (!parsed) return [];

  const targetText = getDownloadTargetText(params.args, parsed.filename);
  if (!targetText) return [];

  const key = compactKey(targetText) || `download-${parsed.id}`;
  const url = typeof params.args.url === "string" ? params.args.url : "";

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:download:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Download ${parsed.state}: ${targetText} (ID: ${parsed.id})`,
        action: "download",
        targetText,
        source:
          parsed.state === "completed"
            ? "download_file_completed"
            : "download_file_result",
        ...(url ? { url } : {}),
      },
    },
  ];
}

type DownloadFileResultDetails = {
  id: string;
  state: "started" | "completed";
  filename?: string;
};

function parseDownloadFileResult(
  result: string,
): DownloadFileResultDetails | null {
  const value = result.trim();
  const started = /^Download started\s+\(ID:\s*(\d+)\)$/i.exec(value);
  if (started?.[1]) {
    return { id: started[1], state: "started" };
  }

  const completed =
    /^Download completed\s+\(ID:\s*(\d+)(?:,\s*filename:\s*(.{1,240}))?\)$/i.exec(
      value,
    );
  if (!completed?.[1]) return null;

  const filename = cleanLabel(completed[2] ?? "");
  return {
    id: completed[1],
    state: "completed",
    ...(filename ? { filename } : {}),
  };
}

function getDownloadTargetText(
  args: Record<string, unknown>,
  observedFilename = "",
): string {
  const observed = cleanLabel(observedFilename);
  if (observed) return observed;

  const explicitFilename =
    typeof args.filename === "string" ? cleanLabel(args.filename) : "";
  if (explicitFilename) return explicitFilename;

  const rawUrl = typeof args.url === "string" ? args.url : "";
  if (!rawUrl) return "";

  const fallbackSegment = rawUrl.split(/[/?#]/).filter(Boolean).pop() ?? "";
  try {
    const parsed = new URL(rawUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return cleanLabel(decodeUrlPathSegment(segment));
  } catch {
    return cleanLabel(decodeUrlPathSegment(fallbackSegment));
  }
}

function decodeUrlPathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractUploadFileResultEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  if (params.toolName !== "upload_file") return [];

  const parsed = parseUploadFileResult(params.result);
  if (!parsed) return [];

  const id = Number(params.args.id);
  const key =
    compactKey(parsed.filename) || (Number.isFinite(id) ? `tag-${id}` : "file");

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:upload:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Uploaded file selected: ${parsed.filename} (${parsed.bytes} bytes)`,
        action: "upload",
        targetText: parsed.filename,
        source: "upload_file_result",
        ...(params.currentSnapshot?.url
          ? { url: params.currentSnapshot.url }
          : {}),
      },
    },
  ];
}

type UploadFileResultDetails = {
  filename: string;
  bytes: number;
};

export function parseUploadFileResult(result: string): UploadFileResultDetails | null {
  const match = /^Uploaded\s+"([^"]{1,240})"\s+\((\d+)\s+bytes\)\s+to\b/i.exec(
    result.trim(),
  );
  if (!match?.[1] || !match[2]) return null;

  const filename = cleanLabel(match[1]);
  const bytes = Number(match[2]);
  if (!filename || !Number.isFinite(bytes) || bytes < 0) return null;

  return { filename, bytes };
}
