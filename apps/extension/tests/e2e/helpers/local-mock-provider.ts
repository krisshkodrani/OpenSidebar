import type { CDPSession } from "puppeteer";

export type LocalMockProviderScenarioName =
  | "login"
  | "navigation"
  | "quiz-derailment"
  | "done-draft-read-element"
  | "done-draft-premature-recovery"
  | "done-form-submit-gating"
  | "done-summary-incomplete-recovery"
  | "partial-handoff-max-turns"
  | "watch-restock";

export interface LocalMockProviderScenario {
  fixture: string;
  label: string;
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
}

interface ToolCallSpec {
  name: string;
  args: Record<string, unknown>;
}

interface LocalMockProviderState {
  loginSubmitReturned: boolean;
  navigationCodeSubmitReturned: boolean;
  quizCorrectSelectionsReturned: boolean;
  quizReadsAfterSelection: number;
  draftPrematureDoneReturned: boolean;
  draftTypedReturned: boolean;
  draftReadReturned: boolean;
  formFilledReturned: boolean;
  formPrematureDoneReturned: boolean;
  formSubmittedReturned: boolean;
  summaryReadReturned: boolean;
  summaryIncompleteDoneReturned: boolean;
  partialHandoffReadReturned: boolean;
}

export const localMockProviderScenarios: Record<
  LocalMockProviderScenarioName,
  LocalMockProviderScenario
> = {
  login: {
    fixture: "login",
    label: "local-mock-login-ux-rfc-post",
    prompt:
      "Log in with email admin@example.com and password secret123. Check the Remember me box too.",
    maxTurns: 12,
    timeoutMs: 180_000,
  },
  navigation: {
    fixture: "navigation",
    label: "local-mock-navigation-ux-rfc-post",
    prompt: "Can you complete this challenge for me?",
    maxTurns: 12,
    timeoutMs: 180_000,
  },
  "quiz-derailment": {
    fixture: "quiz-derailment",
    label: "completion-done-quiz-derailment",
    prompt: "Answer the quiz question on this page — pick whatever's correct.",
    maxTurns: 12,
    timeoutMs: 180_000,
  },
  "done-draft-read-element": {
    fixture: "messaging-thread",
    label: "completion-done-draft-read-element",
    prompt:
      "Type a German apology message in the composer: draft explaining sorry for not answering sooner and currently looking for a job in your profession. Do NOT send, leave for user review.",
    maxTurns: 10,
    timeoutMs: 180_000,
  },
  "done-draft-premature-recovery": {
    fixture: "messaging-thread",
    label: "completion-done-draft-premature-recovery",
    prompt:
      "Draft a German apology message in the composer explaining sorry for not answering sooner and currently looking for a job in your profession. Do not send it; leave it for review.",
    maxTurns: 12,
    timeoutMs: 180_000,
  },
  "done-form-submit-gating": {
    fixture: "partner-registration",
    label: "completion-done-form-submit-gating",
    prompt:
      "Submit the partner registration for Sam Rivera at Northstar Analytics with email sam.rivera@example.com, phone +1 415 555 0134, role Partnerships Lead, team Alliances, invite code PN-4821, and accept the partner terms.",
    maxTurns: 14,
    timeoutMs: 180_000,
  },
  "done-summary-incomplete-recovery": {
    fixture: "summarize",
    label: "completion-done-summary-incomplete-recovery",
    prompt: "Read this page and summarize the main points.",
    maxTurns: 8,
    timeoutMs: 180_000,
  },
  "partial-handoff-max-turns": {
    fixture: "summarize",
    label: "completion-partial-handoff-max-turns",
    prompt:
      "Read this page, gather the main facts, and prepare a final summary with any remaining open questions.",
    maxTurns: 2,
    timeoutMs: 180_000,
  },
  // Watch Mode (passive monitor) — the monitor evaluates the page, not the agent
  // loop, so this scenario's prompt/maxTurns are unused; the watch-mode e2e drives
  // the passive monitor directly. Kept here so the interceptor has a valid name
  // and the recorded clip gets a stable label.
  "watch-restock": {
    fixture: "watch/restock.html",
    label: "watch-restock",
    prompt: "Tell me when the Nimbus Running Shoe is back in stock.",
    maxTurns: 1,
    timeoutMs: 60_000,
  },
};

function flattenMessageContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("\n");
}

function flattenPayloadText(payload: any): string {
  return (payload.messages ?? [])
    .map((message: any) => flattenMessageContent(message.content))
    .join("\n\n");
}

function makeUsage() {
  return {
    prompt_tokens: 10,
    completion_tokens: 10,
    total_tokens: 20,
  };
}

function sseChunk(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function sseContent(content: string): string {
  return [
    sseChunk({ choices: [{ delta: { content } }] }),
    sseChunk({ choices: [{ delta: {} }], usage: makeUsage() }),
    "data: [DONE]\n\n",
  ].join("");
}

function sseToolCalls(calls: ToolCallSpec[]): string {
  const toolCalls = calls.map((call, index) => ({
    index,
    id: `call_${index}_${Math.random().toString(36).slice(2)}`,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.args),
    },
  }));
  return [
    sseChunk({ choices: [{ delta: { tool_calls: toolCalls } }] }),
    sseChunk({ choices: [{ delta: {} }], usage: makeUsage() }),
    "data: [DONE]\n\n",
  ].join("");
}

function jsonContent(content: string): string {
  return JSON.stringify({
    choices: [
      {
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: makeUsage(),
  });
}

// Deterministic passive Watch Mode verdict. Posts a suggestion only once the
// fixture has flipped to in-stock; the initial out-of-stock observation returns
// shouldPost:false, matching the "report only meaningful change" contract.
function passiveWatchJson(text: string): string {
  const inStock = /\bin stock\b|back in stock/i.test(text) && !/out of stock/i.test(text);
  if (!inStock) {
    return JSON.stringify({
      shouldPost: false,
      reason: "no_change",
      answer: "",
      confidence: "low",
      evidence: [],
    });
  }
  return JSON.stringify({
    shouldPost: true,
    reason: "changed_availability",
    answer:
      "The Nimbus Running Shoe is back in stock — you can add it to your cart now.",
    confidence: "high",
    evidence: [
      'Availability changed from "Out of stock" to "In stock"',
      '"Add to cart" is now enabled',
    ],
  });
}

function parseTaggedId(text: string, label: RegExp): number | null {
  for (const line of text.split("\n")) {
    if (!label.test(line)) continue;
    const match = line.match(/\[(\d+)\]/);
    if (match) return Number(match[1]);
  }
  return null;
}

function plannerJson(
  text: string,
  scenarioName: LocalMockProviderScenarioName,
): string {
  if (/Agent summary:/i.test(text)) {
    return JSON.stringify({
      approved: true,
      reason: "Local mock validation accepts the visible completion state.",
    });
  }
  if (/Expected state:/i.test(text)) {
    return JSON.stringify({
      alignment: "aligned",
      reason: "Local mock monitor sees progress aligned with the fixture task.",
    });
  }
  if (
    scenarioName === "done-draft-read-element" ||
    scenarioName === "done-draft-premature-recovery"
  ) {
    return JSON.stringify({
      isMultiStep: false,
      difficulty: "simple",
      steps: [
        {
          objective:
            "Draft the requested German apology message in the visible message composer and leave it unsent for review.",
          successCriteria:
            "Composer contains the German apology draft and the Send button has not been clicked.",
          dependencies: [],
          assumptions: [],
          verifyAfter: {
            trigger: "composer contains German apology draft",
            action: "call_done",
          },
          toolProfile: "form_fill",
        },
      ],
    });
  }
  if (scenarioName === "done-form-submit-gating") {
    return JSON.stringify({
      isMultiStep: false,
      difficulty: "moderate",
      steps: [
        {
          objective:
            "Fill and submit the partner registration form for Sam Rivera at Northstar Analytics.",
          successCriteria:
            "Registration received page shows Sam Rivera, Northstar Analytics, sam.rivera@example.com, and PN-4821.",
          dependencies: [],
          assumptions: [],
          verifyAfter: {
            trigger: "Registration received",
            action: "call_done",
          },
          toolProfile: "form_fill",
        },
      ],
    });
  }
  if (scenarioName === "done-summary-incomplete-recovery") {
    return JSON.stringify({
      isMultiStep: false,
      difficulty: "simple",
      steps: [
        {
          objective:
            "Read the page and summarize the main Transformer architecture points.",
          successCriteria:
            "Summary mentions attention mechanism, encoder-decoder structure, and positional encoding.",
          dependencies: [],
          assumptions: [],
          verifyAfter: {
            trigger: "summary includes all main points",
            action: "call_done",
          },
          toolProfile: "read_only",
        },
      ],
    });
  }
  if (scenarioName === "partial-handoff-max-turns") {
    return JSON.stringify({
      isMultiStep: false,
      difficulty: "simple",
      steps: [
        {
          objective:
            "Read the page and gather the main Transformer architecture facts before summarizing.",
          successCriteria:
            "The summary mentions attention, encoder-decoder structure, and positional encoding, with remaining uncertainty if incomplete.",
          dependencies: [],
          assumptions: [],
          verifyAfter: {
            trigger: "facts have been gathered and summary is ready",
            action: "call_done",
          },
          toolProfile: "read_only",
        },
      ],
    });
  }
  if (
    /Quiz Derailment Fixture|Question 32|Answer the quiz question/i.test(
      text,
    )
  ) {
    return JSON.stringify({
      isMultiStep: true,
      difficulty: "moderate",
      subtasks: [
        "Read the current quiz question and select the correct answer(s) for Question 31",
        "Report completion",
      ],
      steps: [
        {
          objective:
            "Read the current quiz question and select the correct answer(s) for Question 31",
          successCriteria:
            "Question 31 has the correct answer options selected",
          dependencies: [],
          assumptions: [
            "The planner target is intentionally stale for this fixture.",
          ],
          toolProfile: "full",
        },
        {
          objective: "Report completion",
          successCriteria: "The selected answer names are reported",
          dependencies: [0],
          assumptions: [],
          toolProfile: "read_only",
        },
      ],
    });
  }
  return JSON.stringify({
    isMultiStep: false,
    difficulty: "simple",
    subtasks: [],
    steps: [],
  });
}

function quizOptionSelected(text: string, option: string): boolean {
  return new RegExp(
    `Selected answers:[^\\n]*(?:${option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "i",
  ).test(text);
}

const GERMAN_DRAFT =
  "Hallo Elisabeth,\n\nentschuldige bitte, dass ich nicht frueher geantwortet habe. Ich bin aktuell auf der Suche nach einer Stelle in meinem Berufsfeld und melde mich deshalb erst jetzt.\n\nViele Gruesse\nKris";

const INCOMPLETE_LONG_SUMMARY =
  "The page explains that Transformer architecture is built around attention, which lets models weigh relationships across the input and process information efficiently. It also describes the encoder-decoder structure, where the encoder builds contextual representations and the decoder uses those representations to produce outputs. Finally, it notes that positional encoding is needed because attention alone does not preserve sequence order, giving the model information about token positions in";

const COMPLETE_SUMMARY =
  "The page explains three main Transformer concepts: attention lets the model weigh relationships across input tokens, the encoder-decoder structure separates representation building from output generation, and positional encoding gives the model sequence-order information.";

function isDoneDraftScenario(
  scenarioName: LocalMockProviderScenarioName,
): boolean {
  return (
    scenarioName === "done-draft-read-element" ||
    scenarioName === "done-draft-premature-recovery"
  );
}

function textIncludesDraftEvidence(text: string): boolean {
  return (
    /value="[\s\S]*aktuell auf der Suche nach einer Stelle/i.test(text) ||
    /messagingResult[\s\S]*aktuell auf der Suche nach einer Stelle/i.test(text)
  );
}

function draftComposerId(text: string): number {
  return (
    parseTaggedId(
      text,
      /reply-editor|Schreiben Sie eine Nachricht|Nachricht|message|textarea/i,
    ) ?? 133
  );
}

function partnerFieldId(text: string, label: RegExp, fallback: number): number {
  return parseTaggedId(text, label) ?? fallback;
}

function formSubmitId(text: string): number {
  return parseTaggedId(text, /Submit registration/i) ?? 240;
}

function executorToolCalls(
  text: string,
  scenarioName: LocalMockProviderScenarioName,
  state: LocalMockProviderState,
): ToolCallSpec[] {
  if (scenarioName === "partial-handoff-max-turns") {
    state.partialHandoffReadReturned = true;
    return [{ name: "read_page", args: {} }];
  }

  if (scenarioName === "done-summary-incomplete-recovery") {
    if (!state.summaryReadReturned) {
      state.summaryReadReturned = true;
      return [{ name: "read_page", args: {} }];
    }
    if (!state.summaryIncompleteDoneReturned) {
      state.summaryIncompleteDoneReturned = true;
      return [
        {
          name: "done",
          args: { summary: INCOMPLETE_LONG_SUMMARY },
        },
      ];
    }
    return [
      {
        name: "done",
        args: { summary: COMPLETE_SUMMARY },
      },
    ];
  }

  if (scenarioName === "done-form-submit-gating") {
    if (
      /Registration received|partnerRegistrationResult|submitted":true/i.test(
        text,
      )
    ) {
      return [
        {
          name: "done",
          args: {
            summary:
              "Submitted the partner registration for Sam Rivera at Northstar Analytics and reached the registration received confirmation.",
          },
        },
      ];
    }
    if (state.formPrematureDoneReturned && !state.formSubmittedReturned) {
      state.formSubmittedReturned = true;
      return [{ name: "click_element", args: { id: formSubmitId(text) } }];
    }
    if (state.formFilledReturned && !state.formPrematureDoneReturned) {
      state.formPrematureDoneReturned = true;
      return [
        {
          name: "done",
          args: {
            summary:
              "Filled the partner registration form for Sam Rivera and the information is ready.",
          },
        },
      ];
    }
    state.formFilledReturned = true;
    return [
      {
        name: "type_text",
        args: {
          id: partnerFieldId(text, /Full name|partner-full-name/i, 201),
          text: "Sam Rivera",
        },
      },
      {
        name: "type_text",
        args: {
          id: partnerFieldId(text, /Email|partner-email/i, 202),
          text: "sam.rivera@example.com",
        },
      },
      {
        name: "type_text",
        args: {
          id: partnerFieldId(text, /Phone|partner-phone/i, 203),
          text: "+1 415 555 0134",
        },
      },
      {
        name: "type_text",
        args: {
          id: partnerFieldId(text, /Company|partner-company/i, 204),
          text: "Northstar Analytics",
        },
      },
      {
        name: "type_text",
        args: {
          id: partnerFieldId(text, /Role|partner-role/i, 205),
          text: "Partnerships Lead",
        },
      },
      {
        name: "type_text",
        args: {
          id: partnerFieldId(text, /Team|partner-team/i, 206),
          text: "Alliances",
        },
      },
      {
        name: "type_text",
        args: {
          id: partnerFieldId(text, /Invite code|partner-invite-code/i, 207),
          text: "PN-4821",
        },
      },
      {
        name: "set_checkbox",
        args: {
          id: partnerFieldId(text, /partner terms|partner-terms/i, 208),
          checked: true,
        },
      },
    ];
  }

  if (isDoneDraftScenario(scenarioName)) {
    if (
      scenarioName === "done-draft-premature-recovery" &&
      !state.draftPrematureDoneReturned
    ) {
      state.draftPrematureDoneReturned = true;
      return [
        {
          name: "done",
          args: {
            summary:
              "The requested German apology draft is ready in the composer and has not been sent.",
          },
        },
      ];
    }
    if (!state.draftTypedReturned) {
      state.draftTypedReturned = true;
      return [
        {
          name: "type_text",
          args: { id: draftComposerId(text), text: GERMAN_DRAFT },
        },
      ];
    }
    if (!state.draftReadReturned) {
      state.draftReadReturned = true;
      return [
        {
          name: "read_element",
          args: { id: draftComposerId(text), attribute: "value" },
        },
      ];
    }
    if (textIncludesDraftEvidence(text) || state.draftReadReturned) {
      return [
        {
          name: "done",
          args: {
            summary:
              "- Drafted the German apology message in the composer\n- Confirmed the composer contains the apology and job-search context\n- Left unsent in the composer for your review - the Send button was not clicked",
          },
        },
      ];
    }
  }

  if (/Welcome,\s*Admin|authenticated dashboard|loginResult/i.test(text)) {
    return [
      {
        name: "done",
        args: {
          summary: "Logged in as admin@example.com with Remember me checked.",
        },
      },
    ];
  }

  if (/Challenge Complete|challengeResult/i.test(text)) {
    return [
      {
        name: "done",
        args: { summary: "Challenge completed with code ALPHA-7492." },
      },
    ];
  }

  if (
    /Completion evidence indicates/i.test(text) &&
    scenarioName === "quiz-derailment"
  ) {
    return [
      {
        name: "done",
        args: {
          summary:
            "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
        },
      },
    ];
  }

  if (scenarioName === "navigation") {
    if (state.navigationCodeSubmitReturned) {
      return [
        {
          name: "done",
          args: { summary: "Challenge completed with code ALPHA-7492." },
        },
      ];
    }
    if (/ALPHA-7492/.test(text)) {
      const inputId =
        parseTaggedId(text, /Enter the secret code|type=text|placeholder/i) ??
        133;
      const submitId = parseTaggedId(text, /Submit Code/i) ?? 134;
      state.navigationCodeSubmitReturned = true;
      return [
        { name: "type_text", args: { id: inputId, text: "ALPHA-7492" } },
        { name: "click_element", args: { id: submitId } },
      ];
    }
    const advanceId = parseTaggedId(text, /Advance/i) ?? 45;
    return [{ name: "click_element", args: { id: advanceId, count: 3 } }];
  }

  if (scenarioName === "login") {
    if (state.loginSubmitReturned) {
      return [
        {
          name: "done",
          args: {
            summary: "Logged in as admin@example.com with Remember me checked.",
          },
        },
      ];
    }
    const fieldsAlreadyFilled =
      /admin@example\.com/.test(text) &&
      /secret123/.test(text) &&
      /checked=true/.test(text);
    if (fieldsAlreadyFilled) {
      const submitId =
        parseTaggedId(text, /button.*Log In|Log In.*button/i) ?? 5;
      state.loginSubmitReturned = true;
      return [{ name: "click_element", args: { id: submitId } }];
    }
    const emailId =
      parseTaggedId(text, /login-email|label=Email|type=email/i) ?? 2;
    const passwordId =
      parseTaggedId(text, /login-password|label=Password|type=password/i) ?? 3;
    const rememberId =
      parseTaggedId(text, /remember-me|Remember me|type=checkbox/i) ?? 1;
    return [
      { name: "type_text", args: { id: emailId, text: "admin@example.com" } },
      { name: "type_text", args: { id: passwordId, text: "secret123" } },
      { name: "set_checkbox", args: { id: rememberId, checked: true } },
    ];
  }

  if (scenarioName === "quiz-derailment") {
    const correctSelected =
      quizOptionSelected(text, "Domain Adaptation Fine-Tuning") &&
      quizOptionSelected(text, "Continued Pre-Training") &&
      !quizOptionSelected(text, "Incremental Learning");
    if (correctSelected) {
      state.quizReadsAfterSelection += 1;
      if (state.quizReadsAfterSelection >= 3) {
        const wrongId =
          parseTaggedId(
            text,
            /Incremental Learning|quiz-incremental-learning/i,
          ) ?? 160;
        return [{ name: "set_checkbox", args: { id: wrongId, checked: true } }];
      }
      return [{ name: "read_page", args: {} }];
    }

    if (!state.quizCorrectSelectionsReturned) {
      const domainId =
        parseTaggedId(
          text,
          /Domain Adaptation Fine-Tuning|quiz-domain-adaptation-fine-tuning/i,
        ) ?? 158;
      const continuedId =
        parseTaggedId(
          text,
          /Continued Pre-Training|quiz-continued-pre-training/i,
        ) ?? 159;
      state.quizCorrectSelectionsReturned = true;
      return [
        { name: "set_checkbox", args: { id: domainId, checked: true } },
        { name: "set_checkbox", args: { id: continuedId, checked: true } },
      ];
    }

    return [{ name: "read_page", args: {} }];
  }

  return [{ name: "read_page", args: {} }];
}

function buildMockResponse(
  payload: any,
  scenarioName: LocalMockProviderScenarioName,
  state: LocalMockProviderState,
): { body: string; contentType: string } {
  const text = flattenPayloadText(payload);
  const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;

  if (hasTools) {
    return {
      body: sseToolCalls(executorToolCalls(text, scenarioName, state)),
      contentType: "text/event-stream",
    };
  }

  // Passive Watch Mode evaluations are JSON-object completions with a distinct
  // system prompt. Answer only once the page has actually flipped to in-stock so
  // the initial out-of-stock tick does not produce a premature suggestion. Note
  // this falls through to the shared stream/JSON tail below — the passive
  // evaluate streams, so the body must honor payload.stream.
  const isPassiveWatch =
    payload.response_format?.type === "json_object" &&
    /OpenSidebar passive Watch Mode/i.test(text);

  const content =
    payload.response_format?.type === "json_object"
      ? isPassiveWatch
        ? passiveWatchJson(text)
        : plannerJson(text, scenarioName)
      : [
          "LOCATION: Current fixture page",
          "CHANGES: Current page is stable",
          "BLOCKERS: None",
          "AFFORDANCES: Use visible tagged controls",
          "COMPLETION: not_done",
        ].join("\n");

  if (payload.stream) {
    return { body: sseContent(content), contentType: "text/event-stream" };
  }

  return { body: jsonContent(content), contentType: "application/json" };
}

export async function installLocalMockProviderInterceptor(
  session: CDPSession,
  scenarioName: LocalMockProviderScenarioName,
): Promise<void> {
  const state: LocalMockProviderState = {
    loginSubmitReturned: false,
    navigationCodeSubmitReturned: false,
    quizCorrectSelectionsReturned: false,
    quizReadsAfterSelection: 0,
    draftPrematureDoneReturned: false,
    draftTypedReturned: false,
    draftReadReturned: false,
    formFilledReturned: false,
    formPrematureDoneReturned: false,
    formSubmittedReturned: false,
    summaryReadReturned: false,
    summaryIncompleteDoneReturned: false,
    partialHandoffReadReturned: false,
  };

  await session.send("Fetch.enable", {
    patterns: [
      { urlPattern: "https://api.fireworks.ai/*", requestStage: "Request" },
      { urlPattern: "https://api.openrouter.ai/*", requestStage: "Request" },
      { urlPattern: "https://openrouter.ai/*", requestStage: "Request" },
    ],
  });

  session.on("Fetch.requestPaused", async (event: any) => {
    try {
      const postData = event.request.postData ?? "{}";
      const payload = JSON.parse(postData);
      const response = buildMockResponse(payload, scenarioName, state);
      await session.send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "content-type", value: response.contentType },
          { name: "access-control-allow-origin", value: "*" },
        ],
        body: Buffer.from(response.body, "utf8").toString("base64"),
      });
    } catch (error) {
      await session.send("Fetch.fulfillRequest", {
        requestId: event.requestId,
        responseCode: 500,
        responseHeaders: [{ name: "content-type", value: "text/plain" }],
        body: Buffer.from(
          error instanceof Error ? error.message : String(error),
          "utf8",
        ).toString("base64"),
      });
    }
  });
}
