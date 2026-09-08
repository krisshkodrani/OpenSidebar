import type { JsonObject, ScenarioActionV2, ScenarioTargetViewV2 } from "@opensidebar/scenario-contracts";

type ApiErrorPayload = { error?: { message?: string } };
async function responseError(response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  return new Error(payload?.error?.message ?? "The simulated application could not update.");
}
export async function loadScenarioTarget(): Promise<ScenarioTargetViewV2> {
  const response = await fetch("/api/v2/target/state", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { run: ScenarioTargetViewV2 }).run;
}
export async function sendScenarioAction(action: string, payload: JsonObject = {}): Promise<ScenarioTargetViewV2> {
  const body: ScenarioActionV2 = { type: action, payload };
  const response = await fetch("/api/v2/target/action", { method: "POST", credentials: "include", cache: "no-store", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as { run: ScenarioTargetViewV2 }).run;
}
