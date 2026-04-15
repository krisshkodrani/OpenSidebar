export type ResearchMode = "local" | "external";
export type NoteStatus = "success" | "partial" | "failed";

export interface NoteAssessment {
  status: NoteStatus;
  reason: string;
  normalized: string;
  wordCount: number;
  nonEmptyLineCount: number;
}

const META_PATTERNS = [
  /^session_id:\s*\S+$/i,
  /^api call failed after \d+ retries/i,
  /^i(?:'| a)?ll first\b/i,
  /^i will first\b/i,
  /^let me first\b/i,
  /^first,? i(?:'| a)?ll\b/i,
  /^to start,? i(?:'| a)?ll\b/i,
  /^i(?:'| a)?m going to first\b/i,
];

export function normalizeNoteName(input: string): string {
  const trimmed = input.trim();
  const withExt = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  return [...withExt]
    .map((char) => {
      const code = char.charCodeAt(0);
      if ('<>:"/\\|?*'.includes(char) || code < 32) return "-";
      return char;
    })
    .join("");
}

export function normalizeNoteText(content: string): string {
  return content
    .replaceAll("ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢", "->")
    .replaceAll("ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â", "--")
    .replaceAll("ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ", "-")
    .replaceAll("ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢", "-")
    .replace(/./gms, (char) => {
      const code = char.charCodeAt(0);
      const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
      const isPrintableAscii = code >= 32 && code <= 126;
      return isAllowedWhitespace || isPrintableAscii ? char : " ";
    })
    .replace(/[ ]{2,}/g, " ")
    .replace(/ \n/g, "\n")
    .trim();
}

export function extractNoteContent(output: string): string {
  const cleaned = output
    .replace(/^session_id:\s*[^\n]+\s*$/im, "")
    .replace(/\n+session_id:\s*[^\n]+$/i, "")
    .trim();
  return cleaned;
}

export function extractAssistantNoteFromSession(rawSession: string): string {
  try {
    const session = JSON.parse(rawSession) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const messages = Array.isArray(session.messages) ? session.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === "assistant" && typeof message.content === "string") {
        return message.content.trim();
      }
    }
  } catch {
    return "";
  }

  return "";
}

export function assessNoteContent(
  content: string,
  options: { forSave?: boolean } = {},
): NoteAssessment {
  const normalized = normalizeNoteText(content);
  const nonEmptyLines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const wordCount = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
  const hasStructure =
    /^#\s/m.test(normalized) ||
    /^[-*]\s/m.test(normalized) ||
    /^\d+\.\s/m.test(normalized) ||
    /\|\s*[-:]+\s*\|/.test(normalized);
  const hasSentenceSignal = /[.!?]/.test(normalized);

  if (!normalized) {
    return failure("empty_output", normalized, wordCount, nonEmptyLines.length);
  }

  if (!/[A-Za-z]/.test(normalized)) {
    return failure("no_alpha_content", normalized, wordCount, nonEmptyLines.length);
  }

  if (META_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return failure("meta_or_placeholder_output", normalized, wordCount, nonEmptyLines.length);
  }

  if (wordCount < 20) {
    return failure("too_short", normalized, wordCount, nonEmptyLines.length);
  }

  if (!options.forSave) {
    return success("usable_stdout", normalized, wordCount, nonEmptyLines.length);
  }

  if (wordCount < 45) {
    return partial("insufficient_substance_for_saved_note", normalized, wordCount, nonEmptyLines.length);
  }

  if (!hasStructure && nonEmptyLines.length < 3 && !hasSentenceSignal) {
    return partial("missing_note_structure", normalized, wordCount, nonEmptyLines.length);
  }

  return success("save_ready", normalized, wordCount, nonEmptyLines.length);
}

export function buildResearchPrompt(input: {
  mode: ResearchMode;
  query: string;
  saveInstruction: string;
  contextBundle: string;
}): string {
  const modeInstructions =
    input.mode === "external"
      ? [
          "You are the OpenSidebar lab research assistant.",
          "You may use your normal research capabilities, including external sources and tools if available.",
          "Treat the local context bundle as project background, not as the only allowable source.",
          "If you rely on external facts, name the sources explicitly in the note.",
          "Keep conclusions concrete and tied to harness design, workflow skills, E2E behavior, or agent architecture.",
        ]
      : [
          "You are the OpenSidebar lab research assistant.",
          "Answer only from the provided local context bundle.",
          "Do not use tools. Do not browse. Do not try to edit files.",
          "Keep conclusions concrete and tied to harness design, workflow skills, E2E behavior, or agent architecture.",
        ];

  return [
    ...modeInstructions,
    input.saveInstruction,
    `Research task: ${input.query}`,
    "",
    input.contextBundle,
  ].join("\n");
}

export function buildSavedNote(content: string, queryText: string, mode: ResearchMode): string {
  const trimmed = content.replace(/\n---\s*$/m, "").trimEnd();
  const body = trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  return `${body}\n---\nGenerated by \`npm run lab:research\` on ${new Date().toISOString()}.\nMode: ${mode}\nQuery: ${queryText}\n`;
}

export function buildFailedResearchArtifact(input: {
  query: string;
  mode: ResearchMode;
  assessment: NoteAssessment;
  rawStdout: string;
}): string {
  return [
    "# Failed Research Note",
    "",
    `- Status: ${input.assessment.status}`,
    `- Reason: ${input.assessment.reason}`,
    `- Mode: ${input.mode}`,
    `- Query: ${input.query}`,
    `- Word count: ${input.assessment.wordCount}`,
    `- Non-empty lines: ${input.assessment.nonEmptyLineCount}`,
    "",
    "## Raw Output",
    "",
    "```text",
    input.rawStdout.trim() || "[empty]",
    "```",
    "",
  ].join("\n");
}

export function buildResearchModelConfig(input: {
  hasFireworks: boolean;
  hasOpenAi: boolean;
  hasOpenRouter: boolean;
}): { configText: string; allowOpenRouterFallback: boolean; providerLabel: string } {
  if (input.hasFireworks) {
    return {
      configText: [
        "model:",
        '  provider: custom',
        '  default: accounts/fireworks/routers/kimi-k2p5-turbo',
        '  base_url: https://api.fireworks.ai/inference/v1',
        '  api_key: ${FIREWORKS_API_KEY}',
        '  api_mode: chat_completions',
        "  max_tokens: 1024",
      ].join("\n"),
      allowOpenRouterFallback: false,
      providerLabel: "fireworks-kimi",
    };
  }

  if (input.hasOpenAi) {
    return {
      configText: [
        "model:",
        '  provider: openai',
        '  default: gpt-5.4-mini',
        "  max_tokens: 1024",
      ].join("\n"),
      allowOpenRouterFallback: false,
      providerLabel: "openai-gpt-5.4-mini",
    };
  }

  return {
    configText: [
      "model:",
      '  provider: openrouter',
      '  default: google/gemini-2.5-flash',
      "  max_tokens: 1024",
    ].join("\n"),
    allowOpenRouterFallback: input.hasOpenRouter,
    providerLabel: "openrouter-gemini-2.5-flash",
  };
}

function success(
  reason: string,
  normalized: string,
  wordCount: number,
  nonEmptyLineCount: number,
): NoteAssessment {
  return { status: "success", reason, normalized, wordCount, nonEmptyLineCount };
}

function partial(
  reason: string,
  normalized: string,
  wordCount: number,
  nonEmptyLineCount: number,
): NoteAssessment {
  return { status: "partial", reason, normalized, wordCount, nonEmptyLineCount };
}

function failure(
  reason: string,
  normalized: string,
  wordCount: number,
  nonEmptyLineCount: number,
): NoteAssessment {
  return { status: "failed", reason, normalized, wordCount, nonEmptyLineCount };
}
