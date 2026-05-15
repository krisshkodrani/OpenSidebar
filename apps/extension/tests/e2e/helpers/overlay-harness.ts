import puppeteer, { type Browser, type Page } from "puppeteer";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPuppeteerOverlayBrowserPagePort,
  type OverlayRunnerBrowserPagePort,
} from "./overlay-page-port";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../../../..");
const DIST_PATH = path.join(PROJECT_ROOT, "dist");
const DIST_MANIFEST_PATH = path.join(DIST_PATH, ".vite", "manifest.json");
const OVERLAY_ENTRY = "src/overlay/index.tsx";

interface ViteManifestEntry {
  file?: string;
}

interface StaticServerHandle {
  origin: string;
  close(): Promise<void>;
}

type OverlayHarnessStorageArea = "local" | "sync" | "session";

export interface OverlayHarnessRuntimeTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
}

export interface OverlayHarnessRuntimeWindow {
  id?: number;
}

export interface OverlayHarnessRuntimeOptions {
  tab?: OverlayHarnessRuntimeTab;
  window?: OverlayHarnessRuntimeWindow;
  storage?: Partial<Record<OverlayHarnessStorageArea, Record<string, unknown>>>;
}

export interface OverlayHarnessRunnerOptions {
  runtimeOptions?: OverlayHarnessRuntimeOptions;
  autoStartFakeBackground?: boolean | OverlayFakeBackgroundOptions;
}

export interface OverlayHarnessMountState {
  hasHost: boolean;
  hasShadowRoot: boolean;
  hasRoot: boolean;
  runtimeSource?: string;
}

export interface OverlayHarnessMessageCapture {
  outboundTypes: string[];
  outboundMessages: unknown[];
  inboundTypes: string[];
}

export interface OverlayHarnessRuntimeSnapshot {
  activeTab: OverlayHarnessRuntimeTab | null;
  currentWindow: OverlayHarnessRuntimeWindow | null;
  storage: Record<OverlayHarnessStorageArea, Record<string, unknown>>;
}

export interface OverlayFakeBackgroundOptions {
  responseText?: string;
  thinkingDetail?: string;
  doneDetail?: string;
  pausedDetail?: string;
  resumedDetail?: string;
  stoppedDetail?: string;
  failSkillRecordingStart?: boolean;
  skillRecordingStartFailureDetail?: string;
}

export interface OverlayFakeBackgroundState {
  handledTypes: string[];
  emittedTypes: string[];
  lastUserText?: string;
  skills?: unknown[];
}

export interface OverlayHarnessRunner {
  page: Page;
  browserPage: OverlayRunnerBrowserPagePort;
  browser: Browser;
  pageErrors: string[];
  inject(): Promise<void>;
  getMountState(): Promise<OverlayHarnessMountState>;
  readRuntimeSnapshot(): Promise<OverlayHarnessRuntimeSnapshot>;
  startMessageCapture(): Promise<void>;
  startFakeBackgroundController(
    options?: OverlayFakeBackgroundOptions,
  ): Promise<void>;
  readFakeBackgroundState(): Promise<OverlayFakeBackgroundState>;
  waitForFakeBackgroundHandled(type: string): Promise<void>;
  waitForOverlayText(text: string): Promise<void>;
  clickOverlayButton(ariaLabel: string): Promise<void>;
  sendUiMessage(message: unknown): Promise<void>;
  emitRuntimeMessage(message: unknown): Promise<void>;
  sendPrimaryMessageThroughUi(text: string): Promise<void>;
  sendFeedbackThroughUi(text: string): Promise<void>;
  readMessageCapture(): Promise<OverlayHarnessMessageCapture>;
  close(): Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function readOverlayBundlePath(): Promise<string> {
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(DIST_MANIFEST_PATH, "utf8");
  } catch {
    throw new Error(
      `Missing built extension manifest at ${DIST_MANIFEST_PATH}. Run pnpm run build before the overlay harness smoke.`,
    );
  }

  const manifest = JSON.parse(manifestRaw) as Record<
    string,
    ViteManifestEntry
  >;
  const overlayEntry = manifest[OVERLAY_ENTRY];
  if (!overlayEntry?.file) {
    throw new Error(
      `Built manifest does not contain ${OVERLAY_ENTRY}. Run pnpm run build and verify the overlay-harness Rollup input.`,
    );
  }
  return overlayEntry.file;
}

