/**
 * E2E test harness — centralizes lifecycle boilerplate shared across test files.
 *
 * Usage:
 *   const harness = createE2EHarness({ maxTurns: 20, testLabel: "my-suite" });
 *   beforeAll(() => harness.beforeAllHook(), 60_000);
 *   beforeEach(() => harness.beforeEachHook());
 *   afterEach(() => harness.afterEachHook(currentTestName));
 *   afterAll(() => harness.afterAllHook());
 */

import type { CDPSession, Page } from "puppeteer";
import { execFile } from "child_process";
import {
  launchWithExtension,
  closeExtension,
  openHelperPage,
  type ExtensionContext,
} from "./browser";
import { resetExtensionState, setupEventMonitor } from "./utils";
import { startFixtureServer, stopFixtureServer } from "./fixture-server";
import {
  startLogServer,
  stopLogServer,
  snapshotTraceFiles,
  readTrace,
  formatTraceSummary,
  attachSwConsole,
} from "./diagnostics";
import { suiteReport } from "./report";
import { collectTraceArtifacts } from "./trace-artifacts";
import { collectE2EVideoTraceMetrics } from "./video-metrics";
import { readE2EConfig } from "./e2e-config";
import {
  resolveE2EProviderConfig,
  type ProviderMode,
} from "./e2e-provider-config";
export { loadApiKey } from "./e2e-provider-config";
import { copyFile, mkdir, readdir, stat, writeFile } from "fs/promises";
import { relative, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../../../..");
const execFileAsync = promisify(execFile);
const FINAL_SCREENSHOT_BLUR_TIMEOUT_MS = 2_000;
const FINAL_SCREENSHOT_CAPTURE_TIMEOUT_MS = 5_000;

export interface HarnessOptions {
  maxTurns?: number;
  testLabel?: string;
  videoStart?: "auto" | "manual";
}

interface E2EVideoRecording {
  page: Page;
  mp4Path: string;
  artifactDir: string;
  frameDir: string;
  timelineFrameDir: string;
  manifestPath: string;
  fileStem: string;
  startedAt: string;
  frameIntervalMs: number;
  frameTimer: NodeJS.Timeout | null;
  client: CDPSession | null;
  onScreencastFrame:
    | ((event: { data: string; sessionId: number }) => void)
    | null;
  captureStopped: boolean;
  capturedFrameCount: number;
  lastFrameBuffer: Buffer | null;
  timelineWriteInProgress: boolean;
  warnings: string[];
}

type E2ETestResultInput = boolean | null | undefined;

function isDiagnosticModeEnabled(): boolean {
  return readE2EConfig().diagnostic;
}

function logHarnessLifecycle(stage: string): void {
  if (isDiagnosticModeEnabled()) {
    console.log(`[e2e:harness] ${stage}`);
  }
}

export interface E2EHarness {
  apiKey: string | undefined;
  providerMode: ProviderMode;
  readonly ctx: ExtensionContext;
  readonly page: Page;
  tracesBefore: Set<string>;

  beforeAllHook(): Promise<void>;
  beforeEachHook(): Promise<void>;
  afterEachHook(testName?: string, result?: E2ETestResultInput): Promise<void>;
  afterAllHook(): Promise<void>;
  startVideoRecording(): Promise<void>;

  printTraceSummary(
    workspaceId?: string | null,
  ): Promise<{ traceFiles: string[]; turns: any[] }>;
}

function shouldCaptureFinalScreenshot(): boolean {
  return readE2EConfig().artifacts.finalScreenshot;
}

function shouldRecordE2EVideo(): boolean {
  return readE2EConfig().artifacts.recordVideo;
}

function getE2EVideoFrameIntervalMs(): number {
  return readE2EConfig().artifacts.videoFrameIntervalMs;
}

function artifactDate(): string {
  return new Date().toISOString().split("T")[0];
}

function artifactTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}

function sanitizeArtifactName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "e2e"
  );
}

function screenshotResultSuffix(passed: boolean | null): string {
  if (passed === true) return "pass";
  if (passed === false) return "fail";
  return "done";
}

