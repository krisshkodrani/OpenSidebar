import {
  DEFAULT_JOBAGENT_MCP_URL,
  ToolName,
  type UserSettings,
} from "../../types";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const REQUEST_TIMEOUT_MS = 30_000;

const JOBAGENT_TOOL_NAMES = new Set<string>([
  ToolName.LIST_APPLICATION_PACKAGES,
  ToolName.GET_APPLICATION_PACKAGE,
  ToolName.SUGGEST_FORM_ANSWERS,
  ToolName.GET_CANDIDATE_PROFILE,
  ToolName.ANSWER_CANDIDATE_QUESTION,
  ToolName.RECORD_APPLICATION_STATUS,
]);

export interface JobAgentMcpConfig {
  enabled: boolean;
  url: string;
  token: string;
}

type JsonRpcId = number | string;

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

type FetchLike = typeof fetch;

export function getJobAgentMcpConfig(settings: UserSettings): JobAgentMcpConfig {
  return {
    enabled: settings.jobAgentMcpEnabled === true,
    url: (settings.jobAgentMcpUrl || DEFAULT_JOBAGENT_MCP_URL).trim(),
    token: (settings.jobAgentMcpToken || "").trim(),
  };
}

export function formatJobAgentMcpResult(
  toolName: ToolName,
  result: unknown,
): string {
  const payload = result as {
    content?: unknown;
    isError?: unknown;
    structuredContent?: unknown;
  };
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const textParts = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const candidate = part as { type?: unknown; text?: unknown };
      if (candidate.type === "text" && typeof candidate.text === "string") {
        return candidate.text;
      }
      return "";
    })
    .filter(Boolean);

  const body =
    textParts.length > 0
      ? textParts.join("\n")
      : payload?.structuredContent !== undefined
        ? JSON.stringify(payload.structuredContent, null, 2)
        : JSON.stringify(result, null, 2);

  const prefix =
    payload?.isError === true
      ? `JobAgent MCP tool ${toolName} returned an error:`
      : `JobAgent MCP tool ${toolName} result:`;
  return `${prefix}\n${body}`;
}

export class JobAgentMcpClient {
  private nextId = 1;
  private initialized = false;
  private sessionId: string | null = null;
  private negotiatedProtocolVersion = MCP_PROTOCOL_VERSION;

  constructor(
    private readonly config: JobAgentMcpConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async listTools(signal?: AbortSignal): Promise<unknown> {
    await this.ensureInitialized(signal);
    return this.request("tools/list", {}, signal);
  }

  async callTool(
    toolName: ToolName,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!JOBAGENT_TOOL_NAMES.has(toolName)) {
      throw new Error(`Unsupported JobAgent MCP tool: ${toolName}`);
    }
    await this.ensureInitialized(signal);
    return this.request(
      "tools/call",
      { name: toolName, arguments: args },
      signal,
    );
  }

