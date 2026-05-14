import type { Page } from "puppeteer";
import { E2E_VISIBLE_RAIL_STORAGE_KEY } from "../apps/extension/src/background/e2e-test-api";
import { createE2EHarness } from "../apps/extension/tests/e2e/helpers/harness";
import { openHelperPage } from "../apps/extension/tests/e2e/helpers/browser";
import { getFixtureUrl } from "../apps/extension/tests/e2e/helpers/fixture-server";
import {
  getActiveTabId,
  getMonitoredEvents,
  navigateAndWait,
  sendUserChat,
  waitForOutcome,
} from "../apps/extension/tests/e2e/helpers/utils";

type Scenario = {
  fixturePath: string;
  label: string;
  maxTurns: number;
  prompt: string;
  timeoutMs: number;
  success: (page: Page) => Promise<unknown | null>;
};

type RailFeedItem = {
  id: string;
  kind: "status" | "step" | "plan" | "completion";
  text: string;
  timestamp: number;
};

const expectedWhyLangfuse = [
  "I care about Langfuse because it solves one of the most important practical problems in AI product engineering. The work sits exactly at the boundary between developer experience and reliable AI systems.",
  "",
  "My recent work has been focused on browser agents, observability, and evaluation loops.",
].join("\n");

const scenarios: Record<string, Scenario> = {
  ashby: {
    fixturePath: "ashby-job-application",
    label: "visible-ashby-demo",
    maxTurns: 24,
    prompt: [
      "Fill this Ashby application but do not submit using these data.",
      "| Field | Copy This |",
      "|---|---|",
      "| Name | Kris Shkodrani |",
      "| Email | kshkodrani@gmail.com |",
      "| LinkedIn URL | https://www.linkedin.com/in/krisshkodrani |",
      "| Phone | +43 664 99503226 |",
      "| Current Location | Linz, Austria |",
      "| EU Work Permit | Yes |",
      "| Salary Expectation | EUR 95,000-115,000 gross/year, negotiable depending on level, equity, and Berlin travel cadence |",
      "| Earliest Start Date | 2026-06-01 |",
      "",
      "## Why Do You Care About Langfuse?",
      "",
      expectedWhyLangfuse,
    ].join("\n"),
    timeoutMs: 420_000,
    success: (page) =>
      page.evaluate((expected) => {
        const draft = (window as any).ashbyApplicationDraft;
        if (!draft || draft.submitted || (window as any).ashbyApplicationResult) {
          return null;
        }

        const matches =
          draft.name === "Kris Shkodrani" &&
          draft.email === "kshkodrani@gmail.com" &&
          draft.linkedIn === "https://www.linkedin.com/in/krisshkodrani" &&
          draft.phone === "+43 664 99503226" &&
          draft.currentLocation === "Linz, Austria" &&
          draft.euWorkPermit === "Yes" &&
          draft.salaryExpectation ===
            "EUR 95,000-115,000 gross/year, negotiable depending on level, equity, and Berlin travel cadence" &&
          draft.earliestStartDate === "2026-06-01" &&
          draft.whyLangfuse === expected;

        return matches ? draft : null;
      }, expectedWhyLangfuse),
  },
  login: {
    fixturePath: "login",
    label: "visible-login-demo",
    maxTurns: 16,
    prompt:
      "Log in with email admin@example.com and password secret123. Check the Remember me box too.",
    timeoutMs: 240_000,
    success: (page) =>
      page.evaluate(() => {
        const result = (window as any).loginResult ?? null;
        return result?.authenticated ? result : null;
      }),
  },
  summarize: {
    fixturePath: "summarize",
    label: "visible-summarize-demo",
    maxTurns: 6,
    prompt: "Summarize this page in one sentence.",
    timeoutMs: 180_000,
    success: async () => null,
  },
};

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parseBooleanArg(name: string, fallback = false): boolean {
  const raw = parseArg(name);
  if (raw == null) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

async function closeHelperTab(harness: ReturnType<typeof createE2EHarness>) {
  const helper = harness.ctx.helperPage;
  if (helper && !helper.isClosed()) {
    await helper.close().catch(() => {});
    harness.ctx.helperPage = null;
  }
}

async function enableVisibleRail(harness: ReturnType<typeof createE2EHarness>) {
  const helper = await openHelperPage(harness.ctx);
  await helper.evaluate(async (key: string) => {
    await chrome.storage.local.set({ [key]: true });
  }, E2E_VISIBLE_RAIL_STORAGE_KEY);
}

async function disableVisibleRail(harness: ReturnType<typeof createE2EHarness>) {
  const helper = await openHelperPage(harness.ctx);
  await helper.evaluate(async (key: string) => {
    await chrome.storage.local.set({ [key]: false });
  }, E2E_VISIBLE_RAIL_STORAGE_KEY);
}

async function logRealPanelProbe(page: Page, expectedPrompt: string) {
  const probe = await page.evaluate((prompt: string) => {
    const host = document.getElementById("opensidebar-harness-host");
    const root = host?.shadowRoot?.getElementById("root");
    const rect = host?.getBoundingClientRect();
    const style = host ? getComputedStyle(host) : null;
    const text = (root?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const promptNeedle = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
    return {
      mounted: Boolean(host),
      dataGlass: host?.getAttribute("data-glass") ?? null,
      rect: rect
        ? {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            left: Math.round(rect.left),
            top: Math.round(rect.top),
          }
        : null,
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      opacity: style?.opacity ?? null,
      hasExpectedPrompt: promptNeedle ? text.includes(promptNeedle) : null,
      showsWelcome: text.includes("Hi! What can I help with?"),
      showsGuideInput: text.includes("Guide the agent"),
      textSample: text.slice(0, 360),
    };
  }, expectedPrompt);
  console.log(`[visible-demo] Real panel overlay: ${JSON.stringify(probe)}`);
}

function compactText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRailModel(events: any[], prompt: string) {
  const latestStatus = [...events]
    .reverse()
    .find((event: any) => event.type === "AGENT_STATUS");
  const latestStep = [...events]
    .reverse()
    .find((event: any) => event.type === "AGENT_STEP");
  const latestProgress = [...events]
    .reverse()
    .find((event: any) => event.type === "TASK_PROGRESS");
  const completion = [...events]
    .reverse()
    .find((event: any) => event.type === "TASK_COMPLETION");

  const streamText = events
    .filter((event: any) => event.type === "STREAM_CHUNK")
    .reduce((text: string, event: any) => {
      const payload = event.payload ?? {};
      if (typeof payload.replaceContent === "string") return payload.replaceContent;
      if (typeof payload.delta === "string") return text + payload.delta;
      return text;
    }, "");

  const planItems = Array.isArray(latestProgress?.subtasks)
    ? latestProgress.subtasks
        .map((subtask: any) =>
          compactText(subtask?.label ?? subtask?.title ?? subtask?.description),
        )
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const feed: RailFeedItem[] = events
    .filter((event: any) =>
      [
        "AGENT_STATUS",
        "AGENT_STEP",
        "TASK_PROGRESS",
        "TASK_COMPLETION",
      ].includes(event.type),
    )
    .map((event: any, index: number): RailFeedItem | null => {
      if (event.type === "AGENT_STATUS") {
        return {
          id: `${event.timestamp}-${index}`,
          kind: "status",
          text: compactText(event.detail ?? event.status),
          timestamp: event.timestamp ?? Date.now(),
        };
      }
      if (event.type === "AGENT_STEP") {
        return {
          id: `${event.timestamp}-${index}`,
          kind: "step",
          text: compactText(event.stepLabel ?? event.stepDetail),
          timestamp: event.timestamp ?? Date.now(),
        };
      }
      if (event.type === "TASK_PROGRESS") {
        return {
          id: `${event.timestamp}-${index}`,
          kind: "plan",
          text: "Plan/progress updated",
          timestamp: event.timestamp ?? Date.now(),
        };
      }
      if (event.type === "TASK_COMPLETION") {
        return {
          id: `${event.timestamp}-${index}`,
          kind: "completion",
          text: compactText(event.completionStatus ?? event.status ?? "Task complete"),
          timestamp: event.timestamp ?? Date.now(),
        };
      }
      return null;
    })
    .filter((item): item is RailFeedItem => item != null)
    .filter((item, index, items) => {
      const previous = items[index - 1];
      return !previous || previous.kind !== item.kind || previous.text !== item.text;
    })
    .slice(-10);

  const status =
    completion?.status === "completed"
      ? "Done"
      : completion?.status === "failed"
        ? "Failed"
        : latestStatus?.status === "IDLE"
          ? "Idle"
          : "Running";

  return {
    prompt,
    status,
    detail: compactText(
      latestStep?.stepLabel ??
        latestStep?.stepDetail ??
        latestStatus?.detail ??
        "Waiting for runtime updates",
    ),
    planItems,
    feed,
    finalText: compactText(
      streamText ||
        completion?.payload?.summary ||
        completion?.payload?.detail ||
        completion?.detail ||
        "",
    ),
    outcome:
      completion?.status === "completed" ||
      completion?.status === "failed" ||
      completion?.status === "stopped"
        ? completion.status
        : "",
  };
}

async function sendRailUpdate(
  harness: ReturnType<typeof createE2EHarness>,
  tabId: number,
  workspaceId: string,
  prompt: string,
) {
  const events = (await getMonitoredEvents(harness.ctx.serviceWorker, 160)).filter(
    (event: any) =>
      event.workspaceId == null || event.workspaceId === workspaceId,
  );
  const payload = buildRailModel(events, prompt);
  await harness.ctx.serviceWorker.evaluate(
    async (targetTabId: number, railPayload: unknown) => {
      await chrome.tabs
        .sendMessage(targetTabId, {
          type: "E2E_RAIL_UPDATE",
          requestId: crypto.randomUUID(),
          source: "e2e",
          payload: railPayload,
        })
        .catch(() => {});
    },
    tabId,
    payload,
  );
}

function startRailUpdates(
  harness: ReturnType<typeof createE2EHarness>,
  tabId: number,
  workspaceId: string,
  prompt: string,
) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    await sendRailUpdate(harness, tabId, workspaceId, prompt).catch(() => {});
    if (!stopped) setTimeout(tick, 700);
  };
  void tick();
  return () => {
    stopped = true;
  };
}