function resolvePassed(result: E2ETestResultInput): boolean | null {
  if (result === true || result === false) return result;
  return null;
}

function videoRunResult(passed: boolean | null | undefined): string {
  if (passed === true) return "passed";
  if (passed === false) return "failed";
  return "unknown";
}

function relativeArtifactPath(
  filePath: string | null | undefined,
): string | null {
  if (!filePath) return null;
  return relative(PROJECT_ROOT, filePath).replace(/\\/g, "/");
}

function withArtifactTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function captureFinalScreenshots(input: {
  ctx: ExtensionContext;
  page: Page | null | undefined;
  testName: string;
  passed: boolean | null;
}): Promise<string[]> {
  if (!shouldCaptureFinalScreenshot()) return [];

  const today = artifactDate();
  const timestamp = artifactTimestamp();
  const dir = resolve(PROJECT_ROOT, ".artifacts", "e2e", "screenshots", today);
  await mkdir(dir, { recursive: true });

  const targets: Array<{ label: string; page: Page | null | undefined }> = [
    { label: "view", page: input.page },
  ];
  if (input.ctx.detachedPanelPage && !input.ctx.detachedPanelPage.isClosed()) {
    targets.push({ label: "panel", page: input.ctx.detachedPanelPage });
  }
  const seenPages = new Set(targets.map((target) => target.page));
  const browserPages = await input.ctx.browser.pages().catch(() => []);
  let fallbackIndex = 1;
  for (const browserPage of browserPages) {
    if (browserPage.isClosed()) continue;
    if (browserPage.url().startsWith("chrome-extension://")) continue;
    if (seenPages.has(browserPage)) continue;
    seenPages.add(browserPage);
    targets.push({ label: `view-${fallbackIndex}`, page: browserPage });
    fallbackIndex += 1;
  }

  const paths: string[] = [];
  for (const target of targets) {
    if (!target.page || target.page.isClosed()) continue;
    const fileName = [
      timestamp,
      sanitizeArtifactName(input.testName),
      screenshotResultSuffix(input.passed),
      target.label,
    ].join("-");
    const filePath = resolve(dir, `${fileName}.png`);
    try {
      await withArtifactTimeout(
        blurArtifactFocus(target.page),
        FINAL_SCREENSHOT_BLUR_TIMEOUT_MS,
        "Final screenshot focus blur",
      ).catch(() => {});
      await withArtifactTimeout(
        target.page.screenshot({ path: filePath }),
        FINAL_SCREENSHOT_CAPTURE_TIMEOUT_MS,
        "Final screenshot capture",
      );
      paths.push(filePath);
      console.log(`[e2e] Final screenshot: ${filePath}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[e2e] Failed to capture final screenshot: ${detail}`);
    }
  }
  return paths;
}

async function blurArtifactFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const blurElement = (element: Element | null | undefined) => {
      if (element instanceof HTMLElement) element.blur();
    };
    blurElement(document.activeElement);
    for (const host of document.querySelectorAll("*")) {
      const shadowRoot = host.shadowRoot;
      if (shadowRoot) blurElement(shadowRoot.activeElement);
    }
  });
}

async function startE2EVideoRecording(input: {
  page: Page | null | undefined;
  testLabel: string;
}): Promise<E2EVideoRecording | null> {
  if (!shouldRecordE2EVideo() || !input.page || input.page.isClosed()) {
    return null;
  }

  const today = artifactDate();
  const timestamp = artifactTimestamp();
  const dir = resolve(PROJECT_ROOT, ".artifacts", "e2e", "videos", today);
  await mkdir(dir, { recursive: true });

  const fileName = [
    timestamp,
    sanitizeArtifactName(input.testLabel),
    "view",
  ].join("-");
  const mp4Path = resolve(dir, `${fileName}.mp4`);
  const artifactDir = resolve(
    PROJECT_ROOT,
    ".artifacts",
    "e2e",
    "video-runs",
    today,
    fileName,
  );
  const frameDir = resolve(artifactDir, "frames");
  const timelineFrameDir = resolve(artifactDir, "timeline-frames");
  await mkdir(frameDir, { recursive: true });
  await mkdir(timelineFrameDir, { recursive: true });

  const recording: E2EVideoRecording = {
    page: input.page,
    mp4Path,
    artifactDir,
    frameDir,
    timelineFrameDir,
    manifestPath: resolve(artifactDir, "manifest.json"),
    fileStem: fileName,
    startedAt: new Date().toISOString(),
    frameIntervalMs: getE2EVideoFrameIntervalMs(),
    frameTimer: null,
    client: null,
    onScreencastFrame: null,
    captureStopped: false,
    capturedFrameCount: 0,
    lastFrameBuffer: null,
    timelineWriteInProgress: false,
    warnings: [],
  };

  await startTimelineScreencast(recording);
  recording.frameTimer = setInterval(() => {
    void writeTimelineFrame(recording);
  }, recording.frameIntervalMs);
  return recording;
}

