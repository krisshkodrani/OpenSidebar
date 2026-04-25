#!/usr/bin/env tsx

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  type WorkArenaBrowserStrategyProbe,
  type WorkArenaBrowserStrategyReport,
  PROJECT_ROOT,
  runWorkArenaBridge,
  today,
  writeJsonReport,
} from "./workarena-adapter-lib.js";

const HARNESS_FILE = resolve(
  PROJECT_ROOT,
  "apps",
  "extension",
  "tests",
  "e2e",
  "helpers",
  "browser.ts",
);
const DIST_PATH = resolve(PROJECT_ROOT, "dist");

function parseArgs(): {
  json: boolean;
  noReport: boolean;
} {
  const args = process.argv.slice(2);
  return {
    json: args.includes("--json"),
    noReport: args.includes("--no-report"),
  };
}

function inspectOpenSidebarHarness(): WorkArenaBrowserStrategyReport["facts"]["opensidebar"] {
  const content = existsSync(HARNESS_FILE)
    ? readFileSync(HARNESS_FILE, "utf-8")
    : "";
  return {
    harnessFile: HARNESS_FILE,
    usesPuppeteer: content.includes("from \"puppeteer\""),
    usesLoadExtensionFlag: content.includes("--load-extension"),
    usesDisableExtensionsExceptFlag: content.includes("--disable-extensions-except"),
    usesPipeTransport: content.includes("pipe: true"),
    distPath: DIST_PATH,
    distExists: existsSync(DIST_PATH),
  };
}

function runProbe(): WorkArenaBrowserStrategyProbe {
  return runWorkArenaBridge<WorkArenaBrowserStrategyProbe>(["browser-strategy"], {
    timeoutMs: 120_000,
  });
}

function buildReport(): WorkArenaBrowserStrategyReport {
  const probe = runProbe();
  const opensidebar = inspectOpenSidebarHarness();
  const browsergymLaunchEvidence = [
    probe.browsergym.usesChromiumLaunch
      ? "BrowserGym BrowserEnv.reset uses pw.chromium.launch()."
      : "BrowserGym BrowserEnv.reset does not expose a Chromium launch call.",
    probe.browsergym.usesNewContext
      ? "BrowserGym creates task pages through browser.new_context()."
      : "BrowserGym did not report browser.new_context() in reset.",
    probe.browsergym.usesLaunchPersistentContext
      ? "BrowserGym uses launch_persistent_context()."
      : "BrowserGym does not use launch_persistent_context().",
  ];

  return {
    benchmark: "workarena",
    mode: "browser-strategy",
    ready: true,
    recommendedStrategy: "separate-extension-browser-with-transferred-session",
    facts: {
      browsergym: probe.browsergym,
      opensidebar,
    },
    candidates: [
      {
        id: "extension-loaded-browser-context",
        verdict: "not_recommended",
        rationale:
          "This would require BrowserGym to launch the same persistent browser context that hosts the Chrome extension. The installed BrowserGym environment launches Chromium and then creates a separate browser context, which is not the extension-loaded persistent profile used by the existing OpenSidebar E2E harness.",
        evidence: [
          ...browsergymLaunchEvidence,
          opensidebar.usesLoadExtensionFlag
            ? "OpenSidebar currently loads the extension with --load-extension."
            : "OpenSidebar extension loading flag was not found in the E2E browser helper.",
          opensidebar.usesPuppeteer
            ? "OpenSidebar E2E control is Puppeteer-based."
            : "OpenSidebar E2E control is not detected as Puppeteer-based.",
        ],
        risks: [
          "Would require patching or subclassing BrowserGym's browser lifecycle.",
          "Would require converting enough extension control helpers from Puppeteer to Playwright or adding a cross-protocol bridge.",
          "Could diverge from upstream BrowserGym semantics and make benchmark results harder to compare.",
        ],
        nextSteps: [
          "Keep as a later optimization only if separate-browser validation proves unreliable.",
          "If revisited, prototype a launch_persistent_context BrowserGym fork outside the product tree first.",
        ],
      },
      {
        id: "separate-extension-browser-with-transferred-session",
        verdict: "recommended",
        rationale:
          "Keep BrowserGym as the source of reset, prompt, task state, and validation. Launch OpenSidebar in its existing extension-loaded Chrome, transfer BrowserGym session cookies/storage to that browser, navigate to the WorkArena URL, run the agent, then validate through the still-open BrowserGym task environment.",
        evidence: [
          "BrowserGym raw observations expose active URL, open pages, goal, and task metadata.",
          "BrowserGym keeps task validation available through the environment task object while the environment remains open.",
          opensidebar.usesLoadExtensionFlag
            ? "The existing OpenSidebar harness already launches a Chrome instance with the extension loaded."
            : "The current OpenSidebar harness needs extension launch verification.",
          opensidebar.usesPipeTransport
            ? "The existing Puppeteer harness uses pipe transport and can remain independent from BrowserGym's Playwright driver."
            : "The existing Puppeteer harness transport needs verification.",
        ],
        risks: [
          "Cookie and storage transfer must preserve ServiceNow authentication and instance affinity.",
          "Validation must reload or inspect server-side state after OpenSidebar acts in the separate browser.",
          "Purely client-side unsaved state would not be visible to BrowserGym validation, so the runner must wait for committed UI/server state.",
        ],
        nextSteps: [
          "Extend the Python bridge with a reset-hold mode that exports cookies, storage state, goal, URLs, and a validation command.",
          "Extend the JS runner to launch the existing OpenSidebar harness, import BrowserGym session state, and navigate to the active WorkArena URL.",
          "After the agent stops, ask the bridge to validate before teardown and write a full agent-execution report.",
        ],
      },
    ],
    decision: {
      summary:
        "Use a separate OpenSidebar extension browser with transferred BrowserGym session state first. It preserves upstream BrowserGym reset/validation behavior and avoids a BrowserGym browser-lifecycle fork.",
      implementationPlan: [
        "Add a long-lived Python bridge session for reset, exported session state, validation, and teardown.",
        "Add JS-side cookie/storage import into the existing Puppeteer extension harness.",
        "Run one approved WorkArena task with the extension browser and validate through the held BrowserGym environment.",
        "Only revisit same-context extension loading if session transfer fails on real ServiceNow tasks.",
      ],
    },
    safety: [
      "This strategy probe is metadata-only.",
      "No BrowserGym environment was reset.",
      "No ServiceNow state was contacted or mutated.",
      "No OpenSidebar agent or LLM provider was started.",
    ],
  };
}

function printHuman(report: WorkArenaBrowserStrategyReport): void {
  console.log("\n[workarena:browser] Browser attach strategy");
  console.log(`[workarena:browser] Ready: ${report.ready ? "yes" : "no"}`);
  console.log(`[workarena:browser] Recommended: ${report.recommendedStrategy}`);
  if (report.reportPath) {
    console.log(`[workarena:browser] Report: ${report.reportPath}`);
  }
  console.log("");
  console.log(`[workarena:browser] Decision: ${report.decision.summary}`);
  console.log("");
  for (const candidate of report.candidates) {
    console.log(
      `[workarena:browser] ${candidate.verdict.toUpperCase()} ${candidate.id}`,
    );
    console.log(`[workarena:browser]   ${candidate.rationale}`);
  }
}

function main(): void {
  const args = parseArgs();
  const report = buildReport();
  if (!args.noReport) {
    report.reportPath = writeJsonReport(
      report,
      `workarena-browser-strategy-${today()}.json`,
    );
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
}

main();
