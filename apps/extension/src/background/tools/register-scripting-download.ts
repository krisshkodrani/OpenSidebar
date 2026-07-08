/**
 * Scripting + download tool registrations (RFC LP-16 Phase 4). execute_js runs
 * a snippet in the page; download_file fetches a URL and waits for the download
 * to settle. Verbatim movement from tools/index.ts.
 */
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { sanitizeUrl } from "../security";
import { chromeDownloadsPort } from "../environment/chrome";
import { ToolRegistry } from "./registry";
import { formatUnknownError } from "./bridge";
import { EXECUTE_JS_DEF, DOWNLOAD_FILE_DEF } from "./definitions";
import {
  waitForDownloadCompletion,
  basenameFromDownloadPath,
} from "./download-helpers";

export function registerScriptingDownloadTools(toolRegistry: ToolRegistry): void {
    toolRegistry.register(
      ToolName.EXECUTE_JS,
      EXECUTE_JS_DEF,
      async (args, tabId) => {
        const code = args.code as string;
        logger.info("tools", "execute_js", {
          tabId,
          codeLen: code.length,
          codeSnippet: code.slice(0, 120),
        });
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN" as any,
            func: (c: string) => {
              const serialize = (value: unknown): string => {
                if (value === null || value === undefined) return String(value);
                if (typeof value === "object") {
                  try {
                    return JSON.stringify(value, null, 2);
                  } catch {
                    return String(value);
                  }
                }
                return String(value);
              };
  
              const formatError = (error: unknown): string => {
                if (error instanceof Error) return error.message;
                return String(error);
              };
  
              try {
                // Prefer expression mode, then fall back to statement mode.
                try {
                  const expressionRunner = new Function(
                    `"use strict"; return (${c});`,
                  );
                  return serialize(expressionRunner());
                } catch {
                  const statementRunner = new Function(`"use strict"; ${c}`);
                  return serialize(statementRunner());
                }
              } catch (error: unknown) {
                return `Error: ${formatError(error)}`;
              }
            },
            args: [code],
          });
          const value = results?.[0]?.result;
          if (value === undefined || value === "undefined") {
            return (
              "undefined\n\n⚠ Script returned undefined — the return value was lost. " +
              "Use a simpler expression (e.g. document.querySelector(...).textContent) " +
              "or try read_element / inspect_hidden instead. Do NOT retry the same script."
            );
          }
          return value;
        } catch (error: unknown) {
          return `Error executing JS: ${formatUnknownError(error)}`;
        }
      },
    );
  
    toolRegistry.register(
      ToolName.DOWNLOAD_FILE,
      DOWNLOAD_FILE_DEF,
      async (args, _tabId, signal) => {
        const url = args.url as string;
        const filename = args.filename as string | undefined;
        const urlResult = sanitizeUrl(url);
        if (!urlResult.ok) return `Error: ${urlResult.error}`;
        logger.info("tools", "download_file", { url: urlResult.value, filename });
  
        try {
          const opts: any = { url: urlResult.value };
          if (filename) {
            // Strip path traversal and absolute path components
            opts.filename = filename
              .replace(/\.\.[/\\]/g, "")
              .replace(/^[/\\]+/, "")
              .replace(/\0/g, "");
          }
          const downloadId = await chromeDownloadsPort.download(opts);
          const completed = await waitForDownloadCompletion(downloadId, signal);
          if (completed.status === "completed") {
            const completedFilename =
              basenameFromDownloadPath(completed.filename) ||
              (typeof opts.filename === "string" ? opts.filename : "") ||
              filename ||
              "";
            return `Download completed (ID: ${downloadId}${
              completedFilename ? `, filename: ${completedFilename}` : ""
            })`;
          }
          if (completed.status === "interrupted") {
            return `Error: Download interrupted (ID: ${downloadId}${
              completed.error ? `, reason: ${completed.error}` : ""
            })`;
          }
          return `Download started (ID: ${downloadId})`;
        } catch (e: any) {
          return `Error starting download: ${e.message}`;
        }
      },
    );
}