async function waitForCompletionLog(
  harness: ReturnType<typeof createE2EHarness>,
  workspaceId: string,
  timeoutMs: number,
) {
  const start = Date.now();
  let lastStatus = "";

  while (Date.now() - start < timeoutMs) {
    const events = (await getMonitoredEvents(harness.ctx.serviceWorker, 120))
      .filter(
        (event: any) =>
          event.workspaceId == null || event.workspaceId === workspaceId,
      );
    const latest = [...events].reverse().find((event: any) =>
      event.type === "TASK_COMPLETION" ||
      event.type === "AGENT_STATUS" ||
      event.type === "AGENT_STEP",
    );

    const status = latest
      ? `${latest.type}:${latest.status ?? latest.stepLabel ?? latest.detail ?? ""}`
      : "";
    if (status && status !== lastStatus) {
      console.log(`[visible-demo] ${status}`);
      lastStatus = status;
    }

    if (events.some((event: any) => event.type === "TASK_COMPLETION")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main() {
  process.env.E2E_PROFILE = process.env.E2E_PROFILE || "headed";

  const scenarioName = parseArg("scenario") ?? "login";
  const holdMs = Number(parseArg("holdMs") ?? "120000");
  const legacyRail = parseBooleanArg("legacyRail", false);
  const scenario = scenarios[scenarioName];
  if (!scenario) {
    throw new Error(
      `Unknown scenario "${scenarioName}". Available: ${Object.keys(scenarios).join(", ")}`,
    );
  }

  const h = createE2EHarness({
    maxTurns: scenario.maxTurns,
    testLabel: scenario.label,
  });

  try {
    await h.beforeAllHook();
    await h.beforeEachHook();
    if (legacyRail) {
      await enableVisibleRail(h);
    } else {
      await disableVisibleRail(h);
    }
    await navigateAndWait(h.page, getFixtureUrl(scenario.fixturePath));
    await h.page.bringToFront();

    const tabId = await getActiveTabId(h.ctx.serviceWorker);
    const workspaceId = await sendUserChat(h.ctx, scenario.prompt, tabId);
    await closeHelperTab(h);
    await h.page.bringToFront();
    await logRealPanelProbe(h.page, scenario.prompt);
    const stopRailUpdates = legacyRail
      ? startRailUpdates(h, tabId, workspaceId, scenario.prompt)
      : () => {};

    console.log(`[visible-demo] Scenario: ${scenarioName}`);
    console.log(`[visible-demo] Prompt: ${scenario.prompt}`);
    console.log("[visible-demo] Watch the single fixture tab for agent actions.");

    const outcomePromise =
      scenarioName === "summarize"
        ? waitForCompletionLog(h, workspaceId, scenario.timeoutMs).then(() => ({
            ok: true,
            reason: "task completion event observed",
          }))
        : waitForOutcome(
            h.page,
            h.ctx.serviceWorker,
            () => scenario.success(h.page),
            scenario.timeoutMs,
            workspaceId,
          );

    const outcome = await outcomePromise;
    stopRailUpdates();
    await sendRailUpdate(h, tabId, workspaceId, scenario.prompt);
    console.log(
      `[visible-demo] Result: ${outcome.ok ? "completed" : "not completed"} (${outcome.reason})`,
    );
    console.log(`[visible-demo] Holding Chrome open for ${holdMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  } finally {
    await h.afterAllHook().catch(() => {});
  }
}

main().catch((error) => {
  console.error("[visible-demo] Failed:", error);
  process.exitCode = 1;
});