async function settleVideoSurface(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await page.bringToFront().catch(() => {});
  await blurArtifactFocus(page).catch(() => {});
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        }),
    )
    .catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function runMediaTool(
  command: string,
  args: string[],
  warnings: string[],
  label: string,
): Promise<string | null> {
  const timeout = readE2EConfig().artifacts.mediaToolTimeoutMs;
  try {
    const result = await execFileAsync(command, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    return String(result.stdout ?? "");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnings.push(`${label} failed: ${detail}`);
    return null;
  }
}

async function hasNonEmptyFile(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then((fileStat) => fileStat.size > 0)
    .catch(() => false);
}

async function getPrimaryVideoPath(
  recording: E2EVideoRecording,
): Promise<string | null> {
  return (await hasNonEmptyFile(recording.mp4Path)) ? recording.mp4Path : null;
}

function pushUniqueWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

async function startTimelineScreencast(
  recording: E2EVideoRecording,
): Promise<void> {
  try {
    const frameWithClient = recording.page.mainFrame() as unknown as {
      client: CDPSession;
    };
    const client = frameWithClient.client;
    recording.client = client;
    recording.onScreencastFrame = (event) => {
      recording.lastFrameBuffer = Buffer.from(event.data, "base64");
      void client
        .send("Page.screencastFrameAck", { sessionId: event.sessionId })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          pushUniqueWarning(
            recording.warnings,
            `video frame ack failed: ${detail}`,
          );
        });
    };
    client.on("Page.screencastFrame", recording.onScreencastFrame as any);
    await client.send("Page.startScreencast", {
      format: "jpeg",
      quality: 82,
      everyNthFrame: 1,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pushUniqueWarning(
      recording.warnings,
      `video screencast start failed: ${detail}`,
    );
  }
}

async function stopTimelineScreencast(
  recording: E2EVideoRecording,
): Promise<void> {
  if (!recording.client) return;
  try {
    if (recording.onScreencastFrame) {
      recording.client.off(
        "Page.screencastFrame",
        recording.onScreencastFrame as any,
      );
    }
    await recording.client.send("Page.stopScreencast");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pushUniqueWarning(
      recording.warnings,
      `video screencast stop failed: ${detail}`,
    );
  }
}

async function writeTimelineFrame(
  recording: E2EVideoRecording,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!options.force && recording.captureStopped) return;
  if (recording.timelineWriteInProgress || !recording.lastFrameBuffer) return;

  recording.timelineWriteInProgress = true;
  try {
    const nextFrame = recording.capturedFrameCount + 1;
    const framePath = resolve(
      recording.timelineFrameDir,
      `frame-${String(nextFrame).padStart(6, "0")}.jpg`,
    );
    await writeFile(framePath, recording.lastFrameBuffer);
    recording.capturedFrameCount = nextFrame;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    pushUniqueWarning(
      recording.warnings,
      `video frame write failed: ${detail}`,
    );
  } finally {
    recording.timelineWriteInProgress = false;
  }
}

async function listTimelineFrames(
  recording: E2EVideoRecording,
): Promise<string[]> {
  return (await readdir(recording.timelineFrameDir).catch(() => []))
    .filter((name) => /^frame-\d+\.jpg$/i.test(name))
    .sort()
    .map((name) => resolve(recording.timelineFrameDir, name));
}

