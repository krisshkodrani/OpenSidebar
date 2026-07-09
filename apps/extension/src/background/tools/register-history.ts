/**
 * Browser-history tool registrations (RFC LP-16 Phase 4). search_history over
 * the chrome history port. Verbatim movement from tools/index.ts.
 */
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { chromeHistoryPort } from "../environment/chrome";
import { ToolRegistry } from "./registry";
import { SEARCH_HISTORY_DEF } from "./definitions";

export function registerHistoryTools(toolRegistry: ToolRegistry): void {
    toolRegistry.register(
      ToolName.SEARCH_HISTORY,
      SEARCH_HISTORY_DEF,
      async (args) => {
        const query = args.query as string;
        const maxResults = (args.maxResults as number) || 20;
        logger.info("tools", "search_history", { query, maxResults });
        try {
          const items = await chromeHistoryPort.search({
            text: query,
            maxResults,
          });
          if (items.length === 0) return "No history entries found.";
          return items
            .map((item: any) => {
              const lastVisit = item.lastVisitTime
                ? new Date(item.lastVisitTime).toISOString().slice(0, 16)
                : "unknown";
              return `${item.title || "(untitled)"} — ${item.url} (visited ${item.visitCount || 1} time(s), last: ${lastVisit})`;
            })
            .join("\n");
        } catch (e: any) {
          return `Error searching history: ${e.message}`;
        }
      },
    );
}
