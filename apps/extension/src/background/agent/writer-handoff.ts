/**
 * Writer handoff — the bounded, synchronous delegation from the executor loop to
 * the optional Writer specialist. Distills a compact writing brief (field
 * question + constraints + candidate background + task framing + prior answers),
 * makes a one-shot `composeText` call against the writer pool, then enters the
 * prose into the target field via the normal type_text path.
 *
 * Kept out of loop.ts per the repo's "prefer small policy modules" convention.
 */
import { TaggedElement, ToolName } from "../../types";
import {
  buildPersonalProfilePlannerContext,
  loadPersonalizationState,
} from "../../utils/personal-profile";
import { WRITER_SYSTEM_PROMPT } from "./writer-prompt";
import type { AgentLoopToolHandlerHost } from "./loop-tool-handlers";

const QUESTION_PREVIEW_LIMIT = 80;
const RESULT_PREVIEW_LIMIT = 160;
/** Below this, a type_text into a free-text field isn't worth a writer handoff. */
export const WRITER_GUARD_MIN_PROSE_CHARS = 60;

export interface WriterHandoffArgs {
  id: number;
  instructions?: string;
  context?: string;
  tone?: string;
  maxWords?: number;
  /** Executor's own draft, when the guard reroutes a type_text — used as material, not as the answer. */
  executorDraft?: string;
}

interface WriterAnswerRecord {
  question: string;
  answer: string;
}

// Per-run memory of composed answers, keyed by the loop instance, so multi-question
// forms stay coherent. Auto-GCs when the loop is collected.
const writerMemory = new WeakMap<object, WriterAnswerRecord[]>();

function getWriterAnswers(host: object): WriterAnswerRecord[] {
  let list = writerMemory.get(host);
  if (!list) {
    list = [];
    writerMemory.set(host, list);
  }
  return list;
}

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function findElement(
  host: AgentLoopToolHandlerHost,
  fieldId: number,
): TaggedElement | null {
  const snapshot = host.context?.getSnapshot?.();
  if (!snapshot?.elements) return null;
  return (
    snapshot.elements.find((el: TaggedElement) => el.tag === fieldId) ?? null
  );
}

/** Best-effort question/label for a field from its tagged attributes + text. */
function deriveQuestion(el: TaggedElement | null): string {
  if (!el) return "";
  const a = el.attributes ?? {};
  return (
    a.label ||
    a["aria-label"] ||
    a.placeholder ||
    a.name ||
    el.text ||
    ""
  ).trim();
}

