import { describe, expect, it, vi } from "vitest";
import { reportSandboxTaskCompletion } from "../../src/content/sandbox-completion";

describe("Playground completion reporting", () => {
  it("posts a closed completion result to the live target endpoint", async () => {
    const request = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(reportSandboxTaskCompletion(
      { status: "completed", terminationReason: "ignored-private-detail" },
      { hostname: "play.opensidebar.com", pathname: "/run/r_public123" },
      request,
    )).resolves.toBe(true);

    expect(request).toHaveBeenCalledOnce();
    const [path, init] = request.mock.calls[0];
    expect(path).toBe("/api/v1/target/result");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      schemaVersion: 1,
      runId: "r_public123",
      terminalStatus: "completed",
      completionDecision: "accepted",
      terminalReason: "objective_reached",
    });
    expect(String(init?.body)).not.toContain("ignored-private-detail");
  });

  it("does not report outside an active Playground target", async () => {
    const request = vi.fn();
    await expect(reportSandboxTaskCompletion(
      { status: "completed" },
      { hostname: "opensidebar.com", pathname: "/playground" },
      request,
    )).resolves.toBe(false);
    await expect(reportSandboxTaskCompletion(
      { status: "completed" },
      { hostname: "play.opensidebar.com", pathname: "/" },
      request,
    )).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
