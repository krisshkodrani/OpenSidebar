import { chromePersistencePort } from "./environment/chrome";
import type { BrowserCommandV1 } from "@shared-types/cloud-sessions";
import { chromeBrowserPagePort, chromeContentBridgePort } from "./environment";
import { createCloudCommandExecution } from "./cloud-device-read-policy";

export const E2E_TEST_API_ENABLED_STORAGE_KEY =
  "opensidebar:e2eTestApiEnabled";

export const E2E_VISIBLE_RAIL_STORAGE_KEY =
  "opensidebar:e2eVisibleRail";

export const E2E_SEED_PENDING_INTERACTION_MESSAGE_TYPE =
  "E2E_SEED_PENDING_INTERACTION";

export type E2ESeedPendingInteractionMessage = {
  type: typeof E2E_SEED_PENDING_INTERACTION_MESSAGE_TYPE;
  payload: unknown;
};

export type E2EExecuteCloudCommandMessage = {
  type: "E2E_EXECUTE_CLOUD_COMMAND";
  payload: { tabId: number; command: BrowserCommandV1; locallyApproved?: boolean };
};

export function isE2ESeedPendingInteractionMessage(
  message: unknown,
): message is E2ESeedPendingInteractionMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type ===
      E2E_SEED_PENDING_INTERACTION_MESSAGE_TYPE
  );
}

export async function isE2ETestApiEnabled(): Promise<boolean> {
  const stored = await chromePersistencePort.local.get(E2E_TEST_API_ENABLED_STORAGE_KEY);
  return stored?.[E2E_TEST_API_ENABLED_STORAGE_KEY] === true;
}

export function isE2EExecuteCloudCommandMessage(
  message: unknown,
): message is E2EExecuteCloudCommandMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "E2E_EXECUTE_CLOUD_COMMAND"
  );
}

export async function executeE2ECloudCommand(
  message: E2EExecuteCloudCommandMessage,
) {
  if (import.meta.env.MODE !== "e2e" || !(await isE2ETestApiEnabled()))
    return { ok: false as const, detail: "E2E test API is disabled" };
  const execution = createCloudCommandExecution(message.payload.tabId, {
    pages: chromeBrowserPagePort,
    content: chromeContentBridgePort,
    isPageAuthorized: async (url) => /^https?:\/\//i.test(url),
    consumeLocalApproval: async () => message.payload.locallyApproved === true,
  });
  const validation = await execution.validateAndGround(message.payload.command, "e2e");
  if (validation === "approval_required")
    return { ok: false as const, approvalRequired: true as const };
  if (!validation)
    return { ok: false as const, detail: "Command was not freshly grounded" };
  return { ok: true as const, outcome: await execution.dispatch(message.payload.command) };
}
