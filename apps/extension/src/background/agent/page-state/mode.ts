export type PageStateCoordinatorMode = "shadow" | "authoritative";

/**
 * Internal build-time rollout switch. It is intentionally absent from user
 * settings and executor prompts. LP-38 removes this switch after acceptance.
 */
export const PAGE_STATE_COORDINATOR_MODE: PageStateCoordinatorMode =
  import.meta.env.VITE_PAGE_STATE_COORDINATOR_MODE === "authoritative"
    ? "authoritative"
    : "shadow";
