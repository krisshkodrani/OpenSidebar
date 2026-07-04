/**
 * PerceptionAgent — Stateful perception with observation history
 *
 * Replaces the stateless `perceive()` function with a class that accumulates
 * observations across turns (text-centric history pattern). Each `observe()`
 * call feeds prior observations into the VLM prompt, enabling change detection,
 * persistent blocker tracking, and cumulative understanding.
 *
 * The prompt is unified (no orientation/focused split) with 5 goal-free sections:
 * LOCATION, CHANGES, BLOCKERS, VISUAL-ONLY, AFFORDANCES.
 *
 * Completion checking is removed — that responsibility belongs to a verifier.
 */

import type { UserSettings } from "../../types";
import { loadSettings } from "../../utils/settings-storage";
import { logger } from "../../utils";
import { renderPrompt } from "../../prompts";
import { stripThinkTags } from "../llm";
import type { TokenUsage } from "../llm/types";
import { buildElementSummary } from "./perception";
import { buildProductionPerceptionPrompt } from "./prompt-builder";
import type {
  TaggedElement,
  TracePerceptionFallbackReason,
  TracePerceptionFreshnessReason,
  TracePerceptionMode,
  TracePerceptionScreenshotStatus,
  TracePerceptionSource,
} from "../../types";
import type {
  ObservationEntry,
  ObserveInput,
  PerceptionState,
  PerceptionResult,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_PERCEPTION_MODEL = "x-ai/grok-4.1-fast";
const OPENAI_API_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const OPENAI_PERCEPTION_MODEL = "accounts/fireworks/routers/kimi-k2p6-turbo";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_PERCEPTION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const MOONSHOT_API_URL = "https://api.moonshot.ai/v1/chat/completions";
const MOONSHOT_PERCEPTION_MODEL = "kimi-k2.6";
const XIAOMI_API_URL = "https://api.xiaomimimo.com/v1/chat/completions";
const XIAOMI_PERCEPTION_MODEL = "mimo-v2-omni";
const FIREWORKS_API_URL =
  "https://api.fireworks.ai/inference/v1/chat/completions";
const FIREWORKS_PERCEPTION_MODEL = "accounts/fireworks/routers/kimi-k2p6-turbo";
const PERCEPTION_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 800;

/** Number of full-detail observation entries in prompt context */
const OBSERVATION_WINDOW = 5;

/** Tool-aware stale thresholds: routine actions need vision less frequently. */
const STALE_THRESHOLD_ROUTINE = 4; // click, type, scroll, press_key, select_option, set_checkbox
const STALE_THRESHOLD_NAVIGATION = 1; // navigate, go_back, create_tab, switch_tab
const STALE_THRESHOLD_DEFAULT = 2; // everything else

const ROUTINE_TOOLS = new Set([
  "click_element",
  "type_text",
  "scroll_page",
  "press_key",
  "select_option",
  "set_checkbox",
]);
const NAVIGATION_TOOLS = new Set([
  "navigate",
  "go_back",
  "create_tab",
  "switch_tab",
]);

function getStaleThreshold(lastToolName?: string): number {
  if (!lastToolName) return STALE_THRESHOLD_DEFAULT;
  if (NAVIGATION_TOOLS.has(lastToolName)) return STALE_THRESHOLD_NAVIGATION;
  if (ROUTINE_TOOLS.has(lastToolName)) return STALE_THRESHOLD_ROUTINE;
  return STALE_THRESHOLD_DEFAULT;
}

function hashRenderContent(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

function resolveRenderHash(input: ObserveInput): string {
  if (input.renderHash) return input.renderHash;
  if (!input.screenshotDataUrl) return "";
  return hashRenderContent(input.screenshotDataUrl);
}

interface PerceptionTraceMeta {
  mode: TracePerceptionMode;
  source: TracePerceptionSource;
  freshnessReason: TracePerceptionFreshnessReason;
  fallbackReason?: TracePerceptionFallbackReason;
  screenshotStatus: TracePerceptionScreenshotStatus;
}

interface PerceptionTraceStats {
  model: string;
  providerId?: string;
  durationMs: number;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface PerceptionProvider {
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  model: string;
  providerId: string;
}

function buildProviders(settings: UserSettings): PerceptionProvider[] {
  const providers: PerceptionProvider[] = [];
  const mode =
    settings.providerMode ??
    (settings.provider === "groq"
      ? "openrouter-groq"
      : settings.provider === "openai"
        ? "openai-groq"
        : "openrouter");

  // Fireworks-backed modes: use Kimi K2.6 Turbo for perception
  if (
    (mode === "fireworks" || mode === "fireworks-deepseek") &&
    settings.fireworksApiKey
  ) {
    providers.push({
      baseUrl: FIREWORKS_API_URL,
      apiKey: settings.fireworksApiKey,
      headers: {},
      model: settings.perceptionModel || FIREWORKS_PERCEPTION_MODEL,
      providerId: "fireworks",
    });
  }

  if (mode === "moonshot" && settings.kimiApiKey) {
    providers.push({
      baseUrl: MOONSHOT_API_URL,
      apiKey: settings.kimiApiKey,
      headers: {},
      model: settings.perceptionModel || MOONSHOT_PERCEPTION_MODEL,
      providerId: "moonshot",
    });
  }

  if (mode === "xiaomi" && settings.xiaomiApiKey) {
    providers.push({
      baseUrl: XIAOMI_API_URL,
      apiKey: settings.xiaomiApiKey,
      headers: {},
      model: settings.perceptionModel || XIAOMI_PERCEPTION_MODEL,
      providerId: "xiaomi",
    });
  }

  // Hybrid modes: Groq as primary perception provider (fast, cheap)
  if (
    (mode === "openrouter-groq" || mode === "openai-groq") &&
    settings.groqApiKey
  ) {
    providers.push({
      baseUrl: GROQ_API_URL,
      apiKey: settings.groqApiKey,
      headers: {},
      model: settings.perceptionModel || GROQ_PERCEPTION_MODEL,
      providerId: "groq",
    });
  }

  // OpenAI-groq fallback: redirected to Fireworks
  if (mode === "openai-groq" && settings.openaiApiKey && !settings.groqApiKey) {
    providers.push({
      baseUrl: OPENAI_API_URL,
      apiKey: settings.openaiApiKey,
      headers: {},
      model: settings.perceptionModel || OPENAI_PERCEPTION_MODEL,
      providerId: "fireworks",
    });
  }

  // OpenRouter as fallback (or primary when no OpenAI)
  const openRouterKey = settings.openRouterApiKey;
  if (openRouterKey) {
    providers.push({
      baseUrl: OPENROUTER_API_URL,
      apiKey: openRouterKey,
      headers: {
        "HTTP-Referer": "chrome-extension://opensidebar",
        "X-Title": "OpenSidebar",
      },
      model: (() => {
        const base = settings.perceptionModel || OPENROUTER_PERCEPTION_MODEL;
        return settings.useNitro && !base.endsWith(":nitro")
          ? `${base}:nitro`
          : base;
      })(),
      providerId: "openrouter",
    });
  }
  return providers;
}

// ---------------------------------------------------------------------------
// Observation log formatting
// ---------------------------------------------------------------------------

/** Format a single observation entry for the VLM prompt context. */
function formatObservationLine(entry: ObservationEntry): string {
  const parts = [`T${entry.turn}: ${entry.url} — ${entry.location}`];
  if (entry.changes) parts.push(entry.changes);
  if (entry.blockers && !/^none\.?$/i.test(entry.blockers)) {
    parts.push(`Blockers: ${entry.blockers}`);
  }
  return parts.join(". ").replace(/\.\./g, ".");
}

/**
 * Build the `{{priorObservations}}` template value from the observation log.
 * Returns empty string on first call (no prior history).
 */
export function formatPriorObservations(
  log: readonly ObservationEntry[],
): string {
  if (log.length === 0) return "";

  const lines: string[] = [];

  // Overflow summary for entries before the window
  if (log.length > OBSERVATION_WINDOW) {
    const overflowCount = log.length - OBSERVATION_WINDOW;
    const lastOverflow = log[overflowCount - 1];
    lines.push(
      `[Earlier: Visited ${overflowCount} page(s). Last: ${lastOverflow.location}. ${overflowCount} observation(s) compressed.]`,
    );
  }

  // Recent entries at full detail
  const windowStart = Math.max(0, log.length - OBSERVATION_WINDOW);
  for (let i = windowStart; i < log.length; i++) {
    lines.push("  " + formatObservationLine(log[i]));
  }

  return "Prior observations (recent turns):\n" + lines.join("\n");
}

// ---------------------------------------------------------------------------
// Observation parsing
// ---------------------------------------------------------------------------

/** Extract a named section value from the VLM output text. */
function extractSection(text: string, sectionName: string): string {
  // Match "N. SECTION_NAME: content" up to the next numbered section or end
  const pattern = new RegExp(
    `\\d+\\.\\s*${sectionName}:\\s*(.+?)(?=\\n\\d+\\.\\s|$)`,
    "si",
  );
  const match = text.match(pattern);
  return match ? match[1].trim() : "";
}

/** Parse VLM response text into an ObservationEntry. */
function parseObservation(
  text: string,
  turn: number,
  url: string,
  fingerprint: string,
): ObservationEntry {
  return {
    turn,
    url: url.length > 80 ? url.slice(0, 77) + "..." : url,
    location: extractSection(text, "LOCATION").slice(0, 120),
    changes: extractSection(text, "CHANGES").slice(0, 200),
    blockers: extractSection(text, "BLOCKERS").slice(0, 200),
    visualOnly: extractSection(text, "VISUAL-ONLY").slice(0, 150),
    fingerprint,
  };
}

// ---------------------------------------------------------------------------
// AFFORDANCES validation
// ---------------------------------------------------------------------------

/**
 * Validate [N] tag IDs in the AFFORDANCES section of perception output against
 * the actual element list. The VLM sometimes hallucinates tag-to-element mappings
 * (sees a button in the screenshot, guesses it's [6] when [6] is actually a radio
 * input). This validator strips or corrects wrong references so the agent doesn't
 * click the wrong element.
 */
export function validatePerceptionTagIds(
  interpretation: string,
  elements: TaggedElement[],
): string {
  // Build a lookup: tag number → element description
  const tagMap = new Map<number, TaggedElement>();
  for (const el of elements) {
    tagMap.set(el.tag, el);
  }

  // Find the AFFORDANCES section
  const affordancesMatch = interpretation.match(
    /(\d+\.\s*AFFORDANCES:\s*)([\s\S]*?)(?=\n\d+\.\s|\s*$)/i,
  );
  if (!affordancesMatch) return interpretation;

  const prefix = affordancesMatch[1];
  const body = affordancesMatch[2];

  // Parse each [N] reference in the AFFORDANCES body
  const lines = body.split("\n");
  const correctedLines: string[] = [];
  let correctionsMade = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match lines like "[6] button 'In den Einkaufswagen'"
    const tagRefMatch = trimmed.match(/^\[(\d+)\]\s+(.+)/);
    if (!tagRefMatch) {
      // Non-tagged line (e.g., "None.") — keep as-is
      correctedLines.push(line);
      continue;
    }

    const tagId = parseInt(tagRefMatch[1], 10);
    const vlmDescription = tagRefMatch[2].trim();
    const actualElement = tagMap.get(tagId);

    if (!actualElement) {
      // Tag ID doesn't exist in the element list — strip it
      correctionsMade++;
      continue;
    }

    // Check if the VLM description roughly matches the actual element.
    // Compare tag name and first significant word of text content.
    const actualDesc = `${actualElement.tagName} "${actualElement.text.slice(0, 40)}"`;
    const vlmLower = vlmDescription.toLowerCase();
    const actualTextLower = actualElement.text.toLowerCase().slice(0, 40);
    const actualTagLower = actualElement.tagName.toLowerCase();

    // Heuristic: the VLM description should mention either the actual tag name
    // or at least part of the actual text content. If neither matches, flag it.
    const tagNameMatch =
      vlmLower.includes(actualTagLower) ||
      (actualElement.role &&
        vlmLower.includes(actualElement.role.toLowerCase()));
    const textOverlap =
      actualTextLower.length > 0 &&
      (vlmLower.includes(actualTextLower.slice(0, 15)) ||
        actualTextLower.includes(vlmLower.slice(0, 15)));

    if (!tagNameMatch && !textOverlap && actualTextLower.length > 3) {
      // Significant mismatch — replace with corrected description
      correctedLines.push(`[${tagId}] ${actualDesc}`);
      correctionsMade++;
    } else {
      correctedLines.push(line);
    }
  }

  if (correctionsMade === 0) return interpretation;

  // Rebuild the AFFORDANCES section
  const correctedBody =
    correctedLines.length > 0
      ? correctedLines.join("\n")
      : "None (all VLM references were invalid).";

  logger.warn("perception", "Corrected AFFORDANCES tag IDs", {
    corrections: correctionsMade,
  });

  return interpretation.replace(affordancesMatch[0], prefix + correctedBody);
}

function makeResult(
  base: Omit<
    PerceptionResult,
    "mode" | "source" | "freshnessReason" | "screenshotStatus"
  >,
  meta: PerceptionTraceMeta,
): PerceptionResult {
  return {
    ...base,
    ...meta,
  };
}

function inferFailureMeta(
  interpretation: string,
  screenshotProvided: boolean,
  freshnessReason: TracePerceptionFreshnessReason,
): PerceptionTraceMeta {
  let fallbackReason: TracePerceptionFallbackReason | undefined;
  if (/\[Visual perception timed out\]/i.test(interpretation)) {
    fallbackReason = "timeout";
  } else if (
    /\[Visual perception failed: all providers exhausted\]/i.test(
      interpretation,
    )
  ) {
    fallbackReason = "provider_exhausted";
  } else if (
    /\[Visual perception returned no content\]/i.test(interpretation)
  ) {
    fallbackReason = "empty_response";
  }

  return {
    mode: "structured",
    source: fallbackReason ? "fallback" : "fresh",
    freshnessReason,
    ...(fallbackReason ? { fallbackReason } : {}),
    screenshotStatus: screenshotProvided ? "captured" : "missing",
  };
}

// ---------------------------------------------------------------------------
// PerceptionAgent class
// ---------------------------------------------------------------------------

export class PerceptionAgent {
  // Observation state
  private observationLog: ObservationEntry[] = [];
  private lastFingerprint = "";
  private _lastRenderHash = "";
  private fingerprintAge = 0;
  private _lastScreenshotUrl: string | null = null;
  private _hasRunFirstPerception = false;
  private _turnCounter = 0;
  private _lastInterpretation: string | null = null;
  private _lastObservedUrl = "";
  private _lastTraceMeta: PerceptionTraceMeta = {
    mode: "structured",
    source: "fresh",
    freshnessReason: "new_fingerprint",
    screenshotStatus: "not_requested",
  };
  private _lastTraceStats: PerceptionTraceStats = {
    model: "unknown",
    durationMs: 0,
    cached: false,
  };

  // -------------------------------------------------------------------------
  // Public API — state accessors
  // -------------------------------------------------------------------------

  getInterpretation(): string | null {
    return this._lastInterpretation;
  }

  getLastScreenshot(): string | null {
    return this._lastScreenshotUrl;
  }

  getFingerprint(): string {
    return this.lastFingerprint;
  }

  /** Whether the first perception of this session has already run. */
  get firstPerceptionDone(): boolean {
    return this._hasRunFirstPerception;
  }

  markFirstPerceptionDone(): void {
    this._hasRunFirstPerception = true;
  }

  getLastTraceMeta(): PerceptionTraceMeta {
    return { ...this._lastTraceMeta };
  }

  getLastTraceStats(): PerceptionTraceStats {
    return { ...this._lastTraceStats };
  }

  /** Force next observe() to re-interpret even if fingerprint matches. */
  invalidateCache(): void {
    this.lastFingerprint = "";
    this.fingerprintAge = 0;
  }

  setScreenshotUrl(url: string | null): void {
    this._lastScreenshotUrl = url;
  }

  /**
   * Hydrate from warmup: inject a pre-computed interpretation without a full
   * VLM call. Creates an initial observation entry so subsequent calls see
   * prior context.
   */
  hydrateFromWarmup(
    interpretation: string,
    fingerprint: string,
    screenshotUrl: string | null,
    url?: string,
    stats?: Partial<PerceptionTraceStats>,
  ): void {
    this._lastInterpretation = interpretation;
    this.lastFingerprint = fingerprint;
    this._lastRenderHash = screenshotUrl
      ? hashRenderContent(screenshotUrl)
      : "";
    this._lastScreenshotUrl = screenshotUrl;
    this._lastTraceMeta = {
      mode: interpretation.startsWith("[VL mode]")
        ? "vl_screenshot_only"
        : "structured",
      source: "warmup",
      freshnessReason: "warmup_cache",
      screenshotStatus: screenshotUrl ? "cached" : "not_requested",
    };
    this._lastTraceStats = {
      model:
        stats?.model ??
        (interpretation.startsWith("[VL mode]")
          ? "none (unified VL, warmup)"
          : "warmup perception"),
      ...(stats?.providerId ? { providerId: stats.providerId } : {}),
      durationMs: stats?.durationMs ?? 0,
      cached: stats?.cached ?? true,
    };
    this._turnCounter++;

    // Create initial observation entry from warmup interpretation
    const entry = parseObservation(
      interpretation,
      this._turnCounter,
      url || "",
      fingerprint,
    );
    this.observationLog.push(entry);
  }

  /** Reset all state (new session). */
  reset(): void {
    this.observationLog = [];
    this.lastFingerprint = "";
    this._lastRenderHash = "";
    this.fingerprintAge = 0;
    this._lastScreenshotUrl = null;
    this._hasRunFirstPerception = false;
    this._turnCounter = 0;
    this._lastInterpretation = null;
    this._lastObservedUrl = "";
    this._lastTraceMeta = {
      mode: "structured",
      source: "fresh",
      freshnessReason: "new_fingerprint",
      screenshotStatus: "not_requested",
    };
    this._lastTraceStats = {
      model: "unknown",
      durationMs: 0,
      cached: false,
    };
  }

  /** Serialize state for cross-navigation persistence. */
  getState(): PerceptionState {
    return {
      observationLog: [...this.observationLog],
      lastFingerprint: this.lastFingerprint,
      fingerprintAge: this.fingerprintAge,
      turnCounter: this._turnCounter,
    };
  }

  /** Restore state after navigation resume. */
  restoreState(state: PerceptionState): void {
    this.observationLog = [...state.observationLog];
    this.lastFingerprint = state.lastFingerprint;
    this._lastRenderHash = "";
    this.fingerprintAge = state.fingerprintAge;
    this._turnCounter = state.turnCounter;
  }

  /** Read-only access to observation log. */
  getObservationLog(): readonly ObservationEntry[] {
    return this.observationLog;
  }

  // -------------------------------------------------------------------------
  // Core: observe()
  // -------------------------------------------------------------------------

  /**
   * Run perception: take the screenshot + elements and produce a structured
   * interpretation. Feeds prior observation history into the VLM prompt.
   *
   * @param input Page screenshot, elements, and metadata
   * @param fingerprint Snapshot fingerprint for cache checks
   * @param signal AbortSignal for cancellation
   * @returns PerceptionResult with interpretation and optional observation
   */
  async observe(
    input: ObserveInput,
    fingerprint: string,
    signal?: AbortSignal,
    lastToolName?: string,
  ): Promise<PerceptionResult> {
    // 0. URL-change hard invalidation — a URL change is the strongest signal
    //    that the page state has changed, regardless of fingerprint similarity.
    const urlChanged = input.url !== this._lastObservedUrl;
    this._lastObservedUrl = input.url;
    if (urlChanged && this._lastObservedUrl !== "") {
      this.invalidateCache();
    }

    // 1. Fingerprint cache check
    const staleThreshold = getStaleThreshold(lastToolName);
    const screenshotProvided = input.screenshotDataUrl.length > 0;
    const renderHash = resolveRenderHash(input);
    let freshnessReason: TracePerceptionFreshnessReason = "new_fingerprint";
    if (fingerprint === this.lastFingerprint && this._lastInterpretation) {
      if (renderHash !== this._lastRenderHash) {
        freshnessReason = "render_hash_changed";
        this.fingerprintAge = 0;
        logger.info("perception", "Forced re-interpret after render change", {
          fingerprint,
        });
      } else {
        this.fingerprintAge++;
        if (this.fingerprintAge < staleThreshold) {
          const meta: PerceptionTraceMeta = {
            ...this._lastTraceMeta,
            source: "cached",
            freshnessReason: "fingerprint_cache_hit",
          };
          const stats: PerceptionTraceStats = {
            ...this._lastTraceStats,
            durationMs: 0,
            cached: true,
          };
          this._lastTraceMeta = meta;
          this._lastTraceStats = stats;
          return makeResult(
            {
              interpretation: this._lastInterpretation,
              ...stats,
            },
            meta,
          );
        }
        freshnessReason = "stale_fingerprint";
        logger.info(
          "perception",
          "Forced re-interpret after stale fingerprint",
          {
            age: this.fingerprintAge,
          },
        );
      }
    } else {
      this.fingerprintAge = 0;
    }

    // 2. Near-empty DOM fallback (≤3 elements)
    if (!screenshotProvided) {
      const interpretation = this.buildElementOnlyFallback(
        input,
        "Screenshot unavailable - using DOM-only grounding.",
      );
      const meta: PerceptionTraceMeta = {
        mode: "element_only",
        source: "fallback",
        freshnessReason,
        fallbackReason: "screenshot_unavailable",
        screenshotStatus: "missing",
      };
      this._lastInterpretation = interpretation;
      this.lastFingerprint = fingerprint;
      this._lastRenderHash = renderHash;
      this._lastScreenshotUrl = null;
      this._lastTraceMeta = meta;
      this._lastTraceStats = {
        model: "dom-fallback",
        durationMs: 0,
        cached: false,
      };
      return makeResult(
        {
          interpretation,
          ...this._lastTraceStats,
        },
        meta,
      );
    }
    this._lastRenderHash = renderHash;
    this._lastScreenshotUrl = input.screenshotDataUrl;

    // 3. Get API key
    const settings = (await loadSettings()) ?? ({} as UserSettings);
    const providers = buildProviders(settings);

    if (providers.length === 0) {
      const interpretation =
        "[No API key — visual perception unavailable. Agent relies on element list only.]";
      this._lastInterpretation = interpretation;
      const meta: PerceptionTraceMeta = {
        mode: "element_only",
        source: "fallback",
        freshnessReason,
        fallbackReason: "no_api_key",
        screenshotStatus: screenshotProvided ? "captured" : "missing",
      };
      this.lastFingerprint = fingerprint;
      this._lastRenderHash = renderHash;
      this._lastTraceMeta = meta;
      this._lastTraceStats = {
        model: "none (no API key)",
        durationMs: 0,
        cached: false,
      };
      return makeResult(
        {
          interpretation,
          ...this._lastTraceStats,
        },
        meta,
      );
    }

    // 4. Build prompt with prior observations
    this._turnCounter++;
    const promptText = this.buildSharedPrompt(input);

    // 5. Call VLM
    const callStart = Date.now();
    const result = await this.callVLM(
      providers,
      promptText,
      input.screenshotDataUrl,
      freshnessReason,
      callStart,
      signal,
    );

    // 6. Validate AFFORDANCES tag IDs against actual elements
    if (result.interpretation && !result.interpretation.startsWith("[")) {
      result.interpretation = validatePerceptionTagIds(
        result.interpretation,
        input.elements,
      );
    }

    // 7. Parse observation and update state
    if (result.interpretation && !result.interpretation.startsWith("[")) {
      const entry = parseObservation(
        result.interpretation,
        this._turnCounter,
        input.url,
        fingerprint,
      );
      this.observationLog.push(entry);
      result.observation = entry;
    }

    this._lastInterpretation = result.interpretation;
    this.lastFingerprint = fingerprint;
    this._lastRenderHash = renderHash;
    this._lastTraceMeta = {
      mode: result.mode,
      source: result.source,
      freshnessReason: result.freshnessReason,
      ...(result.fallbackReason
        ? { fallbackReason: result.fallbackReason }
        : {}),
      screenshotStatus: result.screenshotStatus,
    };
    this._lastTraceStats = {
      model: result.model,
      ...(result.providerId ? { providerId: result.providerId } : {}),
      durationMs: result.durationMs,
      cached: result.cached,
    };

    return result;
  }

  // -------------------------------------------------------------------------
  // Internal: prompt building
  // -------------------------------------------------------------------------

  private buildSharedPrompt(input: ObserveInput): string {
    return buildProductionPerceptionPrompt(input, {
      priorObservations: formatPriorObservations(this.observationLog),
      isFirstObservation: this.observationLog.length === 0,
    });
  }

  private buildPrompt(input: ObserveInput): string {
    const scrollPct =
      input.scroll.maxY > 0
        ? Math.round((input.scroll.y / input.scroll.maxY) * 100)
        : 0;
    const moreBelow = input.scroll.y < input.scroll.maxY - 10;

    const priorObservations = formatPriorObservations(this.observationLog);
    const viewport = input.scroll.viewportHeight
      ? { height: input.scroll.viewportHeight, scrollY: input.scroll.y }
      : undefined;
    const elementSummary = buildElementSummary(
      input.elements,
      input.skeleton,
      viewport,
    );

    // Build changes hint for first turn
    const changesHint =
      this.observationLog.length === 0
        ? "\n(First observation — describe the current page layout and state instead of changes.)"
        : "";

    // Language context for cross-lingual grounding
    const langNote = input.lang
      ? `Page language: ${input.lang}. Element text and labels are in ${input.lang}. Match [tagId] by checking the element list, not by guessing from the screenshot.\n`
      : "";

    return renderPrompt("perception.interpret_page", {
      priorObservations,
      title: input.title || "Unknown",
      url: input.url || "Unknown",
      langNote,
      scrollPosition: `${input.scroll.y}/${input.scroll.maxY}px (${scrollPct}%)${moreBelow ? " — more content below" : ""}`,
      elementSummary,
      changesHint,
    });
  }

  private buildNearEmptyFallback(input: ObserveInput): string {
    const elemDescs = input.elements.map(
      (el) => `[${el.tag}] ${el.tagName} "${el.text.slice(0, 60)}"`,
    );
    return [
      `1. LOCATION: ${input.title || "Unknown"} (${input.url || "Unknown"})`,
      `2. CHANGES: Mostly empty page — only ${input.elements.length} interactive element(s). Page may have failed to load.`,
      `3. BLOCKERS: None visible.`,
      `4. VISUAL-ONLY: None.`,
      elemDescs.length > 0
        ? `5. AFFORDANCES: ${elemDescs.join("; ")}`
        : `5. AFFORDANCES: None.`,
    ].join("\n");
  }

  private buildElementOnlyFallback(
    input: ObserveInput,
    blockerText: string,
  ): string {
    const elemDescs = input.elements
      .slice(0, 10)
      .map((el) => `[${el.tag}] ${el.tagName} "${el.text.slice(0, 60)}"`);
    return [
      `1. LOCATION: ${input.title || "Unknown"} (${input.url || "Unknown"})`,
      `2. CHANGES: Visual state unavailable - relying on the live element list only.`,
      `3. BLOCKERS: ${blockerText}`,
      `4. VISUAL-ONLY: Screenshot unavailable.`,
      elemDescs.length > 0
        ? `5. AFFORDANCES: ${elemDescs.join("; ")}`
        : `5. AFFORDANCES: None.`,
    ].join("\n");
  }

  // -------------------------------------------------------------------------
  // Internal: VLM call (same retry/failover as perceive())
  // -------------------------------------------------------------------------

  private async callVLM(
    providers: PerceptionProvider[],
    promptText: string,
    screenshotDataUrl: string,
    freshnessReason: TracePerceptionFreshnessReason,
    callStart: number,
    signal?: AbortSignal,
  ): Promise<PerceptionResult> {
    for (let pi = 0; pi < providers.length; pi++) {
      const provider = providers[pi];

      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        if (attempt > 1) {
          const delay =
            BASE_DELAY_MS * Math.pow(2, attempt - 2) +
            Math.floor(Math.random() * 200);
          logger.info(
            "perception",
            `Retrying ${provider.providerId} (${attempt}/${MAX_RETRIES + 1})`,
            { delay },
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        try {
          const fetchSignal = signal
            ? AbortSignal.any([
                signal,
                AbortSignal.timeout(PERCEPTION_TIMEOUT_MS),
              ])
            : AbortSignal.timeout(PERCEPTION_TIMEOUT_MS);

          // Build content parts: text + primary screenshot
          const contentParts: Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string } }
          > = [
            { type: "text", text: promptText },
            { type: "image_url", image_url: { url: screenshotDataUrl } },
          ];

          const payload: Record<string, unknown> = {
            model: provider.model,
            messages: [{ role: "user", content: contentParts }],
          };
          if (provider.providerId === "moonshot") {
            payload.max_completion_tokens = 600;
            payload.thinking = { type: "disabled" };
          } else {
            payload.max_tokens = 600;
            payload.temperature = 0.1;
          }

          const response = await fetch(provider.baseUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.apiKey}`,
              ...provider.headers,
            },
            body: JSON.stringify(payload),
            signal: fetchSignal,
          });

          if (!response.ok) {
            const body = await response.text();

            if (response.status === 429) {
              logger.warn("perception", "Rate limited, trying next provider", {
                provider: provider.providerId,
              });
              break;
            }
            if (
              response.status >= 400 &&
              response.status < 500 &&
              response.status !== 429
            ) {
              logger.error("perception", "Non-retryable error", {
                provider: provider.providerId,
                status: response.status,
                body,
              });
              break;
            }

            throw new Error(`Perception API error ${response.status}: ${body}`);
          }

          const json = await response.json();
          const text = json.choices?.[0]?.message?.content;

          if (!text) {
            logger.warn("perception", "Model returned empty content", {
              provider: provider.providerId,
            });
            return makeResult(
              {
                interpretation: "[Visual perception returned no content]",
                model: provider.model,
                providerId: provider.providerId,
                durationMs: Date.now() - callStart,
                cached: false,
              },
              inferFailureMeta(
                "[Visual perception returned no content]",
                screenshotDataUrl.length > 0,
                freshnessReason,
              ),
            );
          }

          const cleaned = stripThinkTags(text);

          const usage: TokenUsage | undefined = json.usage
            ? {
                prompt_tokens: json.usage.prompt_tokens ?? 0,
                completion_tokens: json.usage.completion_tokens ?? 0,
                total_tokens: json.usage.total_tokens ?? 0,
                cost: json.usage.cost,
              }
            : undefined;

          logger.info("perception", "Page interpreted", {
            provider: provider.providerId,
            model: provider.model,
            length: cleaned.length,
            durationMs: Date.now() - callStart,
            turnCounter: this._turnCounter,
            observationLogSize: this.observationLog.length,
          });

          return makeResult(
            {
              interpretation: cleaned,
              usage,
              model: provider.model,
              providerId: provider.providerId,
              durationMs: Date.now() - callStart,
              cached: false,
            },
            {
              mode: "structured",
              source: "fresh",
              freshnessReason,
              screenshotStatus:
                screenshotDataUrl.length > 0 ? "captured" : "missing",
            },
          );
        } catch (error: any) {
          if (error.name === "AbortError" || error.name === "TimeoutError") {
            logger.warn("perception", "Aborted or timed out", {
              provider: provider.providerId,
              error: error.message,
            });
            return makeResult(
              {
                interpretation: "[Visual perception timed out]",
                model: provider.model,
                providerId: provider.providerId,
                durationMs: Date.now() - callStart,
                cached: false,
              },
              inferFailureMeta(
                "[Visual perception timed out]",
                screenshotDataUrl.length > 0,
                freshnessReason,
              ),
            );
          }
          logger.warn(
            "perception",
            `${provider.providerId} attempt ${attempt} failed`,
            { error: error.message },
          );
          if (attempt >= MAX_RETRIES + 1) break;
        }
      }

      if (pi < providers.length - 1) {
        logger.info("perception", "Falling back to next provider", {
          from: provider.providerId,
          to: providers[pi + 1].providerId,
        });
      }
    }

    logger.error("perception", "All providers failed");
    return makeResult(
      {
        interpretation: "[Visual perception failed: all providers exhausted]",
        model: providers[providers.length - 1].model,
        providerId: providers[providers.length - 1].providerId,
        durationMs: Date.now() - callStart,
        cached: false,
      },
      inferFailureMeta(
        "[Visual perception failed: all providers exhausted]",
        screenshotDataUrl.length > 0,
        freshnessReason,
      ),
    );
  }
}