async function startDistServer(): Promise<StaticServerHandle> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/overlay-smoke") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head><title>Overlay Harness Smoke</title></head>
          <body>
            <main>
              <h1>Generic page</h1>
              <p>This page has no Chrome extension APIs.</p>
            </main>
          </body>
        </html>`);
      return;
    }

    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filePath = path.resolve(DIST_PATH, relativePath);
    if (!filePath.startsWith(DIST_PATH + path.sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const content = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type":
          MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Overlay smoke server did not bind to a TCP port.");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function injectModule(
  browserPage: OverlayRunnerBrowserPagePort,
  scriptUrl: string,
): Promise<void> {
  await browserPage.evaluate(
    (url) =>
      new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.type = "module";
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error(`Failed to load overlay module: ${url}`));
        document.head.appendChild(script);
      }),
    scriptUrl,
  );
}

async function installFakeBackgroundController(
  browserPage: OverlayRunnerBrowserPagePort,
  options: OverlayFakeBackgroundOptions = {},
): Promise<void> {
  await browserPage.evaluate((controllerOptions) => {
    window.__overlayFakeBackground?.dispose();

    const WEBSITE_SKILLS_STORAGE_KEY = "opensidebar:userWebsiteSkills";
    const state: OverlayFakeBackgroundState = {
      handledTypes: [],
      emittedTypes: [],
      skills: [],
    };
    let nextSequence = 0;

    const emitBackgroundMessage = (message: unknown) => {
      const type =
        message && typeof message === "object"
          ? (message as { type?: unknown }).type
          : undefined;
      if (typeof type === "string") {
        state.emittedTypes.push(type);
      }
      window.dispatchEvent(
        new CustomEvent("opensidebar:overlay:receive-message", {
          detail: { message },
        }),
      );
    };

    const sendResponse = (requestId: string | undefined, response: unknown) => {
      if (!requestId) return;
      window.dispatchEvent(
        new CustomEvent("opensidebar:overlay:send-response", {
          detail: { requestId, response },
        }),
      );
    };

    const readSkills = async (): Promise<unknown[]> => {
      const result = await window.__opensidebarOverlayRuntime?.port.storage.local
        .get(WEBSITE_SKILLS_STORAGE_KEY)
        .catch(() => ({}));
      const raw = result?.[WEBSITE_SKILLS_STORAGE_KEY];
      return Array.isArray(raw) ? raw : (state.skills ?? []);
    };

    const persistSkills = async (skills: unknown[]) => {
      state.skills = skills;
      await window.__opensidebarOverlayRuntime?.port.storage.local
        .set({ [WEBSITE_SKILLS_STORAGE_KEY]: skills })
        .catch(() => {});
    };

    const makeId = () =>
      typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `overlay-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const buildSkillDraft = () => {
      const now = Date.now();
      const url = new URL(window.location.href);
      return {
        id: makeId(),
        name: "Harness smoke workflow",
        origin: url.origin,
        pathPattern: url.pathname || "/",
        triggerPhrase: "harness smoke workflow",
        workflowSteps: [
          "Ground on the current page.",
          "Use the visible workflow controls.",
          "Verify the final confirmation state.",
        ],
        requiredEvidence: [
          "The confirmation message or final state is visible.",
        ],
        privacySummary:
          "Typed values were redacted by default in the recording.",
        capturedEventCount: 3,
        createdAt: now,
        updatedAt: now,
      };
    };

    const emitSkillStatus = (
      status: "idle" | "recording" | "review" | "paused",
      timeline: string[],
      draft?: ReturnType<typeof buildSkillDraft>,
    ) => {
      const sequence = ++nextSequence;
      emitBackgroundMessage({
        type: "SKILL_RECORDING_STATUS",
        source: "background",
        requestId: `overlay-fake-skill-status-${sequence}`,
        payload: {
          status,
          timeline,
          ...(draft ? { draft } : {}),
        },
      });
    };

    const onUiMessage = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          message?: {
            type?: string;
            payload?: Record<string, unknown> & {
              text?: string;
              workspaceId?: string | null;
              draft?: Record<string, unknown>;
              enabled?: boolean;
              id?: string;
            };
            workspaceId?: string | null;
          };
          requestId?: string;
        }>
      ).detail;
      const message = detail?.message;
      if (!message?.type) return;

      state.handledTypes.push(message.type);
      const workspaceId =
        message.workspaceId ?? message.payload?.workspaceId ?? null;

      if (message.type === "SIDE_PANEL_OPENED") {
        sendResponse(detail.requestId, { workspaceId: null });
        return;
      }

      if (message.type === "DATA_CONTROL_REQUEST") {
        sendResponse(detail.requestId, { ok: true, detail: "Done." });
        return;
      }

      if (message.type === "USER_SKILL_LIST") {
        void readSkills().then((skills) => {
          state.skills = skills;
          sendResponse(detail.requestId, { ok: true, skills });
        });
        return;
      }

      if (message.type === "USER_SKILL_SAVE") {
        void (async () => {
          const draft = message.payload?.draft;
          if (!draft || typeof draft !== "object") {
            sendResponse(detail.requestId, {
              ok: false,
              detail: "Missing skill draft.",
            });
            return;
          }
          const existing = await readSkills();
          const now = Date.now();
          const skill = {
            ...draft,
            enabled: message.payload?.enabled ?? true,
            createdAt:
              typeof draft.createdAt === "number" ? draft.createdAt : now,
            updatedAt: now,
          };
          const next = [
            skill,
            ...existing.filter(
              (item) =>
                (item as { id?: unknown }).id !==
                (skill as { id?: unknown }).id,
            ),
          ];
          await persistSkills(next);
          sendResponse(detail.requestId, { ok: true, skills: next });
          emitBackgroundMessage({
            type: "USER_SKILL_LIST",
            source: "background",
            requestId: `overlay-fake-user-skills-${++nextSequence}`,
            payload: { skills: next },
          });
        })();
        return;
      }

      if (message.type === "USER_SKILL_DELETE") {
        void (async () => {
          const id = message.payload?.id;
          const next = (await readSkills()).filter(
            (item) => (item as { id?: unknown }).id !== id,
          );
          await persistSkills(next);
          sendResponse(detail.requestId, { ok: true, skills: next });
        })();
        return;
      }

      if (message.type === "SKILL_RECORDING_START") {
        if (controllerOptions.failSkillRecordingStart) {
          const failureDetail =
            controllerOptions.skillRecordingStartFailureDetail ??
            "Recording paused on restricted page";
          sendResponse(detail.requestId, { ok: false, detail: failureDetail });
          emitSkillStatus("paused", [failureDetail]);
          return;
        }
        sendResponse(detail.requestId, { ok: true });
        emitSkillStatus("recording", ["Waiting for actions on the page"]);
        return;
      }

      if (message.type === "SKILL_RECORDING_STOP") {
        const draft = buildSkillDraft();
        sendResponse(detail.requestId, { ok: true, draft });
        emitSkillStatus(
          "review",
          [
            "Clicked \"Start\"",
            "Filled \"Search\" with <text>",
            "Saw confirmation",
          ],
          draft,
        );
        return;
      }

      if (message.type === "SKILL_RECORDING_CANCEL") {
        sendResponse(detail.requestId, { ok: true });
        emitSkillStatus("idle", []);
        return;
      }

      if (message.type === "PAUSE_AGENT") {
        const sequence = ++nextSequence;
        sendResponse(detail.requestId, { ok: true });
        queueMicrotask(() => {
          emitBackgroundMessage({
            type: "AGENT_STATUS",
            source: "background",
            requestId: `overlay-fake-paused-${sequence}`,
            workspaceId,
            payload: {
              status: "PAUSED",
              detail:
                controllerOptions.pausedDetail ?? "Fake background paused",
            },
          });
        });
        return;
      }
      if (message.type === "RESUME_AGENT") {
        const sequence = ++nextSequence;
        sendResponse(detail.requestId, { ok: true });
        queueMicrotask(() => {
          emitBackgroundMessage({
            type: "AGENT_STATUS",
            source: "background",
            requestId: `overlay-fake-resumed-${sequence}`,
            workspaceId,
            payload: {
              status: "THINKING",
              detail:
                controllerOptions.resumedDetail ??
                "Fake background resumed",
            },
          });
        });
        return;
      }
      if (message.type === "STOP_AGENT") {
        const sequence = ++nextSequence;
        sendResponse(detail.requestId, { ok: true });
        queueMicrotask(() => {
          emitBackgroundMessage({
            type: "AGENT_STATUS",
            source: "background",
            requestId: `overlay-fake-stopped-${sequence}`,
            workspaceId,
            payload: {
              status: "IDLE",
              detail:
                controllerOptions.stoppedDetail ?? "Fake background stopped",
            },
          });
        });
        return;
      }
      if (message.type !== "USER_CHAT") {
        sendResponse(detail.requestId, { ok: true });
        return;
      }

      const userText = message.payload?.text ?? "";
      state.lastUserText = userText;
      const sequence = ++nextSequence;
      const responseText =
        controllerOptions.responseText ??
        `Fake overlay response: ${userText}`;
      const thinkingDetail =
        controllerOptions.thinkingDetail ??
        "Fake background processing feedback";
      const doneDetail =
        controllerOptions.doneDetail ?? "Fake background complete";

      sendResponse(detail.requestId, { ok: true });
      queueMicrotask(() => {
        emitBackgroundMessage({
          type: "AGENT_STATUS",
          source: "background",
          requestId: `overlay-fake-status-${sequence}`,
          workspaceId,
          payload: { status: "THINKING", detail: thinkingDetail },
        });
        emitBackgroundMessage({
          type: "STREAM_CHUNK",
          source: "background",
          requestId: `overlay-fake-stream-${sequence}`,
          workspaceId,
          payload: { delta: responseText, done: false },
        });
        emitBackgroundMessage({
          type: "STREAM_CHUNK",
          source: "background",
          requestId: `overlay-fake-stream-done-${sequence}`,
          workspaceId,
          payload: { delta: "", done: true },
        });
        emitBackgroundMessage({
          type: "TASK_COMPLETION",
          source: "background",
          requestId: `overlay-fake-completion-${sequence}`,
          workspaceId,
          payload: {
            taskId: `overlay-fake-task-${sequence}`,
            status: "completed",
            totalTurnsUsed: 1,
            totalTimeMs: 1,
            summary: responseText,
            subtaskResults: [
              {
                description: userText || "Overlay feedback",
                status: "completed",
                turnsUsed: 1,
                result: responseText,
              },
            ],
            urlHistory: [window.location.href],
          },
        });
        emitBackgroundMessage({
          type: "AGENT_STATUS",
          source: "background",
          requestId: `overlay-fake-idle-${sequence}`,
          workspaceId,
          payload: { status: "IDLE", detail: doneDetail },
        });
      });
    };

    window.addEventListener("opensidebar:overlay:send-message", onUiMessage);
    window.__overlayFakeBackground = {
      state,
      dispose() {
        window.removeEventListener(
          "opensidebar:overlay:send-message",
          onUiMessage,
        );
      },
    };
  }, options);
}

