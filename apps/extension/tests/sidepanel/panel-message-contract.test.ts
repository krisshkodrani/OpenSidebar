import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { useStore } from "../../src/sidepanel/store";
import type { UserWebsiteSkill, UserWebsiteSkillDraft } from "../../src/types";

const draftSkill: UserWebsiteSkillDraft = {
  id: "skill-1",
  name: "Harness checkout",
  origin: "https://example.com",
  pathPattern: "/checkout",
  triggerPhrase: "checkout",
  workflowSteps: ["Fill the form.", "Submit the checkout."],
  requiredEvidence: ["Confirmation is visible."],
  privacySummary: "Typed values are redacted.",
  capturedEventCount: 2,
  createdAt: 1,
  updatedAt: 1,
};

const savedSkill: UserWebsiteSkill = {
  ...draftSkill,
  enabled: true,
  updatedAt: 2,
};

describe("sidepanel panel-to-background message contract", () => {
  beforeEach(() => {
    useStore.setState({
      userWebsiteSkills: [],
      recordSkillIntroDismissed: false,
      skillRecordingStatus: "idle",
      skillRecordingTimeline: [],
      skillRecordingDraft: null,
      activeUserWebsiteSkill: null,
    });

    globalThis.chrome = globalThis.chrome || ({} as any);
    globalThis.chrome.runtime = {
      ...globalThis.chrome.runtime,
      sendMessage: vi.fn(async (message: { type?: string }) => {
        switch (message.type) {
          case "USER_SKILL_LIST":
            return { ok: true, skills: [savedSkill] };
          case "SKILL_RECORDING_START":
            return { ok: true };
          case "SKILL_RECORDING_STOP":
            return { ok: true, draft: draftSkill };
          case "SKILL_RECORDING_CANCEL":
            return { ok: true };
          case "USER_SKILL_SAVE":
            return { ok: true, skills: [savedSkill] };
          case "USER_SKILL_DELETE":
            return { ok: true, skills: [] };
          default:
            return { ok: true };
        }
      }),
    } as any;
    globalThis.chrome.storage = {
      ...globalThis.chrome.storage,
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    } as any;
  });

  test("loads website skills through USER_SKILL_LIST", async () => {
    await useStore.getState().loadUserWebsiteSkills();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "USER_SKILL_LIST",
        source: "sidepanel",
        payload: {},
      }),
    );
    expect(useStore.getState().userWebsiteSkills).toEqual([savedSkill]);
  });

  test("records, saves, and deletes website skills through explicit messages", async () => {
    await useStore.getState().startSkillRecording(42);
    await useStore.getState().stopSkillRecording(42);
    expect(useStore.getState().skillRecordingStatus).toBe("review");
    expect(useStore.getState().skillRecordingDraft).toEqual(draftSkill);

    await useStore.getState().saveUserWebsiteSkill(draftSkill);
    expect(useStore.getState().skillRecordingStatus).toBe("idle");
    expect(useStore.getState().skillRecordingDraft).toBeNull();
    expect(useStore.getState().userWebsiteSkills).toEqual([savedSkill]);

    await useStore.getState().deleteUserWebsiteSkill("skill-1");
    expect(useStore.getState().userWebsiteSkills).toEqual([]);

    const messages = (chrome.runtime.sendMessage as any).mock.calls.map(
      ([message]: [{ type: string; requestId?: string; payload?: unknown }]) =>
        message,
    );
    expect(messages.map((message) => message.type)).toEqual([
      "SKILL_RECORDING_START",
      "SKILL_RECORDING_STOP",
      "USER_SKILL_SAVE",
      "USER_SKILL_DELETE",
    ]);
    expect(messages[0]).toMatchObject({
      payload: { tabId: 42 },
      source: "sidepanel",
    });
    expect(messages[1]).toMatchObject({
      payload: { tabId: 42 },
      source: "sidepanel",
    });
    expect(messages[2]).toMatchObject({
      payload: { draft: draftSkill, enabled: true },
      source: "sidepanel",
    });
    expect(messages[3]).toMatchObject({
      payload: { id: "skill-1" },
      source: "sidepanel",
    });
    expect(messages.every((message) => typeof message.requestId === "string")).toBe(
      true,
    );
  });

  test("cancel returns recording state to idle through SKILL_RECORDING_CANCEL", async () => {
    useStore.getState().setSkillRecordingStatus({
      status: "recording",
      timeline: ["Clicked Search"],
    });

    await useStore.getState().cancelSkillRecording(42);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SKILL_RECORDING_CANCEL",
        payload: { tabId: 42 },
        source: "sidepanel",
      }),
    );
    expect(useStore.getState().skillRecordingStatus).toBe("idle");
    expect(useStore.getState().skillRecordingTimeline).toEqual([]);
    expect(useStore.getState().skillRecordingDraft).toBeNull();
  });

  test("failed recording start maps to paused state", async () => {
    (chrome.runtime.sendMessage as any).mockResolvedValueOnce({
      ok: false,
      detail: "Restricted page",
    });

    await useStore.getState().startSkillRecording(42);

    expect(useStore.getState().skillRecordingStatus).toBe("paused");
    expect(useStore.getState().skillRecordingTimeline).toEqual([]);
  });
});
