/**
 * Download-completion polling helpers (RFC LP-16 Phase 4). Waits for a
 * chrome download to reach a terminal state and normalizes its filename/error.
 * Verbatim movement from tools/index.ts.
 */

type ObservedDownloadCompletion =
  | { status: "completed"; filename?: string }
  | { status: "interrupted"; error?: string }
  | { status: "unobserved" };


const DOWNLOAD_COMPLETION_WAIT_MS = 2500;

export async function waitForDownloadCompletion(
  downloadId: number,
  signal?: AbortSignal,
): Promise<ObservedDownloadCompletion> {
  const downloads = chrome.downloads as any;
  if (!downloads) return { status: "unobserved" };

  const initial = await queryDownloadItem(downloads, downloadId);
  const initialTerminal = terminalDownloadState(initial);
  if (initialTerminal) return initialTerminal;

  const onChanged = downloads.onChanged;
  if (
    !onChanged ||
    typeof onChanged.addListener !== "function" ||
    typeof onChanged.removeListener !== "function"
  ) {
    return { status: "unobserved" };
  }

  return await new Promise<ObservedDownloadCompletion>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: ObservedDownloadCompletion) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try {
        onChanged.removeListener(listener);
      } catch {
        // Best effort cleanup for browser/test doubles.
      }
      resolve(result);
    };

    const listener = async (delta: any) => {
      if (delta?.id !== downloadId) return;
      const state = delta.state?.current;
      if (state !== "complete" && state !== "interrupted") return;

      const item = await queryDownloadItem(downloads, downloadId);
      const terminal = terminalDownloadState(item);
      if (terminal) {
        finish(terminal);
        return;
      }
      if (state === "complete") {
        finish({ status: "completed" });
        return;
      }
      finish({
        status: "interrupted",
        error: cleanDownloadError(delta.error?.current),
      });
    };

    try {
      onChanged.addListener(listener);
    } catch {
      finish({ status: "unobserved" });
      return;
    }

    void queryDownloadItem(downloads, downloadId).then((item) => {
      const terminal = terminalDownloadState(item);
      if (terminal) finish(terminal);
    });

    if (signal?.aborted) {
      finish({ status: "unobserved" });
      return;
    }

    timeout = setTimeout(
      () => finish({ status: "unobserved" }),
      DOWNLOAD_COMPLETION_WAIT_MS,
    );
  });
}

async function queryDownloadItem(
  downloads: any,
  downloadId: number,
): Promise<any | null> {
  if (typeof downloads.search !== "function") return null;
  try {
    const items = await downloads.search({ id: downloadId });
    return Array.isArray(items) ? (items[0] ?? null) : null;
  } catch {
    return null;
  }
}

function terminalDownloadState(item: any): ObservedDownloadCompletion | null {
  if (!item) return null;
  if (item.state === "complete") {
    if (item.exists === false) {
      return { status: "interrupted", error: "file missing after completion" };
    }
    const filename = basenameFromDownloadPath(item.filename);
    return {
      status: "completed",
      ...(filename ? { filename } : {}),
    };
  }
  if (item.state === "interrupted") {
    return {
      status: "interrupted",
      error: cleanDownloadError(item.error || item.errorMessage),
    };
  }
  return null;
}

export function basenameFromDownloadPath(value: unknown): string {
  if (typeof value !== "string") return "";
  const segment = value.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return (segment ?? "").replace(/\0/g, "").slice(0, 240);
}

function cleanDownloadError(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, 240) : undefined;
}
