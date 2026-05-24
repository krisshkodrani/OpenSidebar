import type { CDPSession } from "puppeteer";

export type LocalMockProviderScenarioName =
  | "login"
  | "navigation"
  | "quiz-derailment";

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
    prompt: "Please complete the navigation challenge on this page.",
    maxTurns: 12,
    timeoutMs: 180_000,
  },
  "quiz-derailment": {
    fixture: "quiz-derailment",
    label: "completion-done-quiz-derailment",
    prompt: "Select the correct option/s",
    maxTurns: 12,
    timeoutMs: 180_000,
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

function parseTaggedId(text: string, label: RegExp): number | null {
  for (const line of text.split("\n")) {
    if (!label.test(line)) continue;
    const match = line.match(/\[(\d+)\]/);
    if (match) return Number(match[1]);
  }
  return null;
}

function plannerJson(text: string): string {
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
  if (/Quiz Derailment Fixture|Question 32|Select the correct option\/s/i.test(text)) {
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

function executorToolCalls(
  text: string,
  scenarioName: LocalMockProviderScenarioName,
  state: LocalMockProviderState,
): ToolCallSpec[] {
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

  if (/Completion evidence indicates/i.test(text) && scenarioName === "quiz-derailment") {
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
      const submitId = parseTaggedId(text, /button.*Log In|Log In.*button/i) ?? 5;
      state.loginSubmitReturned = true;
      return [{ name: "click_element", args: { id: submitId } }];
    }
    const emailId = parseTaggedId(text, /login-email|label=Email|type=email/i) ?? 2;
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
          parseTaggedId(text, /Incremental Learning|quiz-incremental-learning/i) ??
          160;
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

  const content =
    payload.response_format?.type === "json_object"
      ? plannerJson(text)
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
