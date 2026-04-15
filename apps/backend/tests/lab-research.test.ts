import { describe, expect, test } from "vitest";
import {
  assessNoteContent,
  buildResearchModelConfig,
  buildResearchPrompt,
  extractAssistantNoteFromSession,
  extractNoteContent,
} from "../../../lab/bin/research-helpers";

describe("lab research helpers", () => {
  test("rejects placeholder stdout as failed output", () => {
    const extracted = extractNoteContent(
      "I'll first check the existing research file on this topic to build upon prior work.",
    );
    const assessment = assessNoteContent(extracted, { forSave: true });

    expect(assessment.status).toBe("failed");
    expect(assessment.reason).toBe("meta_or_placeholder_output");
  });

  test("marks very short saved notes as partial instead of success", () => {
    const note = [
      "# Note",
      "",
      "This is a real answer with some substance but still too short to be a durable research artifact.",
    ].join("\n");
    const assessment = assessNoteContent(note, { forSave: true });

    expect(assessment.status).toBe("partial");
    expect(assessment.reason).toBe("insufficient_substance_for_saved_note");
  });

  test("accepts substantive saved research notes", () => {
    const note = [
      "# Research Note",
      "",
      "## Findings",
      "",
      "- The browser path is the primary path when no admin API exists.",
      "- Verification must confirm the resulting member list state, not just a closed modal.",
      "- Billing-sensitive actions need explicit approval before execution.",
      "",
      "## Recommendation",
      "",
      "OpenSidebar should model this as a workflow skill with act-check-act discipline and explicit completion criteria.",
    ].join("\n");
    const assessment = assessNoteContent(note, { forSave: true });

    expect(assessment.status).toBe("success");
    expect(assessment.reason).toBe("save_ready");
  });

  test("extracts the latest assistant message from a Hermes session file", () => {
    const rawSession = JSON.stringify({
      messages: [
        { role: "user", content: "question" },
        { role: "assistant", content: "first answer" },
        { role: "assistant", content: "# Final\n\nSubstantive answer" },
      ],
    });

    expect(extractAssistantNoteFromSession(rawSession)).toBe("# Final\n\nSubstantive answer");
  });

  test("uses an actual OpenAI provider config when only OPENAI_API_KEY is present", () => {
    const config = buildResearchModelConfig({
      hasFireworks: false,
      hasOpenAi: true,
      hasOpenRouter: false,
    });

    expect(config.providerLabel).toBe("openai-gpt-5.4-mini");
    expect(config.configText).toContain("provider: openai");
    expect(config.configText).toContain("default: gpt-5.4-mini");
    expect(config.configText).not.toContain("FIREWORKS_API_KEY");
  });

  test("builds different prompts for local and external research modes", () => {
    const localPrompt = buildResearchPrompt({
      mode: "local",
      query: "Summarize the current lab setup.",
      saveInstruction: "Save the note.",
      contextBundle: "## Context\nlocal facts",
    });
    const externalPrompt = buildResearchPrompt({
      mode: "external",
      query: "Find the current state of the art.",
      saveInstruction: "Save the note.",
      contextBundle: "## Context\nlocal facts",
    });

    expect(localPrompt).toContain("Answer only from the provided local context bundle.");
    expect(localPrompt).toContain("Do not use tools. Do not browse.");
    expect(externalPrompt).toContain("You may use your normal research capabilities");
    expect(externalPrompt).toContain("name the sources explicitly");
  });
});
