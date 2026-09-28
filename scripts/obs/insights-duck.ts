/** DuckDB aggregates over the verified Parquet projection (RFC LP-7 B2). */
import { join, resolve } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { estimateCostBreakdownUsd } from "../../apps/extension/src/background/llm/pricing";
import type { ProviderConfig } from "../../apps/extension/src/background/llm/types";
import { extractDomain } from "../log-server-helpers";
import { truncateText } from "../trace-insights";
import type { TraceInsightsFacets, TraceInsightsFilters, TraceInsightsMetricRow, TraceInsightsResponse, TraceInsightsRunRow, TraceInsightsSummary } from "../trace-insights";
import { readParquetSnapshotManifest } from "./duck";
import { turnUsageSelectSql } from "./turn-usage-sql";
import type { ParquetSnapshotManifest } from "./duck";
import { readDuckSelectedSessionIds } from "./insights-filter";

function sqlString(value: string): string {
  return `'${value.replaceAll("\\", "/").replaceAll("'", "''")}'`;
}

function sqlValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type SessionSelection = string | readonly string[] | { readonly selectedTable: true };

async function openConnection(shared?: DuckDBConnection): Promise<DuckDBConnection> {
  if (shared) return shared;
  const { DuckDBConnection } = await import("@duckdb/node-api");
  return DuckDBConnection.create();
}

function selectionPredicate(selection: SessionSelection): string {
  if (typeof selection === "string")
    return selection ? `starts_with(session_id, ${sqlValue(selection)})` : "";
  if ("selectedTable" in selection)
    return "session_id IN (SELECT id FROM selected_sessions)";
  return selection.length > 0
    ? `session_id IN (${selection.map(sqlValue).join(", ")})` : "false";
}

function selectionWhere(selection: SessionSelection): string {
  const predicate = selectionPredicate(selection);
  return predicate ? `WHERE ${predicate}` : "";
}

function selectionAnd(selection: SessionSelection): string {
  const predicate = selectionPredicate(selection);
  return predicate ? `AND ${predicate}` : "";
}

function eventCount(predicate: string): string {
  return `list_count(list_filter(events, event -> ${predicate}))`;
}

function failureLabel(rawJson: string): string {
  return `coalesce(
    nullif(nullif(json_extract_string(${rawJson}, '$.failureCode'), 'none'), ''),
    nullif(nullif(json_extract_string(${rawJson}, '$.failureCategory'), 'none'), ''),
    CASE WHEN json_extract_string(${rawJson}, '$.outcome') IN ('completed', 'success')
      THEN NULL ELSE coalesce(nullif(json_extract_string(${rawJson}, '$.outcome'), ''),
        'unknown_failure') END
  )`;
}

function turnUsageSource(
  root: string, manifest: ParquetSnapshotManifest, filter: string,
): string {
  const path = sqlString(join(root,
    manifest.formatVersion >= 5 ? "turn_usage" : "turn_entries", "*", "*.parquet"));
  return manifest.formatVersion >= 5
    ? `SELECT * FROM read_parquet(${path}) ${filter}`
    : `SELECT * FROM (${turnUsageSelectSql(path)}) ${filter}`;
}

const eventCounts = `
  ${eventCount("json_extract_string(event, '$.type') = 'escalation' OR (json_extract_string(event, '$.type') = 'stuck_signal' AND json_extract_string(event, '$.data.type') = 'escalate')")} AS fires,
  ${eventCount("json_extract_string(event, '$.type') = 'escalation_outcome' AND json_extract_string(event, '$.data.outcome') = 'rescued'")} AS rescued,
  ${eventCount("json_extract_string(event, '$.type') = 'escalation_outcome' AND json_extract_string(event, '$.data.outcome') = 'failed_fast'")} AS failed_fast,
  ${eventCount("json_extract_string(event, '$.type') = 'escalation_outcome' AND json_extract_string(event, '$.data.outcome') = 'budget_exhausted'")} AS budget_exhausted`;

const providerIds = new Set<ProviderConfig["providerId"]>([
  "openrouter", "openai", "groq", "fireworks", "moonshot", "deepseek", "xiaomi",
]);

function providerId(value: unknown, model: string): ProviderConfig["providerId"] | null {
  if (typeof value === "string" && providerIds.has(value as ProviderConfig["providerId"]))
    return value as ProviderConfig["providerId"];
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("accounts/fireworks/") || normalized.includes("kimi-k2p"))
    return "fireworks";
  if (normalized.startsWith("kimi-")) return "moonshot";
  if (normalized.startsWith("deepseek-")) return "deepseek";
  if (normalized.startsWith("mimo-")) return "xiaomi";
  return null;
}