function formatFrameRate(frameIntervalMs: number): string {
  return (1000 / frameIntervalMs).toFixed(3).replace(/\.?0+$/, "");
}

async function transcodeVideoArtifactToMp4(
  recording: E2EVideoRecording,
): Promise<void> {
  const timelineFrames = await listTimelineFrames(recording);
  if (timelineFrames.length === 0) {
    recording.warnings.push(
      "MP4 video artifact was not created; no timeline frames were captured.",
    );
    return;
  }

  const ffmpeg = readE2EConfig().artifacts.ffmpegPath;
  await runMediaTool(
    ffmpeg,
    [
      "-y",
      "-framerate",
      formatFrameRate(recording.frameIntervalMs),
      "-i",
      resolve(recording.timelineFrameDir, "frame-%06d.jpg"),
      "-vf",
      "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      recording.mp4Path,
    ],
    recording.warnings,
    "ffmpeg mp4 transcode",
  );

  if (!(await hasNonEmptyFile(recording.mp4Path))) {
    recording.warnings.push("MP4 video artifact was not created.");
    return;
  }

  console.log(`[e2e] MP4 video artifact: ${recording.mp4Path}`);
}

async function probeVideoArtifact(
  recording: E2EVideoRecording,
  sourcePath: string,
): Promise<Record<string, unknown> | null> {
  const ffprobe = readE2EConfig().artifacts.ffprobePath;
  const stdout = await runMediaTool(
    ffprobe,
    [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=nb_read_frames,width,height,avg_frame_rate",
      "-show_entries",
      "format=size,duration",
      "-of",
      "json",
      sourcePath,
    ],
    recording.warnings,
    "ffprobe",
  );
  if (!stdout) return null;
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    recording.warnings.push(`ffprobe JSON parse failed: ${detail}`);
    return null;
  }
}

async function generateVideoFrameArtifacts(
  recording: E2EVideoRecording,
  sourcePath: string,
): Promise<{
  frames: string[];
  contactFrames: string[];
  contactSheetPath: string | null;
  contactSelection: ContactFrameSelection | null;
}> {
  const ffmpeg = readE2EConfig().artifacts.ffmpegPath;
  const framePattern = resolve(recording.frameDir, "frame-%03d.png");
  const contactSheetPath = resolve(recording.artifactDir, "contact-sheet.png");
  const contactFrameDir = resolve(recording.artifactDir, "contact-frames");
  const contactFramePattern = resolve(contactFrameDir, "contact-%03d.png");

  await runMediaTool(
    ffmpeg,
    [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      "select=not(mod(n\\,12))",
      "-fps_mode",
      "vfr",
      framePattern,
    ],
    recording.warnings,
    "ffmpeg frame extraction",
  );

  const frames = (await readdir(recording.frameDir).catch(() => []))
    .filter((name) => /^frame-\d+\.png$/i.test(name))
    .sort()
    .map((name) => resolve(recording.frameDir, name));

  if (frames.length === 0) {
    return {
      frames,
      contactFrames: [],
      contactSheetPath: null,
      contactSelection: null,
    };
  }

  const contactArtifacts = await buildContactSheetFrames(
    frames,
    contactFrameDir,
  );
  const contactFrames = contactArtifacts.contactFrames;
  const tileColumns = Math.ceil(Math.sqrt(contactFrames.length));
  const tileRows = Math.ceil(contactFrames.length / tileColumns);

  await runMediaTool(
    ffmpeg,
    [
      "-y",
      "-framerate",
      "1",
      "-i",
      contactFramePattern,
      "-vf",
      `scale=480:-1,tile=${tileColumns}x${tileRows}`,
      "-frames:v",
      "1",
      "-update",
      "1",
      contactSheetPath,
    ],
    recording.warnings,
    "ffmpeg contact sheet",
  );

  const hasContactSheet = await stat(contactSheetPath)
    .then((fileStat) => fileStat.size > 0)
    .catch(() => false);
  return {
    frames,
    contactFrames,
    contactSheetPath: hasContactSheet ? contactSheetPath : null,
    contactSelection: contactArtifacts.selection,
  };
}

