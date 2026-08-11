import { Client, Connection } from "@temporalio/client";
import { validateShadowEvent, type ShadowEventV1 } from "./contracts";

type Claimed = ShadowEventV1 & { claimToken: string };

export async function runShadowPoller(signal: AbortSignal) {
  const base = process.env.TEMPORAL_SHADOW_API_URL;
  const token = process.env.TEMPORAL_SHADOW_TOKEN;
  if (!base || !token) return;
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "temporal:7233",
  });
  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "opensidebar-spike",
  });
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(`shadow_api_${response.status}`);
    return response;
  };
  try {
    while (!signal.aborted) {
      try {
        const response = await request("/claims", { limit: 25 });
        const events =
          ((await response.json()) as { events?: Claimed[] }).events ?? [];
        for (const claimed of events) {
          const { claimToken, ...event } = claimed;
          try {
            validateShadowEvent(event);
            await client.workflow.signalWithStart("shadowSessionWorkflow", {
              workflowId: `shadow-session-${event.sessionId}`,
              taskQueue:
                process.env.TEMPORAL_TASK_QUEUE ?? "opensidebar-spike-v1",
              args: [event],
              signal: "shadow_event",
              signalArgs: [event],
            });
            await request(`/events/${event.eventId}/complete`, { claimToken });
          } catch {
            await request(`/events/${event.eventId}/retry`, {
              claimToken,
            }).catch(() => undefined);
          }
        }
        await new Promise((resolve) =>
          setTimeout(resolve, events.length ? 100 : 1_000),
        );
      } catch (error) {
        if (signal.aborted) break;
        console.error(
          "temporal_shadow_poll_failed",
          error instanceof Error ? error.message : "unknown",
        );
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  } finally {
    await connection.close();
  }
}
