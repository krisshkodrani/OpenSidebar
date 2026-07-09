/**
 * Cookie tool registrations (RFC LP-16 Phase 4). get_cookies / set_cookie /
 * delete_cookie over the chrome cookies port, with URL sanitization on writes.
 * Verbatim movement from tools/index.ts.
 */
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { sanitizeUrl } from "../security";
import { chromeCookiesPort } from "../environment/chrome";
import { ToolRegistry } from "./registry";
import {
  GET_COOKIES_DEF,
  SET_COOKIE_DEF,
  DELETE_COOKIE_DEF,
} from "./definitions";

export function registerCookieTools(toolRegistry: ToolRegistry): void {
    toolRegistry.register(
      ToolName.GET_COOKIES,
      GET_COOKIES_DEF,
      async (args, tabId) => {
        let url = args.url as string | undefined;
        if (!url) {
          try {
            const tab = await chrome.tabs.get(tabId);
            url = tab.url;
          } catch {
            return "Error: Could not determine current tab URL.";
          }
        }
        if (!url) return "Error: No URL available.";
        logger.info("tools", "get_cookies", { url });
        try {
          const cookies = await chromeCookiesPort.getAll({ url });
          if (cookies.length === 0) return "No cookies found for this URL.";
          return cookies.map((c: any) => `${c.name}=${c.value}`).join("\n");
        } catch (e: any) {
          return `Error getting cookies: ${e.message}`;
        }
      },
    );
  
    toolRegistry.register(ToolName.SET_COOKIE, SET_COOKIE_DEF, async (args) => {
      const rawUrl = args.url as string;
      const urlResult = sanitizeUrl(rawUrl);
      if (!urlResult.ok) return `Error: ${urlResult.error}`;
      const url = urlResult.value;
      const name = args.name as string;
      const value = args.value as string;
      const domain = args.domain as string | undefined;
      const path = args.path as string | undefined;
      logger.info("tools", "set_cookie", { url, name, domain, path });
      try {
        const opts: any = { url, name, value };
        if (domain) opts.domain = domain;
        if (path) opts.path = path;
        await chromeCookiesPort.set(opts);
        return `Cookie "${name}" set on ${url}`;
      } catch (e: any) {
        return `Error setting cookie: ${e.message}`;
      }
    });
  
    toolRegistry.register(
      ToolName.DELETE_COOKIE,
      DELETE_COOKIE_DEF,
      async (args) => {
        const rawUrl = args.url as string;
        const urlResult = sanitizeUrl(rawUrl);
        if (!urlResult.ok) return `Error: ${urlResult.error}`;
        const url = urlResult.value;
        const name = args.name as string;
        logger.info("tools", "delete_cookie", { url, name });
        try {
          await chromeCookiesPort.remove({ url, name });
          return `Cookie "${name}" deleted from ${url}`;
        } catch (e: any) {
          return `Error deleting cookie: ${e.message}`;
        }
      },
    );
}