  private async ensureInitialized(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    const result = (await this.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "opensidebar",
          version: "0.9.1",
        },
      },
      signal,
      { skipInitializedCheck: true },
    )) as { protocolVersion?: unknown };
    if (typeof result.protocolVersion === "string") {
      this.negotiatedProtocolVersion = result.protocolVersion;
    }
    await this.notify("notifications/initialized", {}, signal);
    this.initialized = true;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    options: { skipInitializedCheck?: boolean } = {},
  ): Promise<unknown> {
    if (!options.skipInitializedCheck && !this.initialized) {
      await this.ensureInitialized(signal);
    }
    const id = this.nextId++;
    const response = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method,
        params,
      },
      signal,
    );
    const message = Array.isArray(response)
      ? response.find((item) => item.id === id)
      : response;
    if (!message) {
      throw new Error(`JobAgent MCP returned no response for ${method}.`);
    }
    if ("error" in message) {
      throw new Error(formatJsonRpcError(message));
    }
    return message.result;
  }

  private async notify(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.post(
      {
        jsonrpc: "2.0",
        method,
        params,
      },
      signal,
      { expectResponse: false },
    );
  }

  private async post(
    message: Record<string, unknown>,
    signal?: AbortSignal,
    options: { expectResponse?: boolean } = {},
  ): Promise<JsonRpcResponse | JsonRpcResponse[]> {
    const response = await this.fetchWithTimeout(
      this.config.url,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(message),
      },
      signal,
    );

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;

    const contentType = response.headers.get("content-type") || "";
    const text = response.status === 202 ? "" : await response.text();

    if (!response.ok) {
      throw new Error(formatHttpError(response.status, text));
    }
    if (response.status === 202 || options.expectResponse === false) {
      return [];
    }
    if (contentType.includes("text/event-stream")) {
      const messages = parseSseJsonRpcMessages(text);
      if (messages.length === 0) {
        throw new Error("JobAgent MCP returned an empty SSE response.");
      }
      return messages.length === 1 ? messages[0] : messages;
    }
    if (contentType.includes("application/json") || text.trim().startsWith("{")) {
      return parseJsonRpcPayload(text);
    }
    throw new Error(
      `JobAgent MCP returned unsupported content type "${contentType || "unknown"}".`,
    );
  }

  private buildHeaders(): Headers {
    const headers = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: `Bearer ${this.config.token}`,
      "mcp-protocol-version": this.negotiatedProtocolVersion,
    });
    if (this.sessionId) {
      headers.set("mcp-session-id", this.sessionId);
    }
    return headers;
  }

  private async fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      signal.addEventListener("abort", abortFromCaller, { once: true });
    }
    try {
      return await this.fetchFn(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("JobAgent MCP request timed out or was cancelled.");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", abortFromCaller);
    }
  }
}

let cachedClientKey = "";
let cachedClient: JobAgentMcpClient | null = null;

export function getCachedJobAgentMcpClient(
  config: JobAgentMcpConfig,
): JobAgentMcpClient {
  const key = `${config.url}\n${config.token}`;
  if (!cachedClient || cachedClientKey !== key) {
    cachedClient = new JobAgentMcpClient(config);
    cachedClientKey = key;
  }
  return cachedClient;
}

export async function callConfiguredJobAgentMcpTool(
  settings: UserSettings,
  toolName: ToolName,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const config = getJobAgentMcpConfig(settings);
  if (!config.enabled) {
    return "Error: JobAgent MCP is disabled. Enable it in Settings and configure the local HTTP endpoint before using this tool.";
  }
  if (!config.url) {
    return "Error: JobAgent MCP URL is missing.";
  }
  if (!config.token) {
    return "Error: JobAgent MCP bearer token is missing.";
  }
  try {
    const result = await getCachedJobAgentMcpClient(config).callTool(
      toolName,
      args,
      signal,
    );
    return formatJobAgentMcpResult(toolName, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error calling JobAgent MCP tool ${toolName}: ${message}`;
  }
}

function parseJsonRpcPayload(text: string): JsonRpcResponse | JsonRpcResponse[] {
  try {
    return JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
  } catch (error) {
    throw new Error(
      `JobAgent MCP returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function parseSseJsonRpcMessages(text: string): JsonRpcResponse[] {
  const messages: JsonRpcResponse[] = [];
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") continue;
    const parsed = parseJsonRpcPayload(payload);
    if (Array.isArray(parsed)) {
      messages.push(...parsed);
    } else {
      messages.push(parsed);
    }
  }
  return messages;
}

function formatJsonRpcError(message: JsonRpcFailure): string {
  const error = message.error;
  const detail =
    error.data === undefined
      ? ""
      : ` (${typeof error.data === "string" ? error.data : JSON.stringify(error.data)})`;
  return `${error.message || "JSON-RPC error"}${detail}`;
}

function formatHttpError(status: number, text: string): string {
  if (status === 401) {
    return "HTTP 401 from JobAgent MCP. Check the bearer token in OpenSidebar Settings.";
  }
  if (status === 403) {
    return (
      "HTTP 403 from JobAgent MCP. Check JOBAGENT_MCP_ALLOWED_ORIGINS; Chrome extension requests may need the extension origin allowed."
    );
  }
  return `HTTP ${status} from JobAgent MCP${text ? `: ${text}` : ""}`;
}
