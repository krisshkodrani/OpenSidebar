export type E2EDefaultSuiteName =
  | "smoke"
  | "interaction-regression"
  | "runtime-regression";
export type E2EFocusSuiteName =
  | "nightly-legacy"
  | "overlay-harness"
  | "parallel-workers"
  | "local-mock-provider"
  | "showcase"
  | "memory-regression"
  | "multi-turn-workflows"
  | "escalation-rescue"
  | "arena";
export type E2ESuiteName = E2EDefaultSuiteName | E2EFocusSuiteName;

export const E2E_SUITES: Record<E2ESuiteName, readonly string[]> = {
  smoke: [
    "summarize.test.ts",
    "login.test.ts",
    "structural-loading.test.ts",
    "suite-hygiene.test.ts",
    "session-state-import.test.ts",
    "delayed-content.test.ts",
    "clarification-recovery.test.ts",
    "mutation-dedupe-recovery.test.ts",
  ],
  "interaction-regression": [
    "autocomplete.test.ts",
    "edge-cases.test.ts",
    "execute-js.test.ts",
    "file-transfer.test.ts",
    "go-back-navigation.test.ts",
    "hover-menus.test.ts",
    "information-extraction.test.ts",
    "infinite-scroll.test.ts",
    "keyboard-nav.test.ts",
    "modal-overlays.test.ts",
    "navigation-challenge.test.ts",
    "online-shop.test.ts",
    "perception-auto-vision.test.ts",
    "perception-region-zoom.test.ts",
    "web-components.test.ts",
  ],
  "runtime-regression": [
    "approval-recovery.test.ts",
    "ashby-job-application.test.ts",
    "continuation-abandon-restart.test.ts",
    "continuation-act-check-act.test.ts",
    "continuation-cart-swap.test.ts",
    "continuation-cross-page-compose.test.ts",
    "continuation-cross-tab.test.ts",
    "continuation-verify.test.ts",
    "continuation.test.ts",
    "lane-topology.test.ts",
    "partner-registration-validation.test.ts",
    "sequential-tasks.test.ts",
    "stop-drain-recovery.test.ts",
    "vendor-onboarding-wizard.test.ts",
  ],
  "nightly-legacy": [
    "context-menu.test.ts",
    "date-picker.test.ts",
    "faq-accordion.test.ts",
  ],
  "overlay-harness": [
    "overlay-harness.test.ts",
    "overlay-panel-surfaces.test.ts",
  ],
  "parallel-workers": ["parallel-work.test.ts"],
  "local-mock-provider": [
    "browser-bridge.test.ts",
    "bridge-approval-forwarding.test.ts",
    "completion-done.test.ts",
    "local-mock-provider-video.test.ts",
    "watch-mode.test.ts",
  ],
  showcase: [
    "showcase-ashby-application.test.ts",
    // Skips itself unless E2E_LIVE_APP_KIT points at a local kit directory, so
    // it can never fire in CI or an unconfigured run.
    "showcase-live-application.test.ts",
  ],
  "memory-regression": [
    "memory-current-vs-historical.test.ts",
    "memory-long-turn-dossier.test.ts",
    "memory-recall-dashboard.test.ts",
  ],
  "multi-turn-workflows": ["multi-turn-workflows.test.ts"],
  "escalation-rescue": ["escalation-rescue.test.ts"],
  arena: ["arena-suite.test.ts"],
};

export const E2E_SUITE_ORDER: readonly E2EDefaultSuiteName[] = [
  "smoke",
  "interaction-regression",
  "runtime-regression",
];

export const E2E_FOCUS_SUITE_ORDER: readonly E2EFocusSuiteName[] = [
  "nightly-legacy",
  "overlay-harness",
  "parallel-workers",
  "local-mock-provider",
  "showcase",
  "memory-regression",
  "multi-turn-workflows",
  "escalation-rescue",
  "arena",
];

export const E2E_CANONICAL_SUITE_ORDER: readonly E2ESuiteName[] = [
  ...E2E_SUITE_ORDER,
  ...E2E_FOCUS_SUITE_ORDER,
];
