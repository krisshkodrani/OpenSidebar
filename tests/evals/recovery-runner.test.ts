import { describe, expect, test } from "vitest";
import {
  buildRecoveryIntervention,
  collectReplayContextSignals,
} from "../../evals/runner";
import { ToolName } from "../../src/types";
import type { LLMMessage } from "../../src/background/llm/types";

function makeMessages(systemPrompt: string, extra: LLMMessage[] = []): LLMMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: "Objective: Enter the code and then hit enter" },
    ...extra,
  ];
}

describe("recovery replay interventions", () => {
  test("forces escalate/done after explicit stagnation warning", () => {
    const messages = makeMessages(
      [
        "## Page Context",
        "URL: https://example.com/browser-challenge/step8?version=2",
        "## Visible Elements",
        "[1] input \"Enter 6-character code\"",
      ].join("\n"),
      [
        {
          role: "user",
          content:
            "[SYSTEM STAGNATION WARNING] You have been executing for 100 turns on the same objective without completing it.",
        },
      ],
    );

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.READ_PAGE, args: {} }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("stagnation_warning_forced_escalation");
    expect(intervention?.followUp).toContain('Call escalate({"reason":"Exceeded turn budget');
  });

  test("blocks press_key text entry when a visible input exists", () => {
    const messages = makeMessages(
      [
        "## Visible Elements",
        "Inputs & Forms (1):",
        '[1] input type=text "Enter 6-character code"',
      ].join("\n"),
    );

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.PRESS_KEY, args: { key: "a", modifiers: ["ctrl"] } }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("press_key_text_entry_blocked");
    expect(intervention?.followUp).toContain("Use type_text");
  });

  test("redirects to done when the target step is already reached", () => {
    const messages = [
      {
        role: "system" as const,
        content: [
          "## Page Context",
          "Title: Browser Navigation Challenge - The Ultimate Test",
          "URL: https://example.com/browser-challenge/step6?version=2",
          "## Visible Elements",
          '[43] input type=text "Enter 6-character code"',
          '[44] button type=submit "Submit Code"',
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: "Objective: Now reveal the code in this step 5 and enter it to proceed to step 6 then click submit",
      },
    ];

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.PRESS_KEY, args: { key: "a", modifiers: ["ctrl"] } }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("goal_already_reached_done_now");
    expect(intervention?.followUp).toContain("Call done()");
  });

  test("nudges submit after code is already entered and reread is attempted", () => {
    const messages = makeMessages(
      [
        "## Page Context",
        "URL: https://example.com/browser-challenge/step5?version=2",
        "## Visible Elements",
        "Inputs & Forms (1):",
        '[122] input type=text "LURMNZ"',
        "Buttons (1):",
        '[123] button type=submit "Submit Code"',
        "Other (2):",
        '[509] div "LURMNZ"',
        '[510] span "LURMNZ"',
      ].join("\n"),
      [
        {
          role: "user",
          content:
            "Objective: Now reveal the code in this step 5 and enter it to proceed to step 6 then click submit",
        },
      ],
    );

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.READ_PAGE, args: {} }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("visible_code_to_input_bridge");
    expect(intervention?.followUp).toContain("click submit");
  });

  test("forces direct click when code is visible and model keeps investigating", () => {
    const messages = makeMessages(
      [
        "## Page Context",
        "URL: https://example.com/browser-challenge/step5?version=2",
        "## Visible Elements",
        "Other (2):",
        '[391] div "S5CRFE"',
        '[392] span "S5CRFE"',
      ].join("\n"),
    );

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.XRAY_PAGE, args: {} }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("visible_code_to_input_bridge");
    expect(intervention?.forcedToolCalls).toEqual([
      { toolName: ToolName.CLICK_ELEMENT, args: { id: 392 } },
    ]);
  });

  test("forces type_text with previously discovered code when visible input exists", () => {
    const messages = makeMessages(
      [
        "## Page Context",
        "URL: https://example.com/browser-challenge/step6?version=2",
        "## Visible Elements",
        "Inputs & Forms (1):",
        '[1] input type=text "Enter 6-character code"',
        "Buttons (1):",
        '[2] button type=submit "Submit Code"',
      ].join("\n"),
      [
        {
          role: "user",
          content:
            '[DISTILLED HISTORY — 7 actions]\nT1: type_text [207] "S5CRFE" → Typed "S5CRFE" into [207] and pressed Enter',
        },
      ],
    );

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.PRESS_KEY, args: { key: "a", modifiers: ["ctrl"] } }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("prompt_code_to_input_bridge");
    expect(intervention?.forcedToolCalls).toEqual([
      {
        toolName: ToolName.TYPE_TEXT,
        args: { id: 1, text: "S5CRFE", pressEnter: true },
      },
    ]);
  });

  test("forces submit when the visible code is already prefilled in the input", () => {
    const messages = [
      {
        role: "system" as const,
        content: [
          "## Page Context",
          "URL: https://example.com/browser-challenge/step5?version=2",
          "## Visible Elements",
          "Inputs & Forms (1):",
          '[122] input type=text placeholder="Enter 6-character code" value=LURMNZ "LURMNZ"',
          "Buttons (1):",
          '[123] button type=submit "Submit Code"',
          "Other (2):",
          '[509] div "LURMNZ"',
          '[510] span "LURMNZ"',
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: "Objective: Now reveal the code in this step 5 and enter it to proceed to step 6 then click submit",
      },
    ];

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.INSPECT_HIDDEN, args: { maxResults: 50, pattern: "LURMNZ" } }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("submit_visible_prefilled_code_now");
    expect(intervention?.forcedToolCalls).toEqual([
      {
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 123 },
      },
    ]);
  });

  test("forces inspect_hidden before submitting a suspicious prefilled puzzle code", () => {
    const messages = [
      {
        role: "system" as const,
        content: [
          "## Page Context",
          "URL: https://example.com/browser-challenge/step20?version=1",
          "## Visible Elements",
          "Inputs & Forms (1):",
          '[46] input type=text value=47NV6U "47NV6U"',
          "Buttons (1):",
          '[47] button type=submit "Submit Code"',
          "## Page Content",
          "Puzzle Challenge: Solve this puzzle to reveal the code",
          "Code revealed:",
          "47NV6U",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: "Objective: Solve the puzzle to go to step 21",
      },
    ];

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.CLICK_ELEMENT, args: { id: 47 } }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("prefilled_code_requires_verification");
    expect(intervention?.forcedToolCalls).toEqual([
      {
        toolName: ToolName.INSPECT_HIDDEN,
        args: { pattern: "[A-Z0-9]{6}" },
      },
    ]);
  });

  test("forces escalate after repeated suspicious submit attempts on same URL", () => {
    const messages = [
      {
        role: "system" as const,
        content: [
          "## Page Context",
          "URL: https://example.com/browser-challenge/step20?version=1",
          "## Visible Elements",
          "Inputs & Forms (1):",
          '[46] input type=text value=47NV6U "47NV6U"',
          "Buttons (1):",
          '[47] button type=submit "Submit Code"',
          "## Page Content",
          "Puzzle Challenge: Solve this puzzle to reveal the code",
          "Code revealed:",
          "47NV6U",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: "SAME-URL ESCALATION: You spent 8 turns on this page without navigating away.",
      },
      {
        role: "assistant" as const,
        content: null,
        tool_calls: [
          {
            id: "prev-submit",
            type: "function",
            function: {
              name: ToolName.CLICK_ELEMENT,
              arguments: JSON.stringify({ id: 47 }),
            },
          },
        ],
      },
    ];

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.CLICK_ELEMENT, args: { id: 47 } }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("repeated_submit_requires_escalation");
    expect(intervention?.forcedToolCalls).toEqual([
      {
        toolName: ToolName.ESCALATE,
        args: { reason: "Code rejected by form 3 times - need different approach" },
      },
    ]);
  });

  test("forces xray_page when attribute-hint pages tempt custom execute_js", () => {
    const messages = [
      {
        role: "system" as const,
        content: [
          "## Page Context",
          "URL: https://example.com/browser-challenge/step1?version=1",
          "## Visible Elements",
          "Other (3):",
          '[40] p "Hidden DOM Challenge: The code is hidden somewhere in this element."',
          '[46] p "Hint: Check the element attributes, aria labels, or meta tags."',
          '[47] div "Code hidden - complete challenge to reveal"',
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: "Objective: ok, find the code to move to the next step and move to the next step",
      },
    ];

    const signals = collectReplayContextSignals(messages);
    const intervention = buildRecoveryIntervention(
      [{ toolName: ToolName.EXECUTE_JS, args: { code: "document.querySelectorAll('*').length" } }],
      signals.repeatedCalls,
      signals,
      0,
    );

    expect(intervention?.kind).toBe("attribute_hint_tool_redirect");
    expect(intervention?.forcedToolCalls).toEqual([
      {
        toolName: ToolName.XRAY_PAGE,
        args: {},
      },
    ]);
  });
});
