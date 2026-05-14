import { describe, expect, test, vi } from "vitest";
import "../setup";
import {
  callConfiguredJobAgentMcpTool,
  formatJobAgentMcpResult,
  JobAgentMcpClient,
} from "../../src/background/mcp/jobagent-client";
import { ToolName } from "../../src/types";

function sse(payload: unknown): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("JobAgent MCP client", () => {
  test("initializes, sends auth, and calls a tool over streamable HTTP", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}")) as {
          id?: number;
          method?: string;
        };
        if (body.method === "initialize") {
          return sse({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-11-25", capabilities: {} },
          });
        }
        if (body.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }
        return sse({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: "{\"ok\":true}" }],
          },
        });
      },
    );
    const client = new JobAgentMcpClient(
      {
        enabled: true,
        url: "http://127.0.0.1:3727/mcp",
        token: "local-dev-token",
      },
      fetchMock as unknown as typeof fetch,
    );

    const result = await client.callTool(ToolName.LIST_APPLICATION_PACKAGES, {
      status_filter: "ready",
    });

    expect(
      formatJobAgentMcpResult(ToolName.LIST_APPLICATION_PACKAGES, result),
    ).toContain("{\"ok\":true}");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Headers;
      expect(headers.get("authorization")).toBe("Bearer local-dev-token");
      expect(headers.get("accept")).toContain("application/json");
      expect(headers.get("accept")).toContain("text/event-stream");
    }
  });

  test("surfaces HTTP auth failures clearly through the configured wrapper", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response("no", { status: 401 }),
    ) as unknown as typeof fetch;
    try {
      const result = await callConfiguredJobAgentMcpTool(
        {
          openRouterApiKey: "",
          maxTurns: 1,
          theme: "system",
          showSessionMetrics: true,
          requireApprovals: true,
          allowNavigation: true,
          jobAgentMcpEnabled: true,
          jobAgentMcpUrl: "http://127.0.0.1:3727/mcp",
          jobAgentMcpToken: "bad-token",
        },
        ToolName.LIST_APPLICATION_PACKAGES,
        {},
      );

      expect(result).toContain("HTTP 401 from JobAgent MCP");
      expect(result).toContain("bearer token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not call fetch when JobAgent MCP is disabled", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await callConfiguredJobAgentMcpTool(
        {
          openRouterApiKey: "",
          maxTurns: 1,
          theme: "system",
          showSessionMetrics: true,
          requireApprovals: true,
          allowNavigation: true,
          jobAgentMcpEnabled: false,
        },
        ToolName.LIST_APPLICATION_PACKAGES,
        {},
      );

      expect(result).toContain("JobAgent MCP is disabled");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