/** Session-derived facet values. The remaining facets require turn and run rows. */
export async function readDuckSessionFacets(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<Pick<TraceInsightsFacets, "runs" | "sessions" | "domains">> {
  readParquetSnapshotManifest(snapshotDir);
  const connection = await openConnection(sharedConnection);
  try {
    const sessions = sqlString(join(resolve(snapshotDir), "sessions", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const reader = await connection.runAndReadAll(`
      SELECT session_id, run_id, json_extract_string(raw_json, '$.startUrl') AS start_url
      FROM read_parquet(${sessions}) ${filter}
    `);
    const rows = reader.getRowObjectsJson();
    const values = (items: Array<string | null>) =>
      [...new Set(items.filter((item): item is string => Boolean(item)))].sort();
    return {
      runs: values(rows.map((row) => String(row.run_id ?? ""))).slice(0, 500),
      sessions: values(rows.map((row) => String(row.session_id ?? ""))).slice(0, 500),
      domains: values(rows.map((row) => extractDomain(row.start_url))),
    };
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Event types visible to the selected sessions, including their linked run events. */
export async function readDuckEventTypeFacets(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsFacets["eventTypes"]> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  if (manifest.formatVersion < 3)
    throw new Error("Run events are required for DuckDB event facets");
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const entries = sqlString(join(root, "turn_entries", "*", "*.parquet"));
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const runFilter = selectionAnd(sessionIdPrefix);
    const runSource = manifest.runEvents ? `
      UNION ALL
      SELECT events.type
      FROM read_parquet(${sqlString(join(root, "run_events", "*", "*.parquet"))}) AS events
      JOIN (
        SELECT DISTINCT run_id FROM read_parquet(${sessions})
        WHERE run_id IS NOT NULL AND run_id != '' ${runFilter}
      ) AS selected_runs ON selected_runs.run_id = events.run_id` : "";
    const rows = await connection.runAndReadAll(`
      WITH event_types AS (
        SELECT unnest(json_extract_string(raw_json, '$.events[*].type')) AS type
        FROM read_parquet(${entries}) ${filter}
        UNION ALL
        SELECT unnest(json_extract_string(raw_json, '$.events[*].type')) AS type
        FROM read_parquet(${sessions}) ${filter}
        ${runSource}
      )
      SELECT DISTINCT type FROM event_types
      WHERE type IS NOT NULL AND type != '' ORDER BY type
    `);
    return rows.getRowObjectsJson().map((row) => String(row.type));
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Event-type breakdown over turn, session, and linked run events. */
export async function readDuckEventRows(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsMetricRow[]> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  if (manifest.formatVersion < 3)
    throw new Error("Run events are required for DuckDB event rows");
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const entries = sqlString(join(root, "turn_entries", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const runSource = manifest.runEvents ? `
      UNION ALL
      SELECT r.sample_session_id AS session_id, event.run_id, r.start_time,
        event.type,
        printf('%s:2:%09d', r.sample_session_id, event.ordinal) AS first_order
      FROM read_parquet(${sqlString(join(root, "run_events", "*", "*.parquet"))}) event
      JOIN selected_runs r ON r.run_id = event.run_id
    ` : "";
    const result = await connection.runAndReadAll(`
      WITH selected AS (
        SELECT session_id, run_id, start_time,
          COALESCE(TRY_CAST(json_extract_string(raw_json, '$.turnCount') AS BIGINT), 0)
            AS turn_count,
          COALESCE(TRY_CAST(json_extract_string(raw_json, '$.metrics.totalCost') AS DOUBLE), 0)
            AS total_cost,
          raw_json
        FROM read_parquet(${sessions}) ${filter}
      ), selected_runs AS (
        SELECT run_id,
          first(session_id ORDER BY start_time DESC, session_id) AS sample_session_id,
          max(start_time) AS start_time
        FROM selected WHERE run_id IS NOT NULL AND run_id != '' GROUP BY run_id
      ), turn_types AS MATERIALIZED (
        SELECT session_id, turn_number,
          json_extract_string(raw_json, '$.events[*].type') AS types
        FROM read_parquet(${entries})
      ), event_source AS (
        SELECT turn.session_id, s.run_id, s.start_time,
          event.type,
          printf('%s:0:%09d:%09d', turn.session_id, turn.turn_number,
            event.ordinal - 1) AS first_order
        FROM turn_types turn
        JOIN selected s ON s.session_id = turn.session_id,
          unnest(turn.types) WITH ORDINALITY AS event(type, ordinal)
        UNION ALL
        SELECT s.session_id, s.run_id, s.start_time,
          json_extract_string(event.value, '$.type') AS type,
          printf('%s:1:%09d', s.session_id,
            TRY_CAST(event.key AS INTEGER)) AS first_order
        FROM selected s, json_each(s.raw_json, '$.events') event
        ${runSource}
      ), event_sessions AS (
        SELECT type, session_id, first(run_id) AS run_id,
          max(start_time) AS start_time, count(*) AS calls,
          min(first_order) AS first_order
        FROM event_source WHERE type IS NOT NULL AND type != ''
        GROUP BY type, session_id
      ), event_totals AS (
        SELECT e.type, count(*) AS sessions, count(DISTINCT e.run_id) AS runs,
          sum(e.calls) AS calls, sum(s.turn_count) AS total_turns,
          sum(s.total_cost) AS total_cost,
          first(e.session_id ORDER BY e.start_time DESC, e.session_id)
            AS sample_session_id,
          first(e.run_id ORDER BY e.start_time DESC, e.session_id)
            AS sample_run_id,
          max(e.start_time) AS newest_start,
          first(e.first_order ORDER BY e.start_time DESC, e.first_order)
            AS first_order
        FROM event_sessions e JOIN selected s ON s.session_id = e.session_id
        GROUP BY e.type
      )
      SELECT * FROM event_totals
      ORDER BY calls DESC, sessions DESC, newest_start DESC, first_order
    `);
    return result.getRowObjectsJson().map((row) => {
      const id = String(row.type);
      return {
        id, label: id, sessions: Number(row.sessions), runs: Number(row.runs),
        calls: Number(row.calls), failureRate: 0,
        totalTurns: Number(row.total_turns) || undefined,
        totalCost: Number(row.total_cost) || undefined,
        sampleSessionId: String(row.sample_session_id ?? "") || undefined,
        sampleRunId: String(row.sample_run_id ?? "") || undefined,
      };
    });
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Model, skill, and tool choices for the selected sessions. */
export async function readDuckWorkflowFacets(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<Pick<TraceInsightsFacets, "models" | "skills" | "tools">> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const entries = sqlString(join(root, "turn_entries", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const readIds = async (source: string, id: string) => {
      const rows = await connection.runAndReadAll(`
        WITH choices AS (${source})
        SELECT DISTINCT ${id} AS id FROM choices
        WHERE ${id} IS NOT NULL AND ${id} != '' ORDER BY id
      `);
      return rows.getRowObjectsJson().map((row) => String(row.id));
    };
    const models = await readIds(`
      SELECT regexp_replace(regexp_replace(trim(model),
        '^accounts/[^/]+/routers/', ''), ':nitro$', '') AS id
      FROM (
        SELECT unnest(json_extract_string(raw_json, '$.models[*]')) AS model
        FROM read_parquet(${sessions}) ${filter}
        UNION ALL
        SELECT unnest(json_keys(raw_json, '$.metrics.modelBreakdown')) AS model
        FROM read_parquet(${sessions}) ${filter}
      )
    `, "id");
    const skills = await readIds(`
      SELECT json_extract_string(raw_json, '$.skillToolMetrics.skillId') AS id
      FROM read_parquet(${sessions}) ${filter}
      UNION ALL
      SELECT unnest(json_extract_string(raw_json,
        '$.planDecomposition.steps[*].selectedSkillId')) AS id
      FROM read_parquet(${sessions}) ${filter}
    `, "id");
    const tools = manifest.formatVersion >= 4 && manifest.toolCalls === 0 ? []
      : await readIds(manifest.formatVersion >= 4 ? `
        SELECT tool_name AS id
        FROM read_parquet(${sqlString(join(root, "tool_calls", "*", "*.parquet"))})
        ${filter}
      ` : `
        SELECT unnest(json_extract_string(raw_json, '$.toolExecutions[*].toolName')) AS id
        FROM read_parquet(${entries}) ${filter}
      `, "id");
    return { models, skills, tools };
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Session failure labels plus authoritative classifications on linked runs. */
export async function readDuckFailureFacets(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsFacets["failures"]> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  if (manifest.formatVersion < 3)
    throw new Error("Run events are required for DuckDB failure facets");
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const events = sqlString(join(root, "run_events", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const rows = await connection.runAndReadAll(`
      WITH selected AS (
        SELECT session_id, run_id,
          ${failureLabel("raw_json")} AS label
        FROM read_parquet(${sessions}) ${filter}
      ), choices AS (
        SELECT label AS id FROM selected
        UNION ALL
        SELECT json_extract_string(e.raw_json, '$.data.classification') AS id
        FROM read_parquet(${events}) e
        JOIN (SELECT DISTINCT run_id FROM selected WHERE run_id IS NOT NULL
          AND run_id != '') linked ON linked.run_id = e.run_id
        WHERE e.type = 'task_completed'
          AND json_extract_string(e.raw_json, '$.data.classification') IS NOT NULL
          AND coalesce(try_cast(json_extract_string(e.raw_json, '$.data.success')
            AS BOOLEAN), false) = false
      )
      SELECT DISTINCT id FROM choices WHERE id IS NOT NULL AND id != '' ORDER BY id
    `);
    return rows.getRowObjectsJson().map((row) => String(row.id));
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Failure breakdown with run classifications that session labels do not cover. */
export async function readDuckFailureRows(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsMetricRow[]> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  if (manifest.formatVersion < 3)
    throw new Error("Run events are required for DuckDB failure rows");
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const events = sqlString(join(root, "run_events", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const selected = `
      SELECT session_id, run_id, start_time,
        COALESCE(TRY_CAST(json_extract_string(raw_json, '$.turnCount') AS BIGINT), 0)
          AS turn_count,
        COALESCE(TRY_CAST(json_extract_string(raw_json, '$.metrics.totalCost') AS DOUBLE), 0)
          AS total_cost,
        ${failureLabel("raw_json")} AS label
      FROM read_parquet(${sessions}) ${filter}
    `;
    const sessionResult = await connection.runAndReadAll(`
      WITH selected AS (${selected})
      SELECT label, count(*) AS sessions, count(DISTINCT run_id) AS runs,
        sum(turn_count) AS total_turns, sum(total_cost) AS total_cost,
        first(session_id ORDER BY start_time DESC, session_id) AS sample_session_id,
        first(run_id ORDER BY start_time DESC, session_id)
          FILTER (WHERE run_id IS NOT NULL AND run_id != '') AS sample_run_id
      FROM selected WHERE label IS NOT NULL
      GROUP BY label ORDER BY max(start_time) DESC, label
    `);
    const rows: TraceInsightsMetricRow[] = sessionResult.getRowObjectsJson().map((row) => {
      const label = String(row.label);
      return {
        id: label, label,
        sessions: Number(row.sessions), runs: Number(row.runs),
        calls: Number(row.sessions), failures: Number(row.sessions), failureRate: 1,
        totalTurns: Number(row.total_turns) || undefined,
        totalCost: Number(row.total_cost) || undefined,
        sampleSessionId: String(row.sample_session_id ?? "") || undefined,
        sampleRunId: String(row.sample_run_id ?? "") || undefined,
      };
    });
    const outcomeResult = await connection.runAndReadAll(`
      WITH selected AS (${selected}), run_outcomes AS (
        SELECT e.run_id,
          first(json_extract_string(e.raw_json, '$.data.classification')
            ORDER BY e.ordinal) AS classification,
          first(TRY_CAST(json_extract_string(e.raw_json, '$.data.success') AS BOOLEAN)
            ORDER BY e.ordinal) AS success,
          first(s.session_id ORDER BY s.start_time DESC, s.session_id)
            AS sample_session_id,
          max(s.start_time) AS first_start_time,
          count(DISTINCT s.session_id) AS sessions,
          sum(s.turn_count) AS total_turns,
          sum(s.total_cost) AS total_cost,
          sum(CASE WHEN s.label = json_extract_string(e.raw_json,
            '$.data.classification') THEN 1 ELSE 0 END) AS already_labeled
        FROM read_parquet(${events}) e
        JOIN selected s ON s.run_id = e.run_id
        WHERE e.type = 'task_completed'
          AND json_extract_string(e.raw_json, '$.data.classification') IS NOT NULL
        GROUP BY e.run_id
      )
      SELECT * FROM run_outcomes ORDER BY first_start_time DESC
    `);
    for (const row of outcomeResult.getRowObjectsJson()) {
      if (row.success === true || Number(row.already_labeled) > 0) continue;
      const label = String(row.classification ?? "");
      if (!label) continue;
      const sessionsInRun = Number(row.sessions);
      const totalTurns = Number(row.total_turns);
      const totalCost = Number(row.total_cost);
      const existing = rows.find((item) => item.id === label);
      if (existing) {
        existing.sessions += sessionsInRun;
        existing.runs += 1;
        existing.calls = (existing.calls ?? 0) + 1;
        existing.failures = (existing.failures ?? 0) + 1;
        existing.totalTurns = (existing.totalTurns ?? 0) + totalTurns || undefined;
        existing.totalCost = (existing.totalCost ?? 0) + totalCost || undefined;
      } else {
        rows.push({
          id: label, label, sessions: sessionsInRun, runs: 1, calls: 1,
          failures: 1, failureRate: 1,
          totalTurns: totalTurns || undefined,
          totalCost: totalCost || undefined,
          sampleSessionId: String(row.sample_session_id ?? "") || undefined,
          sampleRunId: String(row.run_id ?? "") || undefined,
        });
      }
    }
    rows.sort((a, b) =>
      (b.failures ?? 0) - (a.failures ?? 0) ||
      (b.calls ?? 0) - (a.calls ?? 0) || b.sessions - a.sessions);
    return rows;
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Session model membership plus matching turn usage and estimated pricing. */
export async function readDuckModelRows(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsMetricRow[]> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const usage = turnUsageSource(root, manifest, filter);
    const selected = `
      SELECT session_id, run_id, start_time, raw_json,
        json_extract_string(raw_json, '$.outcome') AS outcome,
        COALESCE(TRY_CAST(json_extract_string(raw_json, '$.turnCount') AS BIGINT), 0)
          AS turn_count,
        COALESCE(TRY_CAST(json_extract_string(raw_json, '$.metrics.totalCost') AS DOUBLE), 0)
          AS total_cost
      FROM read_parquet(${sessions}) ${filter}
    `;
    const normalize = (value: string) =>
      `regexp_replace(regexp_replace(trim(coalesce(${value}, '')),
        '^accounts/[^/]+/routers/', ''), ':nitro$', '')`;
    const sessionResult = await connection.runAndReadAll(`
      WITH selected AS (${selected}), model_source AS (
        SELECT s.session_id, json_extract_string(model.value, '$') AS raw_model,
          1 AS listed, TRY_CAST(model.key AS BIGINT) AS position
        FROM selected s, json_each(s.raw_json, '$.models') model
        WHERE json_type(model.value) = 'VARCHAR'
        UNION ALL
        SELECT s.session_id, model.key AS raw_model, 1 AS listed,
          1000000 + TRY_CAST(model.id AS BIGINT) AS position
        FROM selected s, json_each(s.raw_json, '$.metrics.modelBreakdown') model
        UNION ALL
        SELECT turn.session_id, turn.model AS raw_model,
          0 AS listed, 2000000 + turn.turn_number AS position
        FROM (${usage}) turn
        JOIN selected s ON s.session_id = turn.session_id
      ), normalized AS (
        SELECT session_id, ${normalize("raw_model")} AS model, listed, position
        FROM model_source
      ), model_sessions AS (
        SELECT session_id, model, max(listed) AS listed,
          min(position) AS first_position
        FROM normalized WHERE model != '' GROUP BY session_id, model
      )
      SELECT ms.model, count(*) AS sessions, count(DISTINCT s.run_id) AS runs,
        sum(ms.listed) AS calls,
        sum(CASE WHEN ms.listed = 1 AND s.outcome IN ('completed', 'success')
          THEN 1 ELSE 0 END) AS successes,
        sum(CASE WHEN ms.listed = 1 AND (s.outcome NOT IN ('completed', 'success')
          OR s.outcome IS NULL) THEN 1 ELSE 0 END) AS failures,
        sum(s.turn_count) AS total_turns, sum(s.total_cost) AS total_cost,
        first(ms.session_id ORDER BY s.start_time DESC, ms.session_id)
          AS sample_session_id,
        first(s.run_id ORDER BY s.start_time DESC, ms.session_id)
          AS sample_run_id,
        max(s.start_time) AS newest_start,
        first(ms.first_position ORDER BY s.start_time DESC, ms.session_id)
          AS first_position
      FROM model_sessions ms JOIN selected s ON s.session_id = ms.session_id
      GROUP BY ms.model
    `);
    const turnResult = await connection.runAndReadAll(`
      WITH usage_base AS (${usage})
      SELECT model, min(provider) AS provider, count(*) AS requests,
        sum(prompt_tokens) AS prompt_tokens,
        sum(completion_tokens) AS completion_tokens,
        sum(cached_tokens) AS cached_tokens,
        sum(total_tokens) AS total_tokens,
        sum(request_cost) AS request_cost, sum(duration_ms) AS duration_ms,
        count(*) FILTER (WHERE prompt_tokens > 0 OR completion_tokens > 0)
          AS priced_request_candidates
      FROM usage_base WHERE model != '' GROUP BY model
    `);
    const byTurn = new Map(turnResult.getRowObjectsJson().map((row) =>
      [String(row.model), row]));
    const sessionRows = sessionResult.getRowObjectsJson();
    const rows = sessionRows.map((session) => {
      const model = String(session.model);
      const turn = byTurn.get(model);
      const calls = Number(session.calls);
      const failures = Number(session.failures);
      const requests = Number(turn?.requests ?? 0);
      const promptTokens = Number(turn?.prompt_tokens ?? 0);
      const cachedTokens = Number(turn?.cached_tokens ?? 0);
      const completionTokens = Number(turn?.completion_tokens ?? 0);
      const totalTokens = Number(turn?.total_tokens ?? 0);
      const requestCost = Number(turn?.request_cost ?? 0);
      const durationMs = Number(turn?.duration_ms ?? 0);
      const provider = providerId(turn?.provider, model);
      const pricingModel = provider === "fireworks" && !model.includes("/")
        ? `accounts/fireworks/routers/${model}` : model;
      const breakdown = provider ? estimateCostBreakdownUsd(provider, pricingModel, {
        prompt_tokens: promptTokens, completion_tokens: completionTokens,
        total_tokens: totalTokens, cached_tokens: cachedTokens,
      }) : null;
      const estimatedInputCost = breakdown?.inputCostUsd ?? 0;
      const estimatedCachedInputCost = breakdown?.cachedInputCostUsd ?? 0;
      const estimatedOutputCost = breakdown?.outputCostUsd ?? 0;
      const estimatedRequestCost =
        estimatedInputCost + estimatedCachedInputCost + estimatedOutputCost;
      return {
        id: model, label: model,
        sessions: Number(session.sessions), runs: Number(session.runs),
        calls: calls || undefined, requests: requests || undefined,
        successes: Number(session.successes) || undefined,
        failures: failures || undefined,
        failureRate: calls ? failures / calls : undefined,
        averageDurationMs: calls && durationMs > 0 ? durationMs / calls : undefined,
        totalTurns: Number(session.total_turns) || undefined,
        totalCost: Number(session.total_cost) || undefined,
        promptTokens: promptTokens || undefined,
        cachedTokens: cachedTokens || undefined,
        completionTokens: completionTokens || undefined,
        totalTokens: totalTokens || undefined,
        requestCost: requestCost || undefined,
        estimatedInputCost: estimatedInputCost || undefined,
        estimatedCachedInputCost: estimatedCachedInputCost || undefined,
        estimatedOutputCost: estimatedOutputCost || undefined,
        estimatedRequestCost: estimatedRequestCost || undefined,
        outputTokenShare: totalTokens ? completionTokens / totalTokens : undefined,
        outputCostShare: estimatedRequestCost
          ? estimatedOutputCost / estimatedRequestCost : undefined,
        unpricedRequests: breakdown ? undefined
          : Number(turn?.priced_request_candidates ?? 0) || undefined,
        sampleSessionId: String(session.sample_session_id ?? "") || undefined,
        sampleRunId: String(session.sample_run_id ?? "") || undefined,
      } satisfies TraceInsightsMetricRow;
    });
    const order = new Map(sessionRows.map((row) => [String(row.model), row]));
    rows.sort((a, b) =>
      (b.failures ?? 0) - (a.failures ?? 0) ||
      (b.calls ?? 0) - (a.calls ?? 0) || b.sessions - a.sessions ||
      Number(order.get(b.id)?.newest_start ?? 0) -
        Number(order.get(a.id)?.newest_start ?? 0) ||
      Number(order.get(a.id)?.first_position ?? 0) -
        Number(order.get(b.id)?.first_position ?? 0));
    return rows;
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Per-skill session breakdown, deduplicating repeated selections in a session. */
export async function readDuckSkillRows(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsMetricRow[]> {
  readParquetSnapshotManifest(snapshotDir);
  const connection = await openConnection(sharedConnection);
  try {
    const sessions = sqlString(join(resolve(snapshotDir), "sessions", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const result = await connection.runAndReadAll(`
      WITH selected AS (
        SELECT session_id, run_id, start_time, raw_json,
          json_extract_string(raw_json, '$.outcome') AS outcome,
          COALESCE(TRY_CAST(json_extract_string(raw_json, '$.turnCount') AS BIGINT), 0)
            AS turn_count,
          COALESCE(TRY_CAST(json_extract_string(raw_json, '$.metrics.totalCost') AS DOUBLE), 0)
            AS total_cost
        FROM read_parquet(${sessions}) ${filter}
      ), skill_source AS (
        SELECT session_id,
          json_extract_string(raw_json, '$.skillToolMetrics.skillId') AS skill_id,
          0 AS position
        FROM selected
        UNION ALL
        SELECT s.session_id,
          json_extract_string(step.value, '$.selectedSkillId') AS skill_id,
          TRY_CAST(step.key AS INTEGER) + 1 AS position
        FROM selected s, json_each(s.raw_json, '$.planDecomposition.steps') step
      ), skill_sessions AS (
        SELECT skill_id, session_id, min(position) AS first_position
        FROM skill_source WHERE skill_id IS NOT NULL AND skill_id != ''
        GROUP BY skill_id, session_id
      )
      SELECT ss.skill_id, count(*) AS sessions, count(DISTINCT s.run_id) AS runs,
        count(*) FILTER (WHERE s.outcome IN ('completed', 'success')) AS successes,
        count(*) FILTER (WHERE s.outcome NOT IN ('completed', 'success')
          OR s.outcome IS NULL) AS failures,
        sum(s.turn_count) AS total_turns, sum(s.total_cost) AS total_cost,
        first(ss.session_id ORDER BY s.start_time DESC, ss.session_id)
          AS sample_session_id,
        first(s.run_id ORDER BY s.start_time DESC, ss.session_id) AS sample_run_id,
        max(s.start_time) AS newest_start, min(ss.first_position) AS first_position
      FROM skill_sessions ss JOIN selected s ON s.session_id = ss.session_id
      GROUP BY ss.skill_id
      ORDER BY failures DESC, sessions DESC, newest_start DESC, first_position
    `);
    return result.getRowObjectsJson().map((row) => {
      const id = String(row.skill_id);
      const calls = Number(row.sessions);
      const failures = Number(row.failures);
      return {
        id, label: id, sessions: calls, runs: Number(row.runs), calls,
        successes: Number(row.successes) || undefined,
        failures: failures || undefined,
        failureRate: calls ? failures / calls : undefined,
        totalTurns: Number(row.total_turns) || undefined,
        totalCost: Number(row.total_cost) || undefined,
        sampleSessionId: String(row.sample_session_id ?? "") || undefined,
        sampleRunId: String(row.sample_run_id ?? "") || undefined,
      };
    });
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Per-tool calls, failures, duration, and latest failure sample. */
export async function readDuckToolRows(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsMetricRow[]> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  if (manifest.formatVersion >= 4 && manifest.toolCalls === 0) return [];
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const entries = sqlString(join(root, "turn_entries", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const toolSource = manifest.formatVersion >= 4 ? `
      SELECT s.session_id, s.run_id, s.start_time, s.turn_count, s.total_cost,
        tool.turn_number, tool.ordinal, tool.tool_name, tool.success,
        tool.duration_ms, tool.error, tool.result
      FROM read_parquet(${sqlString(join(root, "tool_calls", "*", "*.parquet"))}) tool
      JOIN selected s ON s.session_id = tool.session_id
    ` : `
      SELECT s.session_id, s.run_id, s.start_time, s.turn_count, s.total_cost,
        e.turn_number, TRY_CAST(tool.key AS INTEGER) AS ordinal,
        json_extract_string(tool.value, '$.toolName') AS tool_name,
        CASE WHEN json_extract_string(tool.value, '$.success') = 'true'
          THEN 1 ELSE 0 END AS success,
        COALESCE(TRY_CAST(json_extract_string(tool.value, '$.durationMs') AS DOUBLE), 0)
          AS duration_ms,
        json_extract_string(tool.value, '$.error') AS error,
        json_extract_string(tool.value, '$.result') AS result
      FROM read_parquet(${entries}) e JOIN selected s ON s.session_id = e.session_id,
        json_each(e.raw_json, '$.toolExecutions') tool
    `;
    const result = await connection.runAndReadAll(`
      WITH selected AS (
        SELECT session_id, run_id, start_time,
          COALESCE(TRY_CAST(json_extract_string(raw_json, '$.turnCount') AS BIGINT), 0)
            AS turn_count,
          COALESCE(TRY_CAST(json_extract_string(raw_json, '$.metrics.totalCost') AS DOUBLE), 0)
            AS total_cost
        FROM read_parquet(${sessions}) ${filter}
      ), tool_source AS (
        ${toolSource}
      ), tool_sessions AS (
        SELECT tool_name, session_id, first(run_id) AS run_id,
          count(*) AS calls,
          sum(success) AS successes, count(*) - sum(success) AS failures,
          sum(duration_ms) AS duration_ms,
          min(CAST(turn_number AS BIGINT) * 1000000000 + ordinal) AS first_position,
          first(coalesce(nullif(error, ''), result, '')
            ORDER BY turn_number, ordinal) FILTER (WHERE success = 0)
            AS sample_error,
          first(turn_count) AS turn_count, first(total_cost) AS total_cost,
          first(start_time) AS start_time
        FROM tool_source WHERE tool_name IS NOT NULL AND tool_name != ''
        GROUP BY tool_name, session_id
      ), tool_totals AS (
        SELECT tool_name, count(*) AS sessions, count(DISTINCT run_id) AS runs,
          sum(calls) AS calls, sum(successes) AS successes,
          sum(failures) AS failures, sum(duration_ms) AS duration_ms,
          sum(turn_count) AS total_turns, sum(total_cost) AS total_cost,
          first(session_id ORDER BY start_time DESC, session_id) AS sample_session_id,
          first(run_id ORDER BY start_time DESC, session_id) AS sample_run_id,
          max(start_time) AS newest_start,
          first(first_position ORDER BY start_time DESC, session_id)
            AS first_position,
          first(sample_error ORDER BY start_time DESC, session_id)
            FILTER (WHERE sample_error IS NOT NULL) AS sample_error
        FROM tool_sessions GROUP BY tool_name
      )
      SELECT t.* FROM tool_totals t
      ORDER BY t.failures DESC, t.calls DESC, t.sessions DESC,
        t.newest_start DESC, t.first_position
    `);
    return result.getRowObjectsJson().map((row) => {
      const id = String(row.tool_name);
      const calls = Number(row.calls);
      const failures = Number(row.failures);
      const durationMs = Number(row.duration_ms);
      return {
        id, label: id, sessions: Number(row.sessions), runs: Number(row.runs), calls,
        successes: Number(row.successes) || undefined,
        failures: failures || undefined,
        failureRate: calls ? failures / calls : undefined,
        averageDurationMs: calls && durationMs > 0 ? durationMs / calls : undefined,
        totalTurns: Number(row.total_turns) || undefined,
        totalCost: Number(row.total_cost) || undefined,
        sampleSessionId: String(row.sample_session_id ?? "") || undefined,
        sampleRunId: String(row.sample_run_id ?? "") || undefined,
        sampleError: row.sample_error == null ? undefined : String(row.sample_error),
      };
    });
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** The bounded run table, including top workflows and authoritative outcomes. */
export async function readDuckRunRows(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsRunRow[]> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  if (manifest.formatVersion < 3)
    throw new Error("Run events are required for DuckDB run rows");
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const entries = sqlString(join(root, "turn_entries", "*", "*.parquet"));
    const events = sqlString(join(root, "run_events", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const selected = `
      SELECT session_id, run_id, start_time,
        TRY_CAST(json_extract_string(raw_json, '$.endTime') AS BIGINT) AS end_time,
        json_extract_string(raw_json, '$.query') AS query,
        json_extract_string(raw_json, '$.outcome') AS outcome,
        COALESCE(TRY_CAST(json_extract_string(raw_json, '$.turnCount') AS BIGINT), 0)
          AS turn_count,
        COALESCE(TRY_CAST(json_extract_string(raw_json, '$.metrics.totalCost') AS DOUBLE), 0)
          AS total_cost,
        raw_json
      FROM read_parquet(${sessions}) ${filter}
    `;
    const runResult = await connection.runAndReadAll(`
      WITH selected AS (${selected}), run_sessions AS (
        SELECT * FROM selected WHERE run_id IS NOT NULL AND run_id != ''
      )
      SELECT run_id,
        first(query ORDER BY start_time DESC, session_id) AS query,
        coalesce(first(outcome ORDER BY start_time, session_id)
          FILTER (WHERE outcome NOT IN ('completed', 'success')), 'completed') AS outcome,
        count(*) AS sessions,
        count(*) FILTER (WHERE outcome NOT IN ('completed', 'success') OR outcome IS NULL)
          AS failed_sessions,
        sum(turn_count) AS total_turns,
        sum(total_cost) AS total_cost,
        max(end_time) - min(start_time) AS duration_ms,
        first(session_id ORDER BY start_time, session_id) AS sample_session_id,
        max(start_time) AS newest_start
      FROM run_sessions GROUP BY run_id
      ORDER BY duration_ms DESC, newest_start DESC, run_id LIMIT 200
    `);
    const runRows = runResult.getRowObjectsJson();
    if (runRows.length === 0) return [];
    const displayedRuns = runRows.map((row) => sqlString(String(row.run_id))).join(", ");
    const topToolSource = manifest.formatVersion >= 4 ? `
      SELECT s.run_id, s.session_id, s.start_time,
        t.turn_number, t.ordinal, t.tool_name
      FROM read_parquet(${sqlString(join(root, "tool_calls", "*", "*.parquet"))}) t
      JOIN selected s ON s.session_id = t.session_id
      WHERE s.run_id IN (${displayedRuns})
    ` : `
      SELECT s.run_id, s.session_id, s.start_time, e.turn_number,
        TRY_CAST(t.key AS INTEGER) AS ordinal,
        json_extract_string(t.value, '$.toolName') AS tool_name
      FROM read_parquet(${entries}) e
      JOIN selected s ON s.session_id = e.session_id,
        json_each(e.raw_json, '$.toolExecutions') t
      WHERE s.run_id IN (${displayedRuns})
    `;
    const topToolRows = manifest.formatVersion >= 4 && manifest.toolCalls === 0
      ? [] : (await connection.runAndReadAll(`
      WITH selected AS (${selected}), tool_source AS (
        ${topToolSource}
      ), tool_sessions AS (
        SELECT run_id, session_id, start_time, tool_name,
          count(*) AS calls,
          min(CAST(turn_number AS BIGINT) * 1000000000 + ordinal) AS first_position
        FROM tool_source WHERE tool_name IS NOT NULL AND tool_name != ''
        GROUP BY run_id, session_id, start_time, tool_name
      ), tool_totals AS (
        SELECT run_id, tool_name, sum(calls) AS calls,
          max(start_time) AS newest_start,
          first(first_position ORDER BY start_time DESC, session_id) AS first_position
        FROM tool_sessions GROUP BY run_id, tool_name
      )
      SELECT run_id, tool_name, row_number() OVER (
        PARTITION BY run_id ORDER BY calls DESC, newest_start DESC, first_position
      ) AS rank
      FROM tool_totals
      ORDER BY run_id, rank
    `)).getRowObjectsJson();
    const topSkillsResult = await connection.runAndReadAll(`
      WITH selected AS (${selected}), skill_source AS (
        SELECT run_id, session_id, start_time,
          json_extract_string(raw_json, '$.skillToolMetrics.skillId') AS skill_id,
          0 AS position
        FROM selected WHERE run_id IN (${displayedRuns})
        UNION ALL
        SELECT s.run_id, s.session_id, s.start_time,
          json_extract_string(step.value, '$.selectedSkillId') AS skill_id,
          TRY_CAST(step.key AS INTEGER) + 1 AS position
        FROM selected s, json_each(s.raw_json, '$.planDecomposition.steps') step
        WHERE s.run_id IN (${displayedRuns})
      ), skill_sessions AS (
        SELECT run_id, session_id, skill_id, max(start_time) AS start_time,
          min(position) AS first_position
        FROM skill_source WHERE skill_id IS NOT NULL AND skill_id != ''
        GROUP BY run_id, session_id, skill_id
      ), skill_totals AS (
        SELECT run_id, skill_id, count(*) AS calls,
          max(start_time) AS newest_start, min(first_position) AS first_position
        FROM skill_sessions GROUP BY run_id, skill_id
      )
      SELECT run_id, skill_id, row_number() OVER (
        PARTITION BY run_id ORDER BY calls DESC, newest_start DESC, first_position
      ) AS rank
      FROM skill_totals
      ORDER BY run_id, rank
    `);
    const outcomeResult = await connection.runAndReadAll(`
      SELECT e.run_id,
        json_extract_string(e.raw_json, '$.data.classification') AS classification,
        TRY_CAST(json_extract_string(e.raw_json, '$.data.success') AS BOOLEAN) AS success
      FROM read_parquet(${events}) e
      WHERE e.run_id IN (${displayedRuns}) AND e.type = 'task_completed'
        AND json_extract_string(e.raw_json, '$.data.classification') IS NOT NULL
    `);
    const topByRun = (rows: Array<Record<string, unknown>>, key: string) => {
      const map = new Map<string, string[]>();
      for (const row of rows) {
        if (Number(row.rank) > 3) continue;
        const runId = String(row.run_id ?? "");
        const value = String(row[key] ?? "");
        if (!runId || !value) continue;
        const values = map.get(runId) ?? [];
        values.push(value);
        map.set(runId, values);
      }
      return map;
    };
    const topTools = topByRun(topToolRows, "tool_name");
    const topSkills = topByRun(topSkillsResult.getRowObjectsJson(), "skill_id");
    const outcomes = new Map(outcomeResult.getRowObjectsJson().map((row) =>
      [String(row.run_id), row]));
    return runRows.map((row) => {
      const runId = String(row.run_id);
      const outcome = outcomes.get(runId);
      return {
        runId,
        query: truncateText(String(row.query ?? "")),
        outcome: outcome
          ? outcome.success === true ? "completed" : String(outcome.classification ?? "")
          : String(row.outcome ?? ""),
        sessions: Number(row.sessions),
        failedSessions: Number(row.failed_sessions),
        totalTurns: Number(row.total_turns),
        totalCost: Number(row.total_cost),
        durationMs: Number(row.duration_ms ?? 0),
        topTools: topTools.get(runId) ?? [],
        topSkills: topSkills.get(runId) ?? [],
        sampleSessionId: String(row.sample_session_id ?? ""),
      };
    });
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Full summary; response rows and filters still follow in B2. */
export async function readDuckSummary(
  snapshotDir: string,
  sessionIdPrefix: SessionSelection = "",
  sharedConnection?: DuckDBConnection,
): Promise<TraceInsightsSummary> {
  const manifest = readParquetSnapshotManifest(snapshotDir);
  const connection = await openConnection(sharedConnection);
  try {
    const root = resolve(snapshotDir);
    const sessions = sqlString(join(root, "sessions", "*", "*.parquet"));
    const entries = sqlString(join(root, "turn_entries", "*", "*.parquet"));
    const spans = sqlString(join(root, "turn_spans", "*", "*.parquet"));
    const filter = selectionWhere(sessionIdPrefix);
    const usage = turnUsageSource(root, manifest, filter);
    const sessionRows = await connection.runAndReadAll(`
      SELECT
        count(*) AS total_sessions,
        count(DISTINCT NULLIF(run_id, '')) AS total_runs,
        count(*) FILTER (WHERE json_extract_string(raw_json, '$.outcome') IN ('completed', 'success'))
          AS completed_sessions,
        coalesce(sum(TRY_CAST(json_extract_string(raw_json, '$.turnCount') AS BIGINT)), 0)
          AS total_turns,
        coalesce(sum(TRY_CAST(json_extract_string(raw_json, '$.metrics.totalCost') AS DOUBLE)), 0)
          AS total_cost,
        coalesce(avg(greatest(0,
          coalesce(TRY_CAST(json_extract_string(raw_json, '$.endTime') AS DOUBLE), 0) -
          coalesce(TRY_CAST(json_extract_string(raw_json, '$.startTime') AS DOUBLE), 0))), 0)
          AS average_duration_ms,
        count(*) FILTER (WHERE nullif(json_type(raw_json, '$.partialHandoff'), 'NULL') IS NOT NULL)
          AS partial_handoff_count,
        count(*) FILTER (WHERE json_extract_string(raw_json, '$.outcome') = 'max_turns'
          AND nullif(json_type(raw_json, '$.partialHandoff'), 'NULL') IS NOT NULL)
          AS max_turns_with_handoff_count,
        count(*) FILTER (WHERE json_extract_string(raw_json, '$.outcome') = 'max_turns'
          AND (nullif(json_type(raw_json, '$.partialHandoff'), 'NULL') IS NULL OR (
            coalesce(json_array_length(raw_json, '$.partialHandoff.evidence'), 0) = 0
            AND coalesce(json_array_length(raw_json, '$.partialHandoff.completed'), 0) = 0
            AND nullif(json_extract_string(raw_json, '$.partialHandoff.currentState.url'), '') IS NULL
            AND nullif(json_extract_string(raw_json, '$.partialHandoff.currentState.title'), '') IS NULL
          ))) AS max_turns_without_useful_progress_count
      FROM read_parquet(${sessions}) ${filter}
    `);
    const turnRows = await connection.runAndReadAll(`
      WITH usage_rows AS (${usage})
      SELECT count(*) AS llm_requests,
        coalesce(sum(prompt_tokens), 0) AS prompt_tokens,
        coalesce(sum(completion_tokens), 0) AS completion_tokens,
        coalesce(sum(cached_tokens), 0) AS cached_tokens,
        coalesce(sum(total_tokens), 0) AS total_tokens,
        coalesce(sum(request_cost), 0) AS request_cost,
        coalesce(sum(duration_ms) FILTER (WHERE duration_ms > 0), 0)
          AS total_llm_duration_ms,
        coalesce(avg(duration_ms) FILTER (WHERE duration_ms > 0), 0)
          AS average_llm_duration_ms
      FROM usage_rows
    `);
    const modelRows = await connection.runAndReadAll(`
      WITH model_base AS (${usage})
      SELECT model, min(provider) AS provider,
        sum(prompt_tokens) AS prompt_tokens,
        sum(completion_tokens) AS completion_tokens,
        sum(cached_tokens) AS cached_tokens,
        sum(total_tokens) AS total_tokens,
        count(*) FILTER (WHERE prompt_tokens > 0 OR completion_tokens > 0)
          AS priced_request_candidates
      FROM model_base WHERE model != '' GROUP BY model
    `);
    const toolFilter = selectionAnd(sessionIdPrefix);
    const toolRows = await connection.runAndReadAll(`
      SELECT count(*) AS tool_calls,
        count(*) FILTER (WHERE json_extract_string(raw_json, '$.status.code') = 'error')
          AS tool_failures
      FROM read_parquet(${spans})
      WHERE kind = 'execute_tool' AND name != 'execute_tool ' ${toolFilter}
    `);
    const eventRows = await connection.runAndReadAll(`
      WITH source_events AS (
        SELECT session_id, json_extract(raw_json, '$.events[*]') AS events
        FROM read_parquet(${entries}) ${filter}
        UNION ALL
        SELECT session_id, json_extract(raw_json, '$.events[*]') AS events
        FROM read_parquet(${sessions}) ${filter}
      ), event_counts AS (
        SELECT session_id, ${eventCounts} FROM source_events
      ), per_session AS (
        SELECT session_id, sum(fires) AS fires, sum(rescued) AS rescued,
          sum(failed_fast) AS failed_fast, sum(budget_exhausted) AS budget_exhausted
        FROM event_counts GROUP BY session_id
      )
      SELECT count(*) FILTER (WHERE fires > 0) AS escalated_sessions,
        coalesce(sum(fires), 0) AS escalations,
        coalesce(sum(rescued), 0) AS rescued,
        coalesce(sum(failed_fast), 0) AS failed_fast,
        coalesce(sum(budget_exhausted), 0) AS budget_exhausted
      FROM per_session
    `);
    const row = sessionRows.getRowObjectsJson()[0] ?? {};
    const turn = turnRows.getRowObjectsJson()[0] ?? {};
    const tools = toolRows.getRowObjectsJson()[0] ?? {};
    const events = eventRows.getRowObjectsJson()[0] ?? {};
    const totalSessions = Number(row.total_sessions ?? 0);
    const completedSessions = Number(row.completed_sessions ?? 0);
    const failedSessions = totalSessions - completedSessions;
    const totalTurns = Number(row.total_turns ?? 0);
    const toolCalls = Number(tools.tool_calls ?? 0);
    const toolFailures = Number(tools.tool_failures ?? 0);
    const llmRequests = Number(turn.llm_requests ?? 0);
    const promptTokens = Number(turn.prompt_tokens ?? 0);
    const completionTokens = Number(turn.completion_tokens ?? 0);
    const cachedTokens = Number(turn.cached_tokens ?? 0);
    const totalTokens = Number(turn.total_tokens ?? 0);
    let estimatedInputCost = 0;
    let estimatedCachedInputCost = 0;
    let estimatedOutputCost = 0;
    let unpricedRequests = 0;
    for (const modelRow of modelRows.getRowObjectsJson()) {
      const model = String(modelRow.model ?? "");
      const provider = providerId(modelRow.provider, model);
      const pricingModel = provider === "fireworks" && !model.includes("/")
        ? `accounts/fireworks/routers/${model}` : model;
      const breakdown = provider ? estimateCostBreakdownUsd(provider, pricingModel, {
        prompt_tokens: Number(modelRow.prompt_tokens ?? 0),
        completion_tokens: Number(modelRow.completion_tokens ?? 0),
        cached_tokens: Number(modelRow.cached_tokens ?? 0),
        total_tokens: Number(modelRow.total_tokens ?? 0),
      }) : null;
      if (breakdown) {
        estimatedInputCost += breakdown.inputCostUsd;
        estimatedCachedInputCost += breakdown.cachedInputCostUsd;
        estimatedOutputCost += breakdown.outputCostUsd;
      } else {
        unpricedRequests += Number(modelRow.priced_request_candidates ?? 0);
      }
    }
    const estimatedRequestCost =
      estimatedInputCost + estimatedCachedInputCost + estimatedOutputCost;
    const escalatedSessions = Number(events.escalated_sessions ?? 0);
    const escalationRescued = Number(events.rescued ?? 0);
    const escalationFailedFast = Number(events.failed_fast ?? 0);
    const escalationBudgetExhausted = Number(events.budget_exhausted ?? 0);
    const resolvedEscalations = escalationRescued + escalationFailedFast + escalationBudgetExhausted;
    return {
      totalSessions,
      totalRuns: Number(row.total_runs ?? 0),
      completedSessions,
      failedSessions,
      successRate: totalSessions ? completedSessions / totalSessions : 0,
      failureRate: totalSessions ? failedSessions / totalSessions : 0,
      totalTurns,
      averageTurns: totalSessions ? totalTurns / totalSessions : 0,
      totalCost: Number(row.total_cost ?? 0),
      averageDurationMs: Number(row.average_duration_ms ?? 0),
      toolCalls,
      toolFailures,
      toolFailureRate: toolCalls ? toolFailures / toolCalls : 0,
      llmRequests,
      promptTokens,
      completionTokens,
      cachedTokens,
      nonCachedInputTokens: Math.max(0, promptTokens - cachedTokens),
      totalTokens,
      requestCost: Number(turn.request_cost ?? 0),
      estimatedInputCost,
      estimatedCachedInputCost,
      estimatedOutputCost,
      estimatedRequestCost,
      outputTokenShare: totalTokens ? completionTokens / totalTokens : 0,
      outputCostShare: estimatedRequestCost ? estimatedOutputCost / estimatedRequestCost : 0,
      unpricedRequests,
      averagePromptTokens: llmRequests ? promptTokens / llmRequests : 0,
      averageCompletionTokens: llmRequests ? completionTokens / llmRequests : 0,
      averageTotalTokens: llmRequests ? totalTokens / llmRequests : 0,
      totalLlmDurationMs: Number(turn.total_llm_duration_ms ?? 0),
      averageLlmDurationMs: Number(turn.average_llm_duration_ms ?? 0),
      partialHandoffCount: Number(row.partial_handoff_count ?? 0),
      maxTurnsWithHandoffCount: Number(row.max_turns_with_handoff_count ?? 0),
      maxTurnsWithoutUsefulProgressCount: Number(row.max_turns_without_useful_progress_count ?? 0),
      escalatedSessions,
      escalations: Number(events.escalations ?? 0),
      escalationRescued,
      escalationFailedFast,
      escalationBudgetExhausted,
      escalationFireRate: totalSessions ? escalatedSessions / totalSessions : 0,
      escalationRescueRate: resolvedEscalations ? escalationRescued / resolvedEscalations : 0,
    };
  } finally {
    if (!sharedConnection) connection.closeSync();
  }
}

/** Complete response over the same selected sessions as the SQLite insights reader. */
export async function readDuckInsightsResponse(
  snapshotDir: string,
  filters: TraceInsightsFilters = {},
): Promise<TraceInsightsResponse> {
  const active = Object.entries(filters).filter(([, value]) =>
    value != null && value !== "" && value !== "all");
  const selection: SessionSelection = active.every(([key]) =>
    key === "sessionId" || key === "sessionPrefix")
    ? (filters.sessionId?.trim() || filters.sessionPrefix?.trim() || "")
    : await readDuckSelectedSessionIds(snapshotDir, filters);
  const connection = await openConnection();
  try {
    const selected = Array.isArray(selection) ? selection : null;
    if (selected) {
      await connection.run(selected.length > 0
        ? `CREATE TEMP TABLE selected_sessions AS
          SELECT unnest([${selected.map(sqlValue).join(", ")}]) AS id`
        : "CREATE TEMP TABLE selected_sessions(id VARCHAR)");
    }
    const sharedSelection: SessionSelection = selected ? { selectedTable: true } : selection;
    const summary = await readDuckSummary(snapshotDir, sharedSelection, connection);
    const sessionFacets = await readDuckSessionFacets(snapshotDir, sharedSelection, connection);
    const workflowFacets = await readDuckWorkflowFacets(snapshotDir, sharedSelection, connection);
    const failures = await readDuckFailureRows(snapshotDir, sharedSelection, connection);
    const events = await readDuckEventRows(snapshotDir, sharedSelection, connection);
    return {
      summary,
      facets: {
        ...sessionFacets, ...workflowFacets,
        failures: failures.map((row) => row.id).sort(),
        eventTypes: events.map((row) => row.id).sort(),
      },
      tools: await readDuckToolRows(snapshotDir, sharedSelection, connection),
      skills: await readDuckSkillRows(snapshotDir, sharedSelection, connection),
      models: await readDuckModelRows(snapshotDir, sharedSelection, connection),
      failures, events,
      runs: await readDuckRunRows(snapshotDir, sharedSelection, connection),
    };
  } finally {
    connection.closeSync();
  }
}
