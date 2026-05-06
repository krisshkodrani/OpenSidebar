export type E2EDefaultSuiteName =
  | "smoke"
  | "interaction-regression"
  | "runtime-regression";
export type E2EFocusSuiteName = "nightly-legacy" | "overlay-harness";
export type E2ESuiteName = E2EDefaultSuiteName | E2EFocusSuiteName;

export const E2E_SUITES: Record<E2ESuiteName, readonly string[]> = {
  smoke: [
    "summarize.test.ts",
    "login.test.ts",
    "structural-loading.test.ts",
    "session-state-import.test.ts",
    "delayed-content.test.ts",
    "clarification-recovery.test.ts",
    "mutation-dedupe-recovery.test.ts",
  ],
  "interaction-regression": [
    "autocomplete.test.ts",
    "edge-cases.test.ts",
    "execute-js.test.ts",
    "go-back-navigation.test.ts",
    "hover-menus.test.ts",
    "infinite-scroll.test.ts",
    "keyboard-nav.test.ts",
    "modal-overlays.test.ts",
    "navigation-challenge.test.ts",
    "online-shop.test.ts",
    "perception-auto-vision.test.ts",
    "web-components.test.ts",
  ],
  "runtime-regression": [
    "approval-recovery.test.ts",
    "backend-durable-resume.test.ts",
    "continuation-abandon-restart.test.ts",
    "continuation-act-check-act.test.ts",
    "continuation-cart-swap.test.ts",
    "continuation-cross-page-compose.test.ts",
    "continuation-cross-tab.test.ts",
    "continuation-verify.test.ts",
    "continuation.test.ts",
    "lane-topology.test.ts",
    "profile-checkout.test.ts",
    "profile-experience-application.test.ts",
    "profile-job-application.test.ts",
    "sequential-tasks.test.ts",
    "stop-drain-recovery.test.ts",
    "structured-progress-resume.test.ts",
  ],
  "nightly-legacy": [
    "context-menu.test.ts",
    "date-picker.test.ts",
    "faq-accordion.test.ts",
  ],
  "overlay-harness": ["overlay-harness.test.ts"],
};

export const E2E_SUITE_ORDER: readonly E2EDefaultSuiteName[] = [
  "smoke",
  "interaction-regression",
  "runtime-regression",
];

export const E2E_FOCUS_SUITE_ORDER: readonly E2EFocusSuiteName[] = [
  "nightly-legacy",
  "overlay-harness",
];

export const E2E_CANONICAL_SUITE_ORDER: readonly E2ESuiteName[] = [
  ...E2E_SUITE_ORDER,
  ...E2E_FOCUS_SUITE_ORDER,
];
