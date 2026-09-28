/** Select canonical session IDs before DuckDB insight aggregation. */
import { join, resolve } from "node:path";
import { extractDomain, getSessionModels, isIsoDay, normalizeTraceModelId } from "../log-server-helpers";
import type { TraceSessionLike } from "../log-server-helpers";
import type { TraceInsightsFilters } from "../trace-insights";
import { readParquetSnapshotManifest } from "./duck";

function sqlString(value: string): string {
  return `'${value.replaceAll("\\", "/").replaceAll("'", "''")}'`;
}

function sqlValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function localDayStartMs(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).getTime();
}

function localNextDayStartMs(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date + 1).getTime();
}

function failureLabel(session: TraceSessionLike): string | null {
  const value = (candidate: unknown) =>
    typeof candidate === "string" && candidate && candidate !== "none"
      ? candidate : null;
  return value(session.failureCode) ?? value(session.failureCategory) ??
    ((session.outcome === "completed" || session.outcome === "success")
      ? null : value(session.outcome) ?? "unknown_failure");
}

export async function readDuckSelectedSessionIds(
  snapshotDir: string,
  filters: TraceInsightsFilters,
): Promise<string[]> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  const { DuckDBConnection } = await import("@duckdb/node-api");
  const connection = await DuckDBConnection.create();
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const entries = sqlString(join(root, "turn_entries", "*", "*.parquet"));
    const rows = (await connection.runAndReadAll(`
      SELECT session_id, run_id, start_time, raw_json
      FROM read_parquet(${sessions})
    `)).getRowObjectsJson();
    const value = (input: unknown) => typeof input === "string" ? input.trim() : "";
    const day = value(filters.day);
    const from = isIsoDay(value(filters.from)) ? value(filters.from) : "";
    const to = isIsoDay(value(filters.to)) ? value(filters.to) : "";
    const outcome = value(filters.outcome);
    const domain = value(filters.domain).toLowerCase();
    const runId = value(filters.runId);
    const prefix = value(filters.sessionId) || value(filters.sessionPrefix);
    const q = value(filters.q).toLowerCase();
    const model = normalizeTraceModelId(value(filters.model));
    const mode = value(filters.mode);
    const skill = value(filters.skill).toLowerCase();
    const failure = value(filters.failure);
    let selected = rows.filter((row) => {
      const session = JSON.parse(String(row.raw_json)) as TraceSessionLike;
      const id = String(row.session_id);
      const start = row.start_time == null ? NaN : Number(row.start_time);
      if ((isIsoDay(day) && day !== "all" || from || to) && !Number.isFinite(start))
        return false;
      if (day && day !== "all" && isIsoDay(day)) {
        if (!(start >= localDayStartMs(day) && start < localNextDayStartMs(day)))
          return false;
      } else {
        if (from && start < localDayStartMs(from)) return false;
        if (to && start >= localNextDayStartMs(to)) return false;
      }
      if (outcome && outcome !== "all" && session.outcome !== outcome) return false;
      if (domain && !extractDomain(session.startUrl)?.includes(domain)) return false;
      if (runId && !String(row.run_id ?? "").startsWith(runId)) return false;
      if (prefix && !id.startsWith(prefix)) return false;
      if (q && ![session.query, session.startUrl, id].some((text) =>
        String(text ?? "").toLowerCase().includes(q))) return false;
      const models = getSessionModels(session);
      if (model && model !== "all" && !models.includes(model)) return false;
      if (mode === "recording" && !models.includes("recording")) return false;
      if (mode === "manual" && !models.includes("manual")) return false;
      if (mode === "agent" && (models.includes("recording") ||
        models.includes("manual"))) return false;
      if (skill && !String(row.raw_json).toLowerCase().includes(skill)) return false;
      if (failure && failure !== "all" && failureLabel(session) !== failure)
        return false;
      return true;
    }).map((row) => ({ id: String(row.session_id), runId: String(row.run_id ?? "") }));
    const intersect = (ids: Set<string>) => {
      selected = selected.filter((row) => ids.has(row.id));
    };
    const tier = value(filters.tier);
    if (tier && tier !== "all") {
      const source = manifest.formatVersion >= 5
        ? `read_parquet(${sqlString(join(root, "turn_usage", "*", "*.parquet"))})`
        : `read_parquet(${entries})`;
      const criterion = manifest.formatVersion >= 5 ? "model_tier" :
        "json_extract_string(raw_json, '$.llmRequest.modelTier')";
      const tierRows = await connection.runAndReadAll(`
        SELECT DISTINCT session_id FROM ${source}
        WHERE ${criterion} = ${sqlValue(tier)}
      `);
      intersect(new Set(tierRows.getRowObjectsJson().map((row) => String(row.session_id))));
    }
    const tool = value(filters.tool);
    const toolStatus = value(filters.toolStatus);
    if (tool || (toolStatus && toolStatus !== "all")) {
      if (manifest.formatVersion >= 4 && manifest.toolCalls === 0) return [];
      const source = manifest.formatVersion >= 4
        ? `SELECT session_id, tool_name, success FROM read_parquet(${sqlString(join(root,
          "tool_calls", "*", "*.parquet"))})`
        : `SELECT session_id, json_extract_string(tool.value, '$.toolName') AS tool_name,
          CASE WHEN json_extract_string(tool.value, '$.success') = 'true'
            THEN 1 ELSE 0 END AS success
          FROM read_parquet(${entries}), json_each(raw_json, '$.toolExecutions') tool`;
      const conditions = [tool ? `tool_name = ${sqlValue(tool)}` : "",
        toolStatus === "success" ? "success = 1" : "",
        toolStatus === "failure" ? "success = 0" : ""].filter(Boolean);
      const toolRows = await connection.runAndReadAll(`
        SELECT DISTINCT session_id FROM (${source}) WHERE ${conditions.join(" AND ")}
      `);
      intersect(new Set(toolRows.getRowObjectsJson().map((row) => String(row.session_id))));
    }
    const eventType = value(filters.eventType);
    if (eventType && eventType !== "all") {
      const event = sqlValue(eventType);
      const localRows = await connection.runAndReadAll(`
        SELECT session_id FROM read_parquet(${entries})
        WHERE list_contains(json_extract_string(raw_json, '$.events[*].type'), ${event})
        UNION
        SELECT session_id FROM read_parquet(${sessions})
        WHERE list_contains(json_extract_string(raw_json, '$.events[*].type'), ${event})
      `);
      const ids = new Set(localRows.getRowObjectsJson().map((row) => String(row.session_id)));
      if (manifest.formatVersion >= 3 && manifest.runEvents) {
        const runRows = await connection.runAndReadAll(`
          SELECT DISTINCT run_id FROM read_parquet(${sqlString(join(root,
            "run_events", "*", "*.parquet"))}) WHERE type = ${event}
        `);
        const runs = new Set(runRows.getRowObjectsJson().map((row) => String(row.run_id)));
        selected.forEach((row) => { if (row.runId && runs.has(row.runId)) ids.add(row.id); });
      }
      intersect(ids);
    }
    return selected.map((row) => row.id).sort();
  } finally {
    connection.closeSync();
  }
}
