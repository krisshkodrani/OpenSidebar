/**
 * Observability MCP server (RFC LP-7, Stage A).
 *
 * A stdio Model Context Protocol server that exposes the existing trace store
 * to agents (e.g. Claude Code) so they can search traces "with ease". Every
 * tool is a thin wrapper over `core.ts`, which itself only reuses the functions
 * the log-server HTTP API already uses — no new query logic lives here.
 *
 * Run:  pnpm run mcp   (or: tsx scripts/obs/mcp-server.ts)
 * Register: see repo-root `.mcp.json`.
 */

import { resolve } from "path";
import { fileURLToPath } from "url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  compareRuns,
  createDiskStore,
  findFailures,
  getBlob,
  getRun,
  getSpan,
  getRlTrajectory,
  getTrace,
  getTrajectory,
  indexStatus,
  listToolUsage,
  queryInsights,
  searchTraces,
} from "./core";
import { redactPii } from "./redact";

const store = createDiskStore();

// Shared JSON-Schema fragment for the insight/search filters.
const FILTER_PROPS = {
  outcome: { type: "string", description: "Session outcome (completed, error, max_turns, …)" },
  domain: { type: "string", description: "Substring match on the page domain" },
  model: { type: "string", description: "LLM model id" },
  runId: { type: "string", description: "Orchestrator run id" },
  tier: { type: "string", description: "executor | planner" },
  skill: { type: "string", description: "Skill id" },
  tool: { type: "string", description: "Tool name" },
  toolStatus: { type: "string", description: "success | error" },
  failure: { type: "string", description: "Failure code/category" },
  eventType: { type: "string", description: "Trace event type" },
  day: { type: "string", description: "YYYY-MM-DD" },
  from: { type: "string", description: "ISO start of range" },
  to: { type: "string", description: "ISO end of range" },
  q: { type: "string", description: "Free-text query over query/url/session id" },
  sessionId: { type: "string", description: "Exact session id" },
  sessionPrefix: { type: "string", description: "Session id prefix" },
  mode: { type: "string", description: "recording | manual | agent" },
} as const;

const SESSION_ID_SCHEMA = {
  type: "object",
  properties: { sessionId: { type: "string", description: "Agent session id (UUID)" } },
  required: ["sessionId"],
} as const;

const BLOB_SCHEMA = {
  type: "object",
  properties: {
    sessionId: { type: "string", description: "Agent session id" },
    turn: { type: "number", description: "Turn number" },
  },
  required: ["sessionId", "turn"],
} as const;

const tools = [
  {
    name: "search_traces",
    description:
      "Search recorded agent trace sessions by outcome/domain/model/run/tier/date/free-text. Returns session summaries (newest first).",
    inputSchema: {
      type: "object",
      properties: {
        ...FILTER_PROPS,
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "get_trace",
    description: "Get one session's full turn-by-turn entries.",
    inputSchema: SESSION_ID_SCHEMA,
  },
  {
    name: "get_run",
    description: "Get an orchestrator run's events and the session ids it spans.",
    inputSchema: {
      type: "object",
      properties: { runId: { type: "string", description: "Orchestrator run id" } },
      required: ["runId"],
    },
  },
  {
    name: "query_insights",
    description:
      "Aggregated metrics (success/failure, cost, tokens, tools, skills, models, runs) for the filtered set — same shape as the viewer's insights panel.",
    inputSchema: { type: "object", properties: FILTER_PROPS },
  },
  {
    name: "find_failures",
    description: "Failure-facet rows (code/category counts) for the filtered set.",
    inputSchema: { type: "object", properties: FILTER_PROPS },
  },
  {
    name: "list_tool_usage",
    description: "Per-tool call and failure rollup for the filtered set.",
    inputSchema: { type: "object", properties: FILTER_PROPS },
  },
  {
    name: "get_trajectory",
    description:
      "OpenClaw-style graded trajectory scorecard for a session: 1–5 dimensions (task_completion/tool_use/reliability/safety), grade-to-lowest verdict, action tiers, per-turn profiles.",
    inputSchema: SESSION_ID_SCHEMA,
  },
  {
    name: "get_rl_trajectory",
    description:
      "OpenClaw (state, action, reward) trajectory for a session: per-turn state (url/perception/blob refs) + action (tools) + shaped reward; terminal reward is the 1–5 grade-to-lowest score. For eval/training inspection.",
    inputSchema: SESSION_ID_SCHEMA,
  },
  {
    name: "compare_runs",
    description: "Find related sessions for comparative debugging of a base session.",
    inputSchema: SESSION_ID_SCHEMA,
  },
  {
    name: "get_blob",
    description: "Fetch a turn screenshot (path + base64) for a session.",
    inputSchema: BLOB_SCHEMA,
  },
  {
    name: "get_span",
    description:
      "Interim turn-as-span view for a session+turn (full OTel spans arrive with Stage B0).",
    inputSchema: BLOB_SCHEMA,
  },
  {
    name: "index_status",
    description: "Health/coverage of the SQLite trace index (sessions, turns, days).",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

type Args = Record<string, unknown>;
const str = (args: Args, key: string): string => {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
};
const num = (args: Args, key: string): number => {
  const value = args[key];
  if (typeof value !== "number") {
    throw new Error(`Missing required number argument: ${key}`);
  }
  return value;
};

function runTool(name: string, args: Args): unknown {
  switch (name) {
    case "search_traces":
      return searchTraces(store, args);
    case "get_trace":
      return getTrace(store, str(args, "sessionId"));
    case "get_run":
      return getRun(store, str(args, "runId"));
    case "query_insights":
      return queryInsights(store, args);
    case "find_failures":
      return findFailures(store, args);
    case "list_tool_usage":
      return listToolUsage(store, args);
    case "get_trajectory":
      return getTrajectory(store, str(args, "sessionId"));
    case "get_rl_trajectory":
      return getRlTrajectory(store, str(args, "sessionId"));
    case "compare_runs":
      return compareRuns(store, str(args, "sessionId"));
    case "get_blob":
      return getBlob(str(args, "sessionId"), num(args, "turn"));
    case "get_span":
      return getSpan(store, str(args, "sessionId"), num(args, "turn"));
    case "index_status":
      return indexStatus(store);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Public tool entrypoint. Redacts PII from every agent-facing result at the MCP
 * boundary (RFC LP-8, M1). `get_blob` is exempt: it returns a base64 screenshot
 * that must not be regex-scrubbed.
 */
export function dispatch(name: string, args: Args): unknown {
  const result = runTool(name, args);
  if (name === "get_blob") return result;
  return redactPii(result);
}

async function main(): Promise<void> {
  const server = new Server(
    { name: "opensidebar-observability", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = dispatch(name, (args ?? {}) as Args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Error in ${name}: ${(error as Error).message}` },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stays alive on stdio until the client disconnects.
}

// Only auto-start when run directly (not when imported by tests). Compare
// resolved filesystem paths — robust across platforms and the tsx loader.
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[observability-mcp] fatal:", error);
    process.exit(1);
  });
}
