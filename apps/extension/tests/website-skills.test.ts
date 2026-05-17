import { beforeEach, describe, expect, test, vi } from "vitest";
import "./setup";
import {
  WEBSITE_SKILLS_STORAGE_KEY,
  classifyValueKind,
  deleteUserWebsiteSkill,
  findMatchingUserWebsiteSkill,
  formatRecordingTimelineEvent,
  formatUserWebsiteSkillGuidance,
  generateWebsiteSkillDraft,
  loadUserWebsiteSkills,
  normalizeSkillRecordingEvents,
  saveUserWebsiteSkill,
  withTimelineText,
} from "../src/utils/website-skills";
import type { SkillRecordingEvent } from "../src/types";

describe("website skills", () => {
  let stored: Record<string, unknown>;

  beforeEach(() => {
    stored = {};
    chrome.storage.local.get = vi.fn(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((item) => [item, stored[item]]));
      }
      return { [key]: stored[key] };
    }) as any;
    chrome.storage.local.set = vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(stored, value);
    }) as any;
  });

  test("classifies and redacts field intent for timeline wording", () => {
    expect(classifyValueKind("dev@example.com", "text")).toBe("email");
    expect(classifyValueKind("+1 555 121 2121", "tel")).toBe("phone");
    expect(classifyValueKind("42", "number")).toBe("number");
    expect(
      formatRecordingTimelineEvent({
        id: "e1",
        kind: "input",
        timestamp: 1,
        url: "https://example.com/orders",
        path: "/orders",
        label: "Email",
        valueKind: "email",
      }),
    ).toBe('Filled "Email" with <email>');
    expect(
      formatRecordingTimelineEvent({
        id: "e2",
        kind: "input",
        timestamp: 1,
        url: "https://example.com/orders",
        path: "/orders",
        label: "Password",
        valueKind: "redacted",
        sensitive: true,
      }),
    ).toBe("Captured field intent, value redacted");
  });

  test("generates a generalized draft without raw typed values", () => {
    const events: SkillRecordingEvent[] = [
      withTimelineText({
        id: "e1",
        kind: "click",
        timestamp: 1,
        url: "https://shop.example/orders/new",
        path: "/orders/new",
        label: "Create order",
      }),
      withTimelineText({
        id: "e2",
        kind: "input",
        timestamp: 2,
        url: "https://shop.example/orders/new",
        path: "/orders/new",
        label: "Customer email",
        valueKind: "email",
      }),
      withTimelineText({
        id: "e3",
        kind: "click",
        timestamp: 3,
        url: "https://shop.example/orders/new",
        path: "/orders/new",
        label: "Submit order",
      }),
    ];

    const draft = generateWebsiteSkillDraft(events, "https://shop.example/orders/new");

    expect(draft.name).toBe("Create Order");
    expect(draft.origin).toBe("https://shop.example");
    expect(draft.pathPattern).toBe("/orders/new");
    expect(draft.workflowSteps.join("\n")).toContain(
      'Fill "Customer email" with the user-provided email.',
    );
    expect(draft.workflowSteps.join("\n")).not.toContain("dev@example.com");
    expect(draft.privacySummary).toContain("redacted");
    expect(draft.guardrails).toContain(
      "Do not change unrelated fields or options unless the user asks.",
    );
    expect(draft.capturedInputCount).toBe(1);
  });

  test("dedupes repeated checkbox captures and generalizes quiz answer selection", () => {
    const events: SkillRecordingEvent[] = [
      withTimelineText({
        id: "page",
        kind: "page",
        timestamp: 1,
        url: "https://www.udemy.com/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
        path: "/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
        label: "Practice exam",
      }),
      withTimelineText({
        id: "e1",
        kind: "checkbox",
        timestamp: 2,
        url: "https://www.udemy.com/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
        path: "/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
        label: "AWS Trainium",
        tagName: "input",
        inputType: "checkbox",
        controlType: "checkbox",
        checked: true,
      }),
      withTimelineText({
        id: "e2",
        kind: "checkbox",
        timestamp: 3,
        url: "https://www.udemy.com/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
        path: "/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
        label: "AWS Trainium",
        tagName: "input",
        inputType: "checkbox",
        controlType: "checkbox",
        checked: true,
      }),
      withTimelineText({
        id: "e3",
        kind: "checkbox",
        timestamp: 4,
        url: "https://www.udemy.com/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
        path: "/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
        label: "Amazon SageMaker JumpStart",
        tagName: "input",
        inputType: "checkbox",
        controlType: "checkbox",
        checked: true,
      }),
    ];

    expect(
      normalizeSkillRecordingEvents(events).filter(
        (event) => event.label === "AWS Trainium",
      ),
    ).toHaveLength(1);

    const draft = generateWebsiteSkillDraft(
      events,
      "https://www.udemy.com/course/practice-exams-aws-certified-ai-practitioner/learn/quiz/646375/test",
    );

    expect(draft.name).toBe("Choose answers on quiz page");
    expect(draft.triggerPhrase).toBe("choose answers");
    expect(draft.pathPattern).toBe("/course/*/learn/quiz/*");
    expect(draft.workflowSteps.join("\n")).toContain(
      "Find the answer options requested by the user.",
    );
    expect(draft.workflowSteps.join("\n")).not.toContain("AWS Trainium");
    expect(draft.guardrails).toContain(
      "Do not submit, finish, grade, or move to the next question unless the user explicitly asks.",
    );
    expect(draft.requiredEvidence).toContain(
      "Each requested answer option is visibly selected.",
    );
    expect(draft.privacySummary).toContain("No typed values were captured");
    expect(draft.capturedInputCount).toBe(0);
  });

  test("does not add a conflicting no-submit guardrail when submit was recorded", () => {
    const draft = generateWebsiteSkillDraft(
      [
        withTimelineText({
          id: "e1",
          kind: "click",
          timestamp: 1,
          url: "https://shop.example/orders/new",
          path: "/orders/new",
          label: "Submit order",
        }),
      ],
      "https://shop.example/orders/new",
    );

    expect(draft.name).toBe("Submit Order");
    expect(draft.guardrails.join("\n")).not.toContain("Do not submit");
    expect(draft.guardrails).toContain(
      "Verify the requested state before using any submit, finish, or confirmation action.",
    );
  });

  test("matches generalized wildcard paths and includes guardrails in guidance", () => {
    const draft = generateWebsiteSkillDraft(
      [
        withTimelineText({
          id: "e1",
          kind: "checkbox",
          timestamp: 1,
          url: "https://www.udemy.com/course/aws-ai/learn/quiz/12345/test",
          path: "/course/aws-ai/learn/quiz/12345/test",
          label: "Option A",
          checked: true,
          controlType: "checkbox",
          inputType: "checkbox",
        }),
      ],
      "https://www.udemy.com/course/aws-ai/learn/quiz/12345/test",
    );
    const saved = { ...draft, enabled: true };

    expect(
      findMatchingUserWebsiteSkill([saved], {
        url: "https://www.udemy.com/course/another-course/learn/quiz/999/result",
        task: "please choose answers",
      })?.id,
    ).toBe(saved.id);
    expect(formatUserWebsiteSkillGuidance(saved)).toContain("Guardrails:");
  });

  test("saves, lists, deletes, and matches enabled skills by site scope", async () => {
    const draft = generateWebsiteSkillDraft(
      [
        withTimelineText({
          id: "e1",
          kind: "click",
          timestamp: 1,
          url: "https://app.example/admin/users",
          path: "/admin/users",
          label: "Save user",
        }),
      ],
      "https://app.example/admin/users",
    );
    draft.triggerPhrase = "save user";

    const saved = await saveUserWebsiteSkill(draft);
    expect(saved.enabled).toBe(true);
    expect(await loadUserWebsiteSkills()).toHaveLength(1);
    expect(stored[WEBSITE_SKILLS_STORAGE_KEY]).toHaveLength(1);

    const match = findMatchingUserWebsiteSkill([saved], {
      url: "https://app.example/admin/users/123",
      task: "please save user changes",
    });
    expect(match?.id).toBe(saved.id);

    const remaining = await deleteUserWebsiteSkill(saved.id);
    expect(remaining).toEqual([]);
  });
});
