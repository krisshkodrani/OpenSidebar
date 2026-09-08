export type SandboxCompletionPayload = {
  status?: string;
  terminationReason?: string;
};

type LocationView = Pick<Location, "hostname" | "pathname">;
type FetchView = typeof fetch;

export async function reportSandboxTaskCompletion(
  payload: SandboxCompletionPayload | undefined,
  locationView: LocationView = window.location,
  fetchView: FetchView = fetch,
): Promise<boolean> {
  if (locationView.hostname !== "play.opensidebar.com") return false;
  const match = /^\/run\/([^/]+)$/.exec(locationView.pathname);
  if (!match) return false;

  const status = payload?.status;
  const terminalStatus = status === "completed"
    ? "completed"
    : status === "stopped"
      ? "stopped"
      : status === "partial"
        ? "clarification"
        : "failed";
  const response = await fetchView("/api/v1/target/result", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schemaVersion: 1,
      runId: decodeURIComponent(match[1]),
      terminalStatus,
      completionDecision: status === "completed" ? "accepted" : "none",
      terminalReason: terminalStatus === "completed"
        ? "objective_reached"
        : terminalStatus === "clarification"
          ? "permanent_blocker"
          : terminalStatus === "stopped"
            ? "user_stopped"
            : "agent_error",
      emittedAt: new Date().toISOString(),
    }),
  });
  return response.ok;
}