type ContactFrameSelection = {
  strategy: "first-last-change-evenly-spaced";
  sourceFrameCount: number;
  nonBlankFrameCount: number;
  maxContactFrames: number;
  selectedSourceIndexes: number[];
  selectedSourceBytes: number[];
};

async function buildContactSheetFrames(
  frames: string[],
  contactFrameDir: string,
): Promise<{ contactFrames: string[]; selection: ContactFrameSelection }> {
  const frameStats = await Promise.all(
    frames.map(async (filePath, index) => ({
      filePath,
      index,
      bytes: await stat(filePath)
        .then((fileStat) => fileStat.size)
        .catch(() => 0),
    })),
  );
  const nonBlankFrames = frameStats.filter((entry) => entry.bytes > 20_000);
  const sourceFrames = nonBlankFrames.length > 0 ? nonBlankFrames : frameStats;
  const selected = selectRepresentativeFrameStats(sourceFrames);

  await mkdir(contactFrameDir, { recursive: true });
  const contactFrames: string[] = [];
  for (const [index, sourceFrame] of selected.entries()) {
    const targetPath = resolve(
      contactFrameDir,
      `contact-${String(index + 1).padStart(3, "0")}.png`,
    );
    await copyFile(sourceFrame.filePath, targetPath);
    contactFrames.push(targetPath);
  }
  return {
    contactFrames,
    selection: {
      strategy: "first-last-change-evenly-spaced",
      sourceFrameCount: frameStats.length,
      nonBlankFrameCount: nonBlankFrames.length,
      maxContactFrames: 9,
      selectedSourceIndexes: selected.map((frame) => frame.index),
      selectedSourceBytes: selected.map((frame) => frame.bytes),
    },
  };
}

function selectRepresentativeFrameStats(
  sourceFrames: Array<{ filePath: string; index: number; bytes: number }>,
): Array<{ filePath: string; index: number; bytes: number }> {
  const count = Math.min(9, sourceFrames.length);
  if (count <= 1) return sourceFrames.slice(0, count);

  const selected = new Map<
    number,
    { filePath: string; index: number; bytes: number }
  >();
  const addFrame = (frame: {
    filePath: string;
    index: number;
    bytes: number;
  }) => {
    if (selected.size < count) selected.set(frame.index, frame);
  };

  addFrame(sourceFrames[0]);
  addFrame(sourceFrames[sourceFrames.length - 1]);

  const changeCandidates = sourceFrames
    .slice(1)
    .map((frame, offset) => {
      const previous = sourceFrames[offset];
      const relativeChange =
        Math.abs(frame.bytes - previous.bytes) / Math.max(previous.bytes, 1);
      const absoluteChange = Math.abs(frame.bytes - previous.bytes);
      return { frame, score: relativeChange * 100_000 + absoluteChange };
    })
    .filter((candidate) => candidate.score > 5_000)
    .sort((a, b) => b.score - a.score);

  for (const candidate of changeCandidates) {
    addFrame(candidate.frame);
  }

  for (let index = 0; selected.size < count && index < count; index += 1) {
    const sourceIndex = Math.round(
      (index * (sourceFrames.length - 1)) / (count - 1),
    );
    addFrame(sourceFrames[sourceIndex]);
  }

  return [...selected.values()].sort((a, b) => a.index - b.index);
}

function buildReviewTimeline(traceFiles: string[] = []): {
  source: "trace";
  traceCount: number;
  turnCount: number;
  turns: Array<{
    turnNumber: number;
    url?: string;
    durationMs?: number;
    toolCalls: string[];
    failedTools: string[];
  }>;
} {
  const turns = traceFiles
    .flatMap((filePath) => readTrace(filePath))
    .map((turn) => ({
      turnNumber: turn.turnNumber,
      url: turn.url,
      durationMs: turn.durationMs,
      toolCalls: turn.toolCalls.map((toolCall) => toolCall.name),
      failedTools: turn.toolResults
        .filter((result) => !result.success)
        .map((result) => result.name),
    }))
    .slice(0, 80);
  return {
    source: "trace",
    traceCount: traceFiles.length,
    turnCount: turns.length,
    turns,
  };
}

