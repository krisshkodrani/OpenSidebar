export interface SyntheticActivityInput {
  sessionId: string;
  revision: number;
  operationId: string;
  fault?: "lose_first_response";
}

const completedOperations = new Map<string, number>();
const lostResponses = new Set<string>();

export async function commitSyntheticCheckpoint(input: SyntheticActivityInput) {
  // These values deliberately exist only inside activity memory. They must never
  // enter workflow payloads, activity results, errors, metrics, or logs.
  const activityLocalCanaries = {
    email: "canary@example.invalid",
    url: "https://canary.invalid/private",
    authorization: "Bearer CANARY_AUTHORIZATION",
    providerKey: "sk-CANARY_PROVIDER_KEY",
    cookie: "session=CANARY_COOKIE",
    prompt: "CANARY_PROMPT_TEXT",
    screenshot: "CANARY_SCREENSHOT_BYTES",
    checkpointPlaintext: "CANARY_CHECKPOINT_PLAINTEXT",
  };
  void activityLocalCanaries;
  const committedRevision =
    completedOperations.get(input.operationId) ?? input.revision + 1;
  completedOperations.set(input.operationId, committedRevision);
  if (
    input.fault === "lose_first_response" &&
    !lostResponses.has(input.operationId)
  ) {
    lostResponses.add(input.operationId);
    throw new Error("synthetic_transient_response_loss");
  }
  return {
    operationId: input.operationId,
    committedRevision,
  };
}

export async function deleteSyntheticSession(input: SyntheticActivityInput) {
  return { operationId: input.operationId, deleted: true as const };
}

export async function waitForOperatorRecovery(input: SyntheticActivityInput) {
  await new Promise((resolve) => setTimeout(resolve, 5 * 60_000));
  return { operationId: input.operationId, recovered: false as const };
}