/** Field character limit, if the snapshot captured one. */
function deriveMaxLength(el: TaggedElement | null): number | null {
  if (!el) return null;
  const raw = el.attributes?.maxlength ?? el.attributes?.maxLength;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Whether a field is in the writer's scope: free-text / prose, not a short structured input. */
export function isFreeTextField(el: TaggedElement | null): boolean {
  if (!el) return false;
  if (el.tagName === "textarea") return true;
  const a = el.attributes ?? {};
  if (a.contenteditable && a.contenteditable !== "false") return true;
  if (el.role === "textbox" && a["aria-multiline"] === "true") return true;
  return false;
}

/** Whether typed text looks like authored prose worth delegating to the writer. */
export function isAuthoredProse(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const clean = text.trim();
  if (clean.length < WRITER_GUARD_MIN_PROSE_CHARS) return false;
  return /\s/.test(clean); // multi-word
}

function buildWritingBrief(
  host: AgentLoopToolHandlerHost,
  el: TaggedElement | null,
  args: WriterHandoffArgs,
): { prompt: string; question: string; maxLength: number | null } {
  const question = deriveQuestion(el);
  const maxLength = deriveMaxLength(el);
  const prior = getWriterAnswers(host as object);

  const sections: string[] = [];
  sections.push(`TASK: ${host.originalQuery || "(not provided)"}`);
  if (question) sections.push(`FIELD / QUESTION: ${question}`);
  if (args.instructions) sections.push(`WHAT TO WRITE: ${args.instructions}`);
  if (args.context) sections.push(`SOURCE MATERIAL:\n${args.context}`);
  if (args.tone) sections.push(`TONE: ${args.tone}`);

  const limitParts: string[] = [];
  if (args.maxWords && args.maxWords > 0)
    limitParts.push(`about ${args.maxWords} words max`);
  if (maxLength) limitParts.push(`${maxLength} characters max (hard limit)`);
  if (limitParts.length) sections.push(`LENGTH: ${limitParts.join("; ")}`);

  if (args.executorDraft) {
    sections.push(
      `ROUGH DRAFT (improve or replace — do not just copy):\n${args.executorDraft}`,
    );
  }

  if (prior.length) {
    sections.push(
      [
        "ANSWERS ALREADY GIVEN ON THIS FORM (stay consistent, don't repeat verbatim):",
        ...prior.map(
          (p) => `- Q: ${truncate(p.question, 60)}\n  A: ${truncate(p.answer, 200)}`,
        ),
      ].join("\n"),
    );
  }

  return { prompt: sections.join("\n\n"), question, maxLength };
}

function estimateMaxTokens(args: WriterHandoffArgs, maxLength: number | null): number {
  if (args.maxWords && args.maxWords > 0)
    return Math.min(2048, Math.ceil(args.maxWords * 1.6) + 64);
  if (maxLength) return Math.min(2048, Math.ceil(maxLength / 3) + 64);
  return 1024;
}

async function withProfileBackground(
  host: AgentLoopToolHandlerHost,
  brief: { prompt: string; question: string; maxLength: number | null },
  args: WriterHandoffArgs,
): Promise<string> {
  try {
    const state = await loadPersonalizationState();
    const relevanceQuery = [host.originalQuery, brief.question, args.instructions]
      .filter(Boolean)
      .join(" ");
    const profileContext = buildPersonalProfilePlannerContext(
      relevanceQuery,
      state,
    );
    if (profileContext) {
      return `${brief.prompt}\n\nCANDIDATE BACKGROUND:\n${profileContext}`;
    }
  } catch {
    // Profile is optional — compose without it on any failure.
  }
  return brief.prompt;
}

/**
 * Compose prose via the Writer and enter it into the target field. Returns the
 * tool-result string to hand back to the executor. Falls back to instructing the
 * executor to write it itself if composition fails.
 */
export async function runWriterHandoff(
  host: AgentLoopToolHandlerHost,
  tabId: number,
  args: WriterHandoffArgs,
): Promise<string> {
  const fieldId = args.id;
  const el = findElement(host, fieldId);
  const brief = buildWritingBrief(host, el, args);
  const userPrompt = await withProfileBackground(host, brief, args);
  const maxTokens = estimateMaxTokens(args, brief.maxLength);

  let composed: { text: string; model: string; providerId: string };
  try {
    composed = await host.llm.composeText({
      systemPrompt: WRITER_SYSTEM_PROMPT,
      userPrompt,
      maxTokens,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    host.log?.warn?.("agent", "Writer composition failed", { fieldId, error: msg });
    return `Writer unavailable (${msg}). Compose the answer yourself and use type_text for field [${fieldId}].`;
  }

  let text = composed.text;
  if (!text) {
    return `Writer returned no text for field [${fieldId}]. Compose the answer yourself and use type_text.`;
  }

  // Overflow: re-ask once with a hard limit, then truncate as a last resort.
  if (brief.maxLength && text.length > brief.maxLength) {
    try {
      const retry = await host.llm.composeText({
        systemPrompt: WRITER_SYSTEM_PROMPT,
        userPrompt: `${userPrompt}\n\nHARD LIMIT: keep the answer under ${brief.maxLength} characters.`,
        maxTokens,
      });
      if (retry.text) text = retry.text;
    } catch {
      // keep original; truncation below handles it
    }
    if (text.length > brief.maxLength) text = text.slice(0, brief.maxLength);
  }

  // Place the prose using the normal type_text path (handles controlled inputs).
  let typeResult = "";
  try {
    typeResult = await host.executeToolCall(
      {
        id: crypto.randomUUID(),
        type: "function",
        function: {
          name: ToolName.TYPE_TEXT,
          arguments: JSON.stringify({ id: fieldId, text }),
        },
      },
      tabId,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Writer composed ${text.length} chars but entering them into field [${fieldId}] failed (${msg}). Use type_text with this text:\n${text}`;
  }

  getWriterAnswers(host as object).push({ question: brief.question, answer: text });

  host.traceRecorder?.recordEvent?.("writer_handoff", {
    turn: host.turnCount,
    field: fieldId,
    question: truncate(brief.question, QUESTION_PREVIEW_LIMIT),
    model: composed.model,
    providerId: composed.providerId,
    chars: text.length,
  });

  host.stepHandler(
    {
      id: crypto.randomUUID(),
      type: "info",
      label: brief.question
        ? `Writer composed answer for "${truncate(brief.question, QUESTION_PREVIEW_LIMIT)}"`
        : `Writer composed ${text.length} chars for field [${fieldId}]`,
      status: "done",
      timestamp: Date.now(),
    },
    false,
  );

  const typeNote = /^error/i.test(typeResult.trim())
    ? ` (placement note: ${truncate(typeResult, 120)})`
    : "";
  return (
    `Writer composed ${text.length} chars and entered them into field [${fieldId}]` +
    `${composed.model ? ` (model: ${composed.model})` : ""}. ` +
    `Field now contains: "${truncate(text, RESULT_PREVIEW_LIMIT)}". ` +
    `Do NOT retype this field — proceed to the next field or step.${typeNote}`
  );
}