export async function createOverlayHarnessRunner(
  options: OverlayHarnessRunnerOptions = {},
): Promise<OverlayHarnessRunner> {
  const overlayBundlePath = await readOverlayBundlePath();
  const staticServer = await startDistServer();
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1280, height: 900 },
      args: [
        "--no-first-run",
        "--disable-search-engine-choice-screen",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
      pipe: false,
      timeout: 60_000,
    });
  } catch (error) {
    await staticServer.close().catch(() => {});
    throw error;
  }

  let page: Page;
  try {
    page = await browser.newPage();
  } catch (error) {
    await browser.close().catch(() => {});
    await staticServer.close().catch(() => {});
    throw error;
  }
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const browserPage = createPuppeteerOverlayBrowserPagePort(page);

  return {
    page,
    browserPage,
    browser,
    pageErrors,

    async inject() {
      await page.goto(`${staticServer.origin}/overlay-smoke`, {
        waitUntil: "domcontentloaded",
      });
      await page.evaluate(
        "var __name = (target) => target; window.__name = __name",
      );
      if (options.runtimeOptions) {
        await browserPage.evaluate((runtimeOptions) => {
          window.__opensidebarOverlayConfig = { runtimeOptions };
        }, options.runtimeOptions);
      }
      if (options.autoStartFakeBackground) {
        await installFakeBackgroundController(
          browserPage,
          options.autoStartFakeBackground === true
            ? {}
            : options.autoStartFakeBackground,
        );
      }
      await injectModule(
        browserPage,
        `${staticServer.origin}/${overlayBundlePath}`,
      );
      await browserPage.waitForSelector("#opensidebar-harness-host", {
        timeout: 15_000,
      });
    },

    getMountState() {
      return browserPage.evaluate(() => {
        const host = document.getElementById("opensidebar-harness-host");
        const root = host?.shadowRoot?.getElementById("root");
        return {
          hasHost: Boolean(host),
          hasShadowRoot: Boolean(host?.shadowRoot),
          hasRoot: Boolean(root),
          runtimeSource: window.__opensidebarOverlayRuntime?.port.source,
        };
      });
    },

    async readRuntimeSnapshot() {
      return browserPage.evaluate(async () => {
        const runtime = window.__opensidebarOverlayRuntime;
        if (!runtime) throw new Error("Overlay runtime was not mounted.");
        return {
          activeTab: await runtime.port.getActiveTab(),
          currentWindow: await runtime.port.getCurrentWindow(),
          storage: {
            local: runtime.getStorageSnapshot("local"),
            sync: runtime.getStorageSnapshot("sync"),
            session: runtime.getStorageSnapshot("session"),
          },
        };
      });
    },

    async startMessageCapture() {
      await browserPage.evaluate(() => {
        window.__overlaySmoke = {
          outboundTypes: [],
          outboundMessages: [],
          inboundTypes: [],
        };
        window.addEventListener("opensidebar:overlay:send-message", (event) => {
          const message = (
            event as CustomEvent<{ message?: { type?: string } }>
          ).detail?.message;
          if (message?.type) {
            window.__overlaySmoke.outboundTypes.push(message.type);
            window.__overlaySmoke.outboundMessages.push(message);
          }
        });
        window.__opensidebarOverlayRuntime?.port.subscribeMessages((message) => {
          window.__overlaySmoke.inboundTypes.push(message.type);
        });
      });
    },

    async startFakeBackgroundController(options = {}) {
      await browserPage.evaluate((controllerOptions) => {
        window.__overlayFakeBackground?.dispose();

        const state: OverlayFakeBackgroundState = {
          handledTypes: [],
          emittedTypes: [],
        };
        let nextSequence = 0;

        const emitBackgroundMessage = (message: unknown) => {
          const type =
            message && typeof message === "object"
              ? (message as { type?: unknown }).type
              : undefined;
          if (typeof type === "string") {
            state.emittedTypes.push(type);
          }
          window.dispatchEvent(
            new CustomEvent("opensidebar:overlay:receive-message", {
              detail: { message },
            }),
          );
        };

        const onUiMessage = (event: Event) => {
          const message = (
            event as CustomEvent<{
              message?: {
                type?: string;
                payload?: { text?: string; workspaceId?: string | null };
                workspaceId?: string | null;
              };
            }>
          ).detail?.message;
          if (!message?.type) return;

          state.handledTypes.push(message.type);
          if (message.type === "PAUSE_AGENT") {
            const sequence = ++nextSequence;
            queueMicrotask(() => {
              emitBackgroundMessage({
                type: "AGENT_STATUS",
                source: "background",
                requestId: `overlay-fake-paused-${sequence}`,
                workspaceId: message.workspaceId ?? null,
                payload: {
                  status: "PAUSED",
                  detail:
                    controllerOptions.pausedDetail ?? "Fake background paused",
                },
              });
            });
            return;
          }
          if (message.type === "RESUME_AGENT") {
            const sequence = ++nextSequence;
            queueMicrotask(() => {
              emitBackgroundMessage({
                type: "AGENT_STATUS",
                source: "background",
                requestId: `overlay-fake-resumed-${sequence}`,
                workspaceId: message.workspaceId ?? null,
                payload: {
                  status: "THINKING",
                  detail:
                    controllerOptions.resumedDetail ??
                    "Fake background resumed",
                },
              });
            });
            return;
          }
          if (message.type === "STOP_AGENT") {
            const sequence = ++nextSequence;
            queueMicrotask(() => {
              emitBackgroundMessage({
                type: "AGENT_STATUS",
                source: "background",
                requestId: `overlay-fake-stopped-${sequence}`,
                workspaceId: message.workspaceId ?? null,
                payload: {
                  status: "IDLE",
                  detail:
                    controllerOptions.stoppedDetail ??
                    "Fake background stopped",
                },
              });
            });
            return;
          }
          if (message.type !== "USER_CHAT") return;

          const userText = message.payload?.text ?? "";
          state.lastUserText = userText;
          const sequence = ++nextSequence;
          const workspaceId =
            message.workspaceId ?? message.payload?.workspaceId ?? null;
          const responseText =
            controllerOptions.responseText ??
            `Fake overlay response: ${userText}`;
          const thinkingDetail =
            controllerOptions.thinkingDetail ??
            "Fake background processing feedback";
          const doneDetail =
            controllerOptions.doneDetail ?? "Fake background complete";

          queueMicrotask(() => {
            emitBackgroundMessage({
              type: "AGENT_STATUS",
              source: "background",
              requestId: `overlay-fake-status-${sequence}`,
              workspaceId,
              payload: { status: "THINKING", detail: thinkingDetail },
            });
            emitBackgroundMessage({
              type: "STREAM_CHUNK",
              source: "background",
              requestId: `overlay-fake-stream-${sequence}`,
              workspaceId,
              payload: { delta: responseText, done: false },
            });
            emitBackgroundMessage({
              type: "STREAM_CHUNK",
              source: "background",
              requestId: `overlay-fake-stream-done-${sequence}`,
              workspaceId,
              payload: { delta: "", done: true },
            });
            emitBackgroundMessage({
              type: "TASK_COMPLETION",
              source: "background",
              requestId: `overlay-fake-completion-${sequence}`,
              workspaceId,
              payload: {
                taskId: `overlay-fake-task-${sequence}`,
                status: "completed",
                totalTurnsUsed: 1,
                totalTimeMs: 1,
                summary: responseText,
                subtaskResults: [
                  {
                    description: userText || "Overlay feedback",
                    status: "completed",
                    turnsUsed: 1,
                    result: responseText,
                  },
                ],
                urlHistory: [window.location.href],
              },
            });
            emitBackgroundMessage({
              type: "AGENT_STATUS",
              source: "background",
              requestId: `overlay-fake-idle-${sequence}`,
              workspaceId,
              payload: { status: "IDLE", detail: doneDetail },
            });
          });
        };

        window.addEventListener("opensidebar:overlay:send-message", onUiMessage);
        window.__overlayFakeBackground = {
          state,
          dispose() {
            window.removeEventListener(
              "opensidebar:overlay:send-message",
              onUiMessage,
            );
          },
        };
      }, options);
    },

    readFakeBackgroundState() {
      return browserPage.evaluate(() => {
        const state = window.__overlayFakeBackground?.state;
        if (!state) {
          throw new Error("Overlay fake background controller was not started.");
        }
        return state;
      });
    },

    async waitForFakeBackgroundHandled(type: string) {
      await browserPage.waitForFunction(
        (expectedType) =>
          Boolean(
            window.__overlayFakeBackground?.state.handledTypes.includes(
              expectedType,
            ),
          ),
        {},
        type,
      );
    },

    async waitForOverlayText(text: string) {
      await browserPage.waitForFunction(
        (expectedText) => {
          const root = document.getElementById("opensidebar-harness-host")
            ?.shadowRoot;
          return Boolean(root?.textContent?.includes(expectedText));
        },
        {},
        text,
      );
    },

    async clickOverlayButton(ariaLabel: string) {
      const buttonHandle = await page.waitForFunction(
        (label) => {
          const root = document.getElementById("opensidebar-harness-host")
            ?.shadowRoot;
          return (
            Array.from(root?.querySelectorAll("button") ?? []).find(
              (button) => button.getAttribute("aria-label") === label,
            ) ?? false
          );
        },
        {},
        ariaLabel,
      );
      const button = buttonHandle.asElement();
      if (!button) {
        await buttonHandle.dispose();
        throw new Error(`Overlay button was not found: ${ariaLabel}`);
      }
      try {
        await button.click();
      } finally {
        await button.dispose();
      }
    },

    async sendUiMessage(message: unknown) {
      await browserPage.evaluate(async (uiMessage) => {
        const runtime = window.__opensidebarOverlayRuntime;
        if (!runtime) throw new Error("Overlay runtime was not mounted.");
        await runtime.port.sendMessage(uiMessage);
      }, message);
    },

    async emitRuntimeMessage(message: unknown) {
      await browserPage.evaluate((runtimeMessage) => {
        window.dispatchEvent(
          new CustomEvent("opensidebar:overlay:receive-message", {
            detail: { message: runtimeMessage },
          }),
        );
      }, message);
    },

    async sendPrimaryMessageThroughUi(text: string) {
      await browserPage.waitForFunction(() => {
        const root = document.getElementById("opensidebar-harness-host")
          ?.shadowRoot;
        return Boolean(
          root?.querySelector('textarea[placeholder="What can I help with?"]'),
        );
      });
      await browserPage.evaluate((value) => {
        const root = document.getElementById("opensidebar-harness-host")
          ?.shadowRoot;
        const textarea = root?.querySelector(
          'textarea[placeholder="What can I help with?"]',
        ) as HTMLTextAreaElement | null;
        if (!textarea) {
          throw new Error("Overlay primary textarea was not found.");
        }
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }, text);
      await browserPage.waitForFunction(() => {
        const root = document.getElementById("opensidebar-harness-host")
          ?.shadowRoot;
        return Boolean(root?.querySelector('button[aria-label="Send message"]'));
      });
      await browserPage.evaluate(() => {
        const root = document.getElementById("opensidebar-harness-host")
          ?.shadowRoot;
        const button = root?.querySelector(
          'button[aria-label="Send message"]',
        ) as HTMLButtonElement | null;
        if (!button) {
          throw new Error("Overlay send message button was not found.");
        }
        button.click();
      });
    },

    async sendFeedbackThroughUi(text: string) {
      await browserPage.waitForFunction(() => {
        const root = document.getElementById("opensidebar-harness-host")
          ?.shadowRoot;
        return Boolean(
          root?.querySelector('textarea[placeholder="Guide the agent..."]'),
        );
      });
      await browserPage.evaluate((value) => {
        const root = document.getElementById("opensidebar-harness-host")
          ?.shadowRoot;
        const textarea = root?.querySelector(
          'textarea[placeholder="Guide the agent..."]',
        ) as HTMLTextAreaElement | null;
        if (!textarea) {
          throw new Error("Overlay feedback textarea was not found.");
        }
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }, text);
      await browserPage.waitForFunction(() => {
        const root = document.getElementById("opensidebar-harness-host")
          ?.shadowRoot;
        return Boolean(
          root?.querySelector('button[aria-label="Send guidance"]'),
        );
      });
      await browserPage.evaluate(() => {
        const root = document.getElementById("opensidebar-harness-host")
          ?.shadowRoot;
        const button = root?.querySelector(
          'button[aria-label="Send guidance"]',
        ) as HTMLButtonElement | null;
        if (!button) {
          throw new Error("Overlay send guidance button was not found.");
        }
        button.click();
      });
    },

    readMessageCapture() {
      return browserPage.evaluate(() => window.__overlaySmoke);
    },

    async close() {
      await browserPage
        .evaluate(() => {
          window.__overlayFakeBackground?.dispose();
          delete window.__overlayFakeBackground;
          delete (window as Window & { __overlaySmoke?: unknown })
            .__overlaySmoke;
          delete window.__opensidebarOverlayConfig;
        })
        .catch(() => {});
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      await staticServer.close().catch(() => {});
    },
  };
}

declare global {
  interface Window {
    __overlaySmoke: OverlayHarnessMessageCapture;
    __overlayFakeBackground?: {
      state: OverlayFakeBackgroundState;
      dispose(): void;
    };
  }
}