async function writeVideoArtifactManifest(
  recording: E2EVideoRecording,
  input: {
    testName?: string;
    passed?: boolean | null;
    durationMs?: number;
    screenshotPaths?: string[];
    traceFiles?: string[];
    providerMode?: ProviderMode;
  },
): Promise<void> {
  const primaryVideoPath = await getPrimaryVideoPath(recording);
  const videoStat = primaryVideoPath
    ? await stat(primaryVideoPath).catch(() => null)
    : null;
  const mp4Stat = await stat(recording.mp4Path).catch(() => null);
  const timelineFrames = await listTimelineFrames(recording);
  const probe = primaryVideoPath
    ? await probeVideoArtifact(recording, primaryVideoPath)
    : null;
  const frameArtifacts = primaryVideoPath
    ? await generateVideoFrameArtifacts(recording, primaryVideoPath)
    : {
        frames: [],
        contactFrames: [],
        contactSheetPath: null,
        contactSelection: null,
      };
  const manifest = {
    schemaVersion: "2026-05-14",
    createdAt: new Date().toISOString(),
    testLabel: input.testName ?? recording.fileStem,
    providerMode: input.providerMode ?? null,
    result: videoRunResult(input.passed),
    passed: input.passed ?? null,
    durationMs: input.durationMs ?? null,
    video: {
      path: relativeArtifactPath(primaryVideoPath),
      format: primaryVideoPath ? "mp4" : null,
      bytes: videoStat?.size ?? null,
      startedAt: recording.startedAt,
      frameIntervalMs: recording.frameIntervalMs,
      timelineFrames: {
        directory: relativeArtifactPath(recording.timelineFrameDir),
        count: timelineFrames.length,
      },
      mp4: {
        path: relativeArtifactPath(recording.mp4Path),
        bytes: mp4Stat?.size ?? null,
      },
    },
    screenshots: (input.screenshotPaths ?? []).map(relativeArtifactPath),
    traceFiles: (input.traceFiles ?? []).map(relativeArtifactPath),
    metrics: collectE2EVideoTraceMetrics(input.traceFiles),
    reviewTimeline: buildReviewTimeline(input.traceFiles ?? []),
    frames: {
      directory: relativeArtifactPath(recording.frameDir),
      count: frameArtifacts.frames.length,
      samples: frameArtifacts.frames.map(relativeArtifactPath),
      contactSamples: frameArtifacts.contactFrames.map(relativeArtifactPath),
      contactSheet: relativeArtifactPath(frameArtifacts.contactSheetPath),
      contactSelection: frameArtifacts.contactSelection,
    },
    ffprobe: probe,
    warnings: recording.warnings,
  };
  await writeFile(
    recording.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
  console.log(`[e2e] Video artifact manifest: ${recording.manifestPath}`);
  if (frameArtifacts.contactSheetPath) {
    console.log(
      `[e2e] Video contact sheet: ${frameArtifacts.contactSheetPath}`,
    );
  }
}

async function stopE2EVideoRecording(
  recording: E2EVideoRecording | null,
  input: {
    testName?: string;
    passed?: boolean | null;
    durationMs?: number;
    screenshotPaths?: string[];
    traceFiles?: string[];
    providerMode?: ProviderMode;
  } = {},
): Promise<void> {
  if (!recording) return;
  recording.captureStopped = true;
  if (recording.frameTimer) {
    clearInterval(recording.frameTimer);
    recording.frameTimer = null;
  }
  await writeTimelineFrame(recording, { force: true });
  await stopTimelineScreencast(recording);
  await transcodeVideoArtifactToMp4(recording);
  console.log(
    `[e2e] Primary video artifact: ${await getPrimaryVideoPath(recording)}`,
  );
  await writeVideoArtifactManifest(recording, input).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[e2e] Failed to write video artifacts: ${detail}`);
  });
}

export function createE2EHarness(options: HarnessOptions = {}): E2EHarness {
  const maxTurns = options.maxTurns ?? 20;
  const testLabel = options.testLabel ?? "e2e";
  const videoStart = options.videoStart ?? "auto";

  const providerConfig = resolveE2EProviderConfig();
  const providerMode = providerConfig.providerMode;
  const apiKey = providerConfig.apiKey;

  let ctx: ExtensionContext;
  let page: Page;
  let detachConsole: (() => void) | null = null;
  let tracesBefore: Set<string> = new Set();
  let testStartTime = 0;
  let activeVideoRecording: E2EVideoRecording | null = null;

  const harness: E2EHarness = {
    apiKey,
    providerMode,

    get ctx() {
      return ctx;
    },

    get page() {
      return page;
    },

    get tracesBefore() {
      return tracesBefore;
    },
    set tracesBefore(value: Set<string>) {
      tracesBefore = value;
    },

    async beforeAllHook() {
      await startLogServer();
      await startFixtureServer();
      ctx = await launchWithExtension();
      const diagnosticMode = isDiagnosticModeEnabled();
      detachConsole = await attachSwConsole(ctx.browser, { diagnosticMode });

      const pages = await ctx.browser.pages();
      page =
        pages.find(
          (candidate) => !candidate.url().startsWith("chrome-extension://"),
        ) || (await ctx.browser.newPage());

      const helper = await openHelperPage(ctx);
      const lane = providerConfig.lane;
      const {
        openRouterKey,
        groqKey,
        openAiKey,
        fireworksKey,
        deepseekKey,
        kimiKey,
        xiaomiKey,
        cerebrasKey,
      } = providerConfig.keys;
      const e2eConfig = readE2EConfig();
      const executorModel = e2eConfig.model;
      const plannerModel = e2eConfig.plannerModel;
      const judgeModel = e2eConfig.judgeModel;
      const executorProviderPin = e2eConfig.executorProviderPin;
      const plannerProviderPin = e2eConfig.plannerProviderPin;
      const judgeProviderPin = e2eConfig.judgeProviderPin;
      const temperature = e2eConfig.runtime.temperature;
      const perceptionMode = e2eConfig.perceptionMode;
      const presenceMode = e2eConfig.presenceMode;
      suiteReport.setRunMetadata({
        provider: providerMode,
        lane,
        configuredExecutorModel: executorModel ?? null,
        diagnosticMode,
      });
      await helper.evaluate(
        async (
          openRouterKey: string | null,
          turns: number,
          mode: string,
          gKey: string | null,
          openAiKey: string | null,
          fwKey: string | null,
          deepseekKey: string | null,
          kimiKey: string | null,
          xiaomiKey: string | null,
          cerebrasKey: string | null,
          execModel: string | null,
          plannerModelOverride: string | null,
          judgeModelOverride: string | null,
          executorPin: string | null,
          plannerPin: string | null,
          judgePin: string | null,
          temp: number | null,
          perceptionMode: string | null,
          presenceMode: string | null,
        ) => {
          const localData: Record<string, string> = {};
          if (openRouterKey) localData.openRouterApiKey_local = openRouterKey;
          if (gKey) localData.groqApiKey_local = gKey;
          if (openAiKey) localData.openaiApiKey_local = openAiKey;
          if (fwKey) localData.fireworksApiKey_local = fwKey;
          if (deepseekKey) localData.deepseekApiKey_local = deepseekKey;
          if (kimiKey) localData.kimiApiKey_local = kimiKey;
          if (xiaomiKey) localData.xiaomiApiKey_local = xiaomiKey;
          if (cerebrasKey) localData.cerebrasApiKey_local = cerebrasKey;
          await chrome.storage.local.set(localData);
          const settings: Record<string, unknown> = {
            requireApprovals: false,
            allowNavigation: false,
            requirePlanConfirmation: false,
            showElementTags: false,
            maxTurns: turns,
            providerMode: mode,
          };
          if (execModel) settings.executorModel = execModel;
          if (plannerModelOverride) settings.plannerModel = plannerModelOverride;
          if (judgeModelOverride) settings.judgeModel = judgeModelOverride;
          if (executorPin) settings.executorProviderPin = executorPin;
          if (plannerPin) settings.plannerProviderPin = plannerPin;
          if (judgePin) settings.judgeProviderPin = judgePin;
          if (temp !== null) settings.temperature = temp;
          if (perceptionMode) settings.perceptionMode = perceptionMode;
          if (presenceMode) settings.presenceMode = presenceMode;
          // Film runs: keep the cursor visible during captures — no per-turn
          // blink on camera (the model tolerates seeing the pointer).
          if (presenceMode === "cinematic") {
            settings.presenceHideDuringCapture = false;
          }
          await chrome.storage.sync.set({ userSettings: settings });
        },
        openRouterKey ?? null,
        maxTurns,
        providerMode,
        groqKey ?? null,
        openAiKey ?? null,
        fireworksKey ?? null,
        deepseekKey ?? null,
        kimiKey ?? null,
        xiaomiKey ?? null,
        cerebrasKey ?? null,
        executorModel ?? null,
        plannerModel ?? null,
        judgeModel ?? null,
        executorProviderPin ?? null,
        plannerProviderPin ?? null,
        judgeProviderPin ?? null,
        temperature ?? null,
        perceptionMode ?? null,
        presenceMode ?? null,
      );

      await setupEventMonitor(ctx.serviceWorker);
    },

    async beforeEachHook() {
      const freshPage = await resetExtensionState(ctx);
      tracesBefore = snapshotTraceFiles();
      testStartTime = Date.now();
      page = freshPage || (await ctx.browser.newPage());
      if (videoStart === "auto") {
        await harness.startVideoRecording();
      }
    },

    async startVideoRecording() {
      if (activeVideoRecording) return;
      await settleVideoSurface(page);
      activeVideoRecording = await startE2EVideoRecording({
        page,
        testLabel,
      });
    },

    async afterEachHook(testName?: string, result: E2ETestResultInput = null) {
      logHarnessLifecycle(`afterEach start ${testName ?? testLabel}`);
      const passed = resolvePassed(result);
      const durationMs = testStartTime > 0 ? Date.now() - testStartTime : 0;
      logHarnessLifecycle("afterEach capture screenshots");
      const screenshotPaths = await captureFinalScreenshots({
        ctx,
        page,
        testName: testName ?? testLabel,
        passed,
      });
      logHarnessLifecycle("afterEach collect traces");
      const traceArtifacts = testName
        ? await collectTraceArtifacts({ tracesBefore })
        : null;
      const traceFiles = traceArtifacts?.traceFiles ?? [];
      logHarnessLifecycle("afterEach stop video");
      await stopE2EVideoRecording(activeVideoRecording, {
        testName: testName ?? testLabel,
        passed,
        durationMs,
        screenshotPaths,
        traceFiles,
        providerMode,
      });
      activeVideoRecording = null;
      if (testName) {
        logHarnessLifecycle("afterEach record report");
        suiteReport.record(testName, passed, durationMs, traceArtifacts ?? traceFiles);
      }
      logHarnessLifecycle("afterEach done; next beforeEach owns reset");
      logHarnessLifecycle(`afterEach done ${testName ?? testLabel}`);
    },

    async afterAllHook() {
      await stopE2EVideoRecording(activeVideoRecording);
      activeVideoRecording = null;
      if (detachConsole) detachConsole();
      if (ctx) await closeExtension(ctx);
      await stopFixtureServer();
      await stopLogServer();
    },

    async printTraceSummary(workspaceId?: string | null) {
      const traceArtifacts = await collectTraceArtifacts({
        tracesBefore,
        workspaceId,
        timeoutMs: 10_000,
      });
      const traceFiles = traceArtifacts.traceFiles;
      const allTurns = traceFiles.flatMap((f) => readTrace(f));

      for (const f of traceFiles) {
        const turns = readTrace(f);
        console.log(formatTraceSummary(turns));
        console.log(`[${testLabel}] Trace: ${f}`);
      }

      if (traceFiles.length === 0) {
        console.log(`[${testLabel}] No trace file found`);
      }

      return { traceFiles, turns: allTurns };
    },
  };

  return harness;
}
