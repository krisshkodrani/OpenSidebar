import { chromePersistencePort } from "./environment/chrome";

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
