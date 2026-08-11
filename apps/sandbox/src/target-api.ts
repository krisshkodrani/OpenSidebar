import type { SandboxRun } from "@sandbox-contracts";

export type TargetRun = Pick<
  SandboxRun,
  "id" | "scenarioId" | "scenarioVersion" | "revision"
> & {
  /** Deliberately a projection: controller fields (timing, feasibility, etc.) never cross this boundary. */
  state: Record<string, unknown>;
};

/** The target exposes no control capability; it authorizes via its host-only session cookie. */
export async function loadTargetRun(): Promise<TargetRun> {
  const response = await fetch("/api/v1/target/state", {
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new Error("This target session is no longer available.");
  const payload = (await response.json()) as { run: TargetRun };
  return payload.run;
}

export async function submitTargetAction(
  action:
    | "restock.addToCart"
    | "purchase.placeOrder"
    | "email.send"
    | "table.update"
    | "registration.submit",
  details: Record<string, unknown> = {},
): Promise<TargetRun> {
  const response = await fetch("/api/v1/target/action", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ action, ...details }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message ?? "That action is not available.");
  }
  const payload = (await response.json()) as { run: TargetRun };
  return payload.run;
}
