import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "../server.js";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const REALTIME_MODEL = "gpt-realtime-2";

const REALTIME_SESSION_CONFIG = {
  type: "realtime",
  model: REALTIME_MODEL,
  instructions: [
    "You are OpenSidebar voice control.",
    "You are a concise spoken interface for an existing browser automation harness.",
    "Do not browse or automate pages yourself.",
    "Use the provided tools to start tasks, guide a running task, stop, approve, answer clarification, or read state.",
    "Keep spoken responses short and action-oriented.",
  ].join("\n"),
  audio: {
    output: {
      voice: "marin",
    },
    input: {
      turn_detection: {
        type: "server_vad",
      },
    },
  },
  tools: [
    {
      type: "function",
      name: "start_browser_task",
      description: "Start a new OpenSidebar browser automation task.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: {
            type: "string",
            description: "The user's browser task request.",
          },
        },
        required: ["text"],
      },
    },
    {
      type: "function",
      name: "send_agent_guidance",
      description: "Send guidance or a correction into the current running task.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: {
            type: "string",
            description: "Guidance for the running browser agent.",
          },
        },
        required: ["text"],
      },
    },
    {
      type: "function",
      name: "stop_agent",
      description: "Stop the currently running browser agent task.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          reason: {
            type: "string",
            description: "Optional reason for stopping.",
          },
        },
        required: [],
      },
    },
    {
      type: "function",
      name: "approve_pending_action",
      description: "Approve or reject the currently pending OpenSidebar action.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          approved: {
            type: "boolean",
            description: "Whether the pending action is approved.",
          },
          note: {
            type: "string",
            description: "Optional short user note.",
          },
        },
        required: ["approved"],
      },
    },
    {
      type: "function",
      name: "answer_clarification",
      description: "Answer the clarification question currently asked by the browser agent.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: {
            type: "string",
            description: "The user's clarification answer.",
          },
        },
        required: ["text"],
      },
    },
    {
      type: "function",
      name: "read_current_state",
      description: "Read the current OpenSidebar run state.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
    {
      type: "function",
      name: "read_latest_result",
      description: "Read the latest assistant result shown in OpenSidebar.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
    {
      type: "function",
      name: "choose_recommended_escalation",
      description: "Choose the recommended option for the currently pending escalation decision.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: [],
      },
    },
  ],
} as const;

function getRealtimeApiKey(): string {
  return (
    process.env.OPENAI_REALTIME_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export async function handleRealtimeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  if (ctx.pathname !== "/realtime/calls") {
    ctx.sendError(res, "Not found", 404);
    return;
  }

  if (ctx.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (ctx.method !== "POST") {
    ctx.sendError(res, "Method not allowed", 405);
    return;
  }

  const apiKey = getRealtimeApiKey();
  if (!apiKey) {
    ctx.sendError(
      res,
      "OpenAI Realtime is not configured. Set OPENAI_REALTIME_API_KEY or OPENAI_API_KEY in the backend environment.",
      503,
    );
    return;
  }

  const sdp = (await ctx.parseTextBody(req)).trim();
  if (!sdp) {
    ctx.sendError(res, "Missing SDP offer body.", 400);
    return;
  }

  const body = new FormData();
  body.set("sdp", sdp);
  body.set("session", JSON.stringify(REALTIME_SESSION_CONFIG));

  const upstream = await fetch(OPENAI_REALTIME_CALLS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    ctx.sendError(
      res,
      `OpenAI Realtime call failed (${upstream.status}): ${text.slice(0, 300)}`,
      upstream.status >= 500 ? 502 : upstream.status,
    );
    return;
  }

  setCorsHeaders(res);
  res.writeHead(upstream.status || 201, { "Content-Type": "application/sdp" });
  res.end(text);
}
