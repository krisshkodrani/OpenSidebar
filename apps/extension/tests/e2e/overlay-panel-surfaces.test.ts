import { afterEach, describe, expect, it } from "vitest";
import {
  createOverlayHarnessRunner,
  type OverlayHarnessRunner,
  type OverlayHarnessRunnerOptions,
} from "./helpers/overlay-harness";

const LOCAL_API_KEY_SEED = {
  fireworksApiKey_local: "fake-fireworks-key",
};

describe("Overlay panel product surfaces", () => {
  let runner: OverlayHarnessRunner | null = null;

  afterEach(async () => {
    await runner?.close().catch(() => {});
    runner = null;
  });

  async function setupRunner(
    options: OverlayHarnessRunnerOptions = {},
  ): Promise<OverlayHarnessRunner> {
    runner = await step("create overlay runner", () =>
      createOverlayHarnessRunner({
        autoStartFakeBackground: true,
        ...options,
        runtimeOptions: {
          ...options.runtimeOptions,
          storage: {
            ...options.runtimeOptions?.storage,
            local: {
              ...LOCAL_API_KEY_SEED,
              ...options.runtimeOptions?.storage?.local,
            },
          },
        },
      }),
    );
    await step("inject overlay", () => runner!.inject());
    await step("wait overlay host", () =>
      runner!.page.waitForSelector("#opensidebar-harness-host").then(() => {}),
    );
    await new Promise((resolve) => setTimeout(resolve, 750));
    return runner;
  }

  it("shows an immediate pause requested state when the background has not acknowledged pause yet", async () => {
    const runner = await step("setup runner", () => setupRunner());
    await step("start capture", () => runner.startMessageCapture());

    await step("dispose fake background", () =>
      runner.page.evaluate(() => {
        window.__overlayFakeBackground?.dispose();
      }),
    );

    await step("emit running status", () =>
      runner.emitRuntimeMessage({
        type: "AGENT_STATUS",
        source: "background",
        requestId: "overlay-panel-running",
        payload: {
          status: "THINKING",
          detail: "Long-running browser task",
        },
      }),
    );
    await step("wait running status", () =>
      runner.waitForOverlayText("Long-running browser task"),
    );

    await step("click pause", () => runner.clickOverlayButton("Pause agent"));
    await step("wait pause requested", () =>
      runner.waitForOverlayText("Pause requested"),
    );

    const capture = await runner.readMessageCapture();
    expect(capture.outboundTypes).toContain("PAUSE_AGENT");
    expect(runner.pageErrors).toEqual([]);
  }, 120_000);

  it("persists local Profile Notes and the composer profile toggle through the exposed panel", async () => {
    const runner = await setupRunner();
    const notes = [
      "# About me",
      "My name is John Doe.",
      "Email: john.doe@example.com",
      "Phone: +1 555 0100",
    ].join("\n");

    await runner.clickOverlayButton("Personalize");
    await runner.waitForOverlayText("Use Profile Notes");
    await fillOverlayControl(runner, "Profile Notes", notes);
    await runner.clickOverlayButton("Use Profile Notes");
    await clickOverlayButtonByText(runner, "Save Notes");
    await runner.waitForOverlayText("Notes saved");

    await waitForStorageStringPrefix(
      runner,
      "local",
      "opensidebar:personalProfile",
      ["notesMarkdown"],
      "enc:v1:",
    );
    await waitForStoragePath(
      runner,
      "local",
      "opensidebar:personalProfile",
      ["enabled"],
      true,
    );

    await runner.clickOverlayButton("Close");
    await runner.waitForOverlayText("Profile on");
    await clickOverlayButtonByText(runner, "Profile on");
    await waitForStoragePath(
      runner,
      "local",
      "opensidebar:personalProfile",
      ["enabled"],
      false,
    );

    const snapshot = await runner.readRuntimeSnapshot();
    const persistedProfile = snapshot.storage.local[
      "opensidebar:personalProfile"
    ] as Record<string, unknown>;
    expect(persistedProfile).toMatchObject({ enabled: false });
    expect(persistedProfile.notesMarkdown).toEqual(
      expect.stringMatching(/^enc:v1:/),
    );
    expect(persistedProfile.notesMarkdown).not.toBe(notes);
    expect(
      snapshot.storage.local["opensidebar:personalProfile:cek"],
    ).toEqual(expect.any(String));
    expect(runner.pageErrors).toEqual([]);
  }, 120_000);

  it("deletes local Profile Notes and disables profile use through the exposed panel", async () => {
    const runner = await setupRunner();

    await runner.clickOverlayButton("Personalize");
    await runner.waitForOverlayText("Use Profile Notes");
    await fillOverlayControl(runner, "Profile Notes", "# About me\nJohn Doe");
    await runner.clickOverlayButton("Use Profile Notes");
    await clickOverlayButtonByText(runner, "Save Notes");
    await runner.waitForOverlayText("Notes saved");

    await clickOverlayButtonByText(runner, "Delete");
    await clickOverlayButtonByText(runner, "Confirm");
    await runner.waitForOverlayText("Deleted");
    await runner.waitForOverlayText("Add notes");
    await waitForStorageKeyMissing(
      runner,
      "local",
      "opensidebar:personalProfile",
    );

    await runner.clickOverlayButton("Close");
    await runner.waitForOverlayText("Profile off");
    expect(runner.pageErrors).toEqual([]);
  }, 120_000);

  it("persists general settings changes through the exposed panel", async () => {
    const runner = await setupRunner();

    await runner.clickOverlayButton("Settings");
    await runner.waitForOverlayText("Appearance");
    await clickOverlayButtonByText(runner, "dark");
    await clickOverlayButtonByText(runner, "Fast");
    await clickOverlayText(runner, "Advanced settings");
    await setOverlayCheckboxByLabel(runner, "Allow navigation", false);
    await setOverlayCheckboxByLabel(runner, "Session metrics", true);
    await clickOverlayButtonByText(runner, "Save Changes");

    await waitForStoragePath(
      runner,
      "sync",
      "userSettings",
      ["theme"],
      "dark",
    );
    await waitForStoragePath(
      runner,
      "sync",
      "userSettings",
      ["laneTopologyMode"],
      "simple",
    );
    await waitForStoragePath(
      runner,
      "sync",
      "userSettings",
      ["allowNavigation"],
      false,
    );
    await waitForStoragePath(
      runner,
      "sync",
      "userSettings",
      ["showSessionMetrics"],
      true,
    );

    const snapshot = await runner.readRuntimeSnapshot();
    expect(snapshot.storage.sync.userSettings).toMatchObject({
      theme: "dark",
      laneTopologyMode: "simple",
      allowNavigation: false,
      showSessionMetrics: true,
    });
    expect(runner.pageErrors).toEqual([]);
  }, 120_000);

  it("creates, edits, uses, and deletes saved prompts through the exposed panel", async () => {
    const runner = await setupRunner({
      runtimeOptions: {
        storage: {
          local: {
            "opensidebar:savedPrompts": [],
            "opensidebar:savedPromptsSeeded": true,
            "opensidebar:savedPromptsVersion": 4,
          },
        },
      },
    });

    await runner.clickOverlayButton("Saved Prompts");
    await runner.waitForOverlayText("No saved prompts yet");
    await clickOverlayButtonByText(runner, "Create your first prompt");
    await fillOverlayControl(runner, "Title", "Follow up candidate");
    await fillOverlayControl(
      runner,
      "Prompt content",
      "Draft a candidate follow-up note.",
    );
    await fillOverlayControl(runner, "Category (optional)", "Recruiting");
    await clickOverlayButtonByText(runner, "Save");
    await waitForLocalArrayItemMatch(runner, "opensidebar:savedPrompts", {
      title: "Follow up candidate",
      category: "Recruiting",
    });

    await runner.clickOverlayButton("Edit Follow up candidate");
    await fillOverlayControl(runner, "Title", "Follow up applicant");
    await fillOverlayControl(
      runner,
      "Prompt content",
      "Draft a candidate follow-up note with next steps.",
    );
    await clickOverlayButtonByText(runner, "Save");
    await waitForLocalArrayItemMatch(runner, "opensidebar:savedPrompts", {
      title: "Follow up applicant",
      content: "Draft a candidate follow-up note with next steps.",
    });

    await clickOverlayText(runner, "Follow up applicant");
    await waitForOverlayTextareaValue(
      runner,
      "What can I help with?",
      "Draft a candidate follow-up note with next steps.",
    );

    await runner.clickOverlayButton("Saved Prompts");
    await runner.clickOverlayButton("Delete Follow up applicant");
    await waitForLocalArrayMissing(runner, "opensidebar:savedPrompts", {
      title: "Follow up applicant",
    });
    await runner.waitForOverlayText("No saved prompts yet");
    expect(runner.pageErrors).toEqual([]);
  }, 120_000);

  it("records, reviews, saves, and lists a website skill through the exposed panel", async () => {
    const runner = await setupRunner();
    await runner.startMessageCapture();

    await runner.clickOverlayButton("Website Skills");
    await clickOverlayButtonByText(runner, "Record Skill");
    await runner.waitForOverlayText("Teach a website workflow");
    await clickOverlayButtonByText(runner, "Start recording");
    await runner.waitForFakeBackgroundHandled("SKILL_RECORDING_START");
    await runner.waitForOverlayText("Recording site skill");

    await clickOverlayButtonByText(runner, "Stop");
    await runner.waitForFakeBackgroundHandled("SKILL_RECORDING_STOP");
    await runner.waitForOverlayText("Review recorded skill");
    await runner.waitForOverlayText("Choose answers on quiz page");
    await runner.waitForOverlayText("/course/*/learn/quiz/*");
    await runner.waitForOverlayText("Trigger: choose answers");
    await runner.waitForOverlayText("Guardrails");
    await runner.waitForOverlayText("Do not submit, finish, grade");
    await runner.waitForOverlayText("No typed values captured.");
    await waitForOverlayTextAbsent(runner, "AWS Trainium");

    await clickOverlayButtonByText(runner, "Show captured details");
    await runner.waitForOverlayText('Checked "AWS Trainium"');
    await runner.waitForOverlayText('Checked "Amazon SageMaker JumpStart"');
    await clickOverlayButtonByText(runner, "Hide details");
    await waitForOverlayTextAbsent(runner, "AWS Trainium");

    await clickOverlayButtonByText(runner, "Edit");
    await fillOverlayControl(runner, "Skill name", "Canceled review name");
    await clickOverlayButtonByText(runner, "Cancel");
    await waitForOverlayTextAbsent(runner, "Canceled review name");

    await clickOverlayButtonByText(runner, "Edit");
    await fillOverlayControl(runner, "Skill name", "Choose answers safely");
    await fillOverlayControl(runner, "Trigger phrase", "choose answers safely");
    await fillOverlayControl(
      runner,
      "Workflow steps",
      "Find requested answer options.\nSelect only requested answers.\nVerify selected answers.",
    );
    await fillOverlayControl(
      runner,
      "Guardrails",
      "Do not submit the quiz.\nDo not infer missing answers.",
    );
    await fillOverlayControl(
      runner,
      "Required evidence",
      "Requested answers are selected.\nThe quiz was not submitted.",
    );
    await clickOverlayButtonByText(runner, "Save");
    await runner.waitForOverlayText("Choose answers safely");

    await clickOverlayButtonByText(runner, "Save Skill");
    await runner.waitForFakeBackgroundHandled("USER_SKILL_SAVE");
    await waitForLocalArrayItem(
      runner,
      "opensidebar:userWebsiteSkills",
      "name",
      "Choose answers safely",
    );

    await runner.clickOverlayButton("Website Skills");
    await runner.waitForOverlayText("Choose answers safely");

    await runner.clickOverlayButton("Edit Choose answers safely");
    await fillOverlayControl(runner, "Skill name", "Updated harness workflow");
    await fillOverlayControl(runner, "Trigger phrase", "updated harness");
    await fillOverlayControl(runner, "Path pattern", "/course/*/learn/quiz/*");
    await fillOverlayControl(
      runner,
      "Guardrails",
      "Do not submit the quiz.\nDo not choose unrelated answers.",
    );
    await clickOverlayButtonByText(runner, "Save");
    await waitForLocalArrayItemMatch(
      runner,
      "opensidebar:userWebsiteSkills",
      {
        name: "Updated harness workflow",
        triggerPhrase: "updated harness",
        pathPattern: "/course/*/learn/quiz/*",
      },
    );
    await runner.waitForOverlayText("Do not submit the quiz.");

    await setOverlayCheckboxByLabel(runner, "On", false);
    await waitForLocalArrayItemMatch(
      runner,
      "opensidebar:userWebsiteSkills",
      {
        name: "Updated harness workflow",
        enabled: false,
      },
    );

    await runner.clickOverlayButton("Delete Updated harness workflow");
    await waitForLocalArrayMissing(runner, "opensidebar:userWebsiteSkills", {
      name: "Updated harness workflow",
    });
    await runner.waitForOverlayText("No website skills yet");

    await clickOverlayButtonByText(runner, "Record Skill");
    await runner.waitForOverlayText("Teach a website workflow");
    await clickOverlayButtonByText(runner, "Start recording");
    await runner.waitForOverlayText("Recording site skill");
    await clickOverlayButtonByText(runner, "Stop");
    await runner.waitForOverlayText("Review recorded skill");
    await clickOverlayButtonByText(runner, "Discard");
    await waitForOverlayTextAbsent(runner, "Review recorded skill");

    const capture = await runner.readMessageCapture();
    expect(capture.outboundTypes).toEqual(
      expect.arrayContaining([
        "SKILL_RECORDING_START",
        "SKILL_RECORDING_STOP",
        "USER_SKILL_SAVE",
      ]),
    );
    expect(runner.pageErrors).toEqual([]);
  }, 120_000);

  it("cancels an in-progress website skill recording through the exposed panel", async () => {
    const runner = await setupRunner();
    await runner.startMessageCapture();

    await runner.clickOverlayButton("Website Skills");
    await clickOverlayButtonByText(runner, "Record Skill");
    await runner.waitForOverlayText("Teach a website workflow");
    await clickOverlayButtonByText(runner, "Start recording");
    await runner.waitForOverlayText("Recording site skill");

    await clickOverlayButtonByText(runner, "Cancel");
    await runner.waitForFakeBackgroundHandled("SKILL_RECORDING_CANCEL");
    await waitForOverlayTextAbsent(runner, "Recording site skill");

    const capture = await runner.readMessageCapture();
    expect(capture.outboundTypes).toEqual(
      expect.arrayContaining([
        "SKILL_RECORDING_START",
        "SKILL_RECORDING_CANCEL",
      ]),
    );
    expect(runner.pageErrors).toEqual([]);
  }, 120_000);

  it("surfaces a restricted-page skill recording failure without losing panel control", async () => {
    const runner = await setupRunner({
      autoStartFakeBackground: {
        failSkillRecordingStart: true,
        skillRecordingStartFailureDetail: "Recording paused on restricted page",
      },
    });

    await runner.clickOverlayButton("Website Skills");
    await clickOverlayButtonByText(runner, "Record Skill");
    await runner.waitForOverlayText("Teach a website workflow");
    await clickOverlayButtonByText(runner, "Start recording");
    await runner.waitForFakeBackgroundHandled("SKILL_RECORDING_START");
    await runner.waitForOverlayText("Recording paused on restricted page");

    await clickOverlayButtonByText(runner, "Cancel");
    await runner.waitForFakeBackgroundHandled("SKILL_RECORDING_CANCEL");
    await waitForOverlayTextAbsent(runner, "Recording paused on restricted page");
    expect(runner.pageErrors).toEqual([]);
  }, 120_000);
});

async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new Error(
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function clickOverlayButtonByText(
  runner: OverlayHarnessRunner,
  text: string,
): Promise<void> {
  const handle = await runner.page.waitForFunction(
    (expectedText) => {
      const root = document.getElementById("opensidebar-harness-host")
        ?.shadowRoot;
      const normalize = (value: string | null | undefined) =>
        (value ?? "").replace(/\s+/g, " ").trim();
      return (
        Array.from(root?.querySelectorAll("button") ?? []).find((button) =>
          normalize(button.textContent).includes(expectedText),
        ) ?? false
      );
    },
    {},
    text,
  );
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    throw new Error(`Overlay button text was not found: ${text}`);
  }
  try {
    await element.click();
  } finally {
    await element.dispose();
  }
}

async function fillOverlayControl(
  runner: OverlayHarnessRunner,
  labelOrPlaceholder: string,
  value: string,
): Promise<void> {
  await runner.page.waitForFunction(
    (target) => {
      const root = document.getElementById("opensidebar-harness-host")
        ?.shadowRoot;
      if (!root) return false;
      const normalize = (text: string | null | undefined) =>
        (text ?? "").replace(/\s+/g, " ").trim();
      return Boolean(
        Array.from(root.querySelectorAll("label")).find((label) =>
          normalize(label.textContent).includes(target),
        ) ||
          Array.from(root.querySelectorAll("input, textarea")).find(
            (control) =>
              control instanceof HTMLInputElement ||
              control instanceof HTMLTextAreaElement
                ? control.placeholder === target
                : false,
          ),
      );
    },
    {},
    labelOrPlaceholder,
  );

  await runner.page.evaluate(
    ({ target, nextValue }) => {
      const root = document.getElementById("opensidebar-harness-host")
        ?.shadowRoot;
      if (!root) throw new Error("Overlay root was not found.");
      const normalize = (text: string | null | undefined) =>
        (text ?? "").replace(/\s+/g, " ").trim();
      const label = Array.from(root.querySelectorAll("label")).find((item) =>
        normalize(item.textContent).includes(target),
      );
      const control =
        label?.querySelector("input, textarea, select") ??
        label?.parentElement?.querySelector("input, textarea, select") ??
        Array.from(root.querySelectorAll("input, textarea")).find((item) =>
          item instanceof HTMLInputElement ||
          item instanceof HTMLTextAreaElement
            ? item.placeholder === target
            : false,
        );
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLSelectElement
        )
      ) {
        throw new Error(`Overlay control was not found: ${target}`);
      }
      const prototype =
        control instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : control instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(
        prototype,
        "value",
      )?.set;
      valueSetter?.call(control, nextValue);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { target: labelOrPlaceholder, nextValue: value },
  );
}

async function waitForStoragePath(
  runner: OverlayHarnessRunner,
  area: "local" | "sync" | "session",
  key: string,
  path: string[],
  expected: unknown,
): Promise<void> {
  await runner.page.waitForFunction(
    ({ storageArea, storageKey, valuePath, expectedValue }) => {
      const runtime = window.__opensidebarOverlayRuntime;
      let current = runtime?.getStorageSnapshot(storageArea)[storageKey];
      for (const segment of valuePath) {
        current = (current as Record<string, unknown> | undefined)?.[segment];
      }
      return current === expectedValue;
    },
    {},
    {
      storageArea: area,
      storageKey: key,
      valuePath: path,
      expectedValue: expected,
    },
  );
}

async function waitForStorageStringPrefix(
  runner: OverlayHarnessRunner,
  area: "local" | "sync" | "session",
  key: string,
  path: string[],
  prefix: string,
): Promise<void> {
  await runner.page.waitForFunction(
    ({ storageArea, storageKey, valuePath, expectedPrefix }) => {
      const runtime = window.__opensidebarOverlayRuntime;
      let current = runtime?.getStorageSnapshot(storageArea)[storageKey];
      for (const segment of valuePath) {
        current = (current as Record<string, unknown> | undefined)?.[segment];
      }
      return (
        typeof current === "string" && current.startsWith(expectedPrefix)
      );
    },
    {},
    {
      storageArea: area,
      storageKey: key,
      valuePath: path,
      expectedPrefix: prefix,
    },
  );
}

async function waitForStorageKeyMissing(
  runner: OverlayHarnessRunner,
  area: "local" | "sync" | "session",
  key: string,
): Promise<void> {
  await runner.page.waitForFunction(
    ({ storageArea, storageKey }) => {
      const runtime = window.__opensidebarOverlayRuntime;
      return runtime?.getStorageSnapshot(storageArea)[storageKey] === undefined;
    },
    {},
    {
      storageArea: area,
      storageKey: key,
    },
  );
}

async function waitForLocalArrayItem(
  runner: OverlayHarnessRunner,
  key: string,
  field: string,
  expected: string,
): Promise<void> {
  await runner.page.waitForFunction(
    ({ storageKey, itemField, expectedValue }) => {
      const runtime = window.__opensidebarOverlayRuntime;
      const items = runtime?.getStorageSnapshot("local")[storageKey];
      return (
        Array.isArray(items) &&
        items.some(
          (item) =>
            (item as Record<string, unknown>)[itemField] === expectedValue,
        )
      );
    },
    {},
    { storageKey: key, itemField: field, expectedValue: expected },
  );
}

async function waitForLocalArrayItemMatch(
  runner: OverlayHarnessRunner,
  key: string,
  expectedFields: Record<string, unknown>,
): Promise<void> {
  await runner.page.waitForFunction(
    ({ storageKey, expected }) => {
      const runtime = window.__opensidebarOverlayRuntime;
      const items = runtime?.getStorageSnapshot("local")[storageKey];
      return (
        Array.isArray(items) &&
        items.some((item) => {
          if (!item || typeof item !== "object") return false;
          return Object.entries(expected).every(
            ([field, value]) =>
              (item as Record<string, unknown>)[field] === value,
          );
        })
      );
    },
    {},
    { storageKey: key, expected: expectedFields },
  );
}

async function waitForLocalArrayMissing(
  runner: OverlayHarnessRunner,
  key: string,
  expectedFields: Record<string, unknown>,
): Promise<void> {
  await runner.page.waitForFunction(
    ({ storageKey, expected }) => {
      const runtime = window.__opensidebarOverlayRuntime;
      const items = runtime?.getStorageSnapshot("local")[storageKey];
      return (
        Array.isArray(items) &&
        !items.some((item) => {
          if (!item || typeof item !== "object") return false;
          return Object.entries(expected).every(
            ([field, value]) =>
              (item as Record<string, unknown>)[field] === value,
          );
        })
      );
    },
    {},
    { storageKey: key, expected: expectedFields },
  );
}

async function waitForOverlayTextAbsent(
  runner: OverlayHarnessRunner,
  text: string,
): Promise<void> {
  await runner.page.waitForFunction(
    (expectedText) => {
      const root = document.getElementById("opensidebar-harness-host")
        ?.shadowRoot;
      return !root?.textContent?.includes(expectedText);
    },
    {},
    text,
  );
}

async function clickOverlayText(
  runner: OverlayHarnessRunner,
  text: string,
): Promise<void> {
  const handle = await runner.page.waitForFunction(
    (expectedText) => {
      const root = document.getElementById("opensidebar-harness-host")
        ?.shadowRoot;
      const normalize = (value: string | null | undefined) =>
        (value ?? "").replace(/\s+/g, " ").trim();
      return (
        Array.from(
          root?.querySelectorAll("button, summary, [role='button'], div") ?? [],
        )
          .filter((element) => normalize(element.textContent).includes(expectedText))
          .sort(
            (left, right) =>
              normalize(left.textContent).length -
              normalize(right.textContent).length,
          )[0] ?? false
      );
    },
    {},
    text,
  );
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    throw new Error(`Overlay text target was not found: ${text}`);
  }
  try {
    await element.click();
  } finally {
    await element.dispose();
  }
}

async function waitForOverlayTextareaValue(
  runner: OverlayHarnessRunner,
  placeholder: string,
  expected: string,
): Promise<void> {
  await runner.page.waitForFunction(
    ({ targetPlaceholder, expectedValue }) => {
      const root = document.getElementById("opensidebar-harness-host")
        ?.shadowRoot;
      const textarea = Array.from(root?.querySelectorAll("textarea") ?? []).find(
        (item) => item.placeholder === targetPlaceholder,
      );
      return textarea?.value === expectedValue;
    },
    {},
    { targetPlaceholder: placeholder, expectedValue: expected },
  );
}

async function setOverlayCheckboxByLabel(
  runner: OverlayHarnessRunner,
  labelText: string,
  checked: boolean,
): Promise<void> {
  await runner.page.waitForFunction(
    (expectedLabel) => {
      const root = document.getElementById("opensidebar-harness-host")
        ?.shadowRoot;
      const normalize = (value: string | null | undefined) =>
        (value ?? "").replace(/\s+/g, " ").trim();
      return Boolean(
        Array.from(root?.querySelectorAll("label") ?? []).find((label) =>
          normalize(label.textContent).includes(expectedLabel),
        ),
      );
    },
    {},
    labelText,
  );
  await runner.page.evaluate(
    ({ expectedLabel, nextChecked }) => {
      const root = document.getElementById("opensidebar-harness-host")
        ?.shadowRoot;
      if (!root) throw new Error("Overlay root was not found.");
      const normalize = (value: string | null | undefined) =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const label = Array.from(root.querySelectorAll("label")).find((item) =>
        normalize(item.textContent).includes(expectedLabel),
      );
      const checkbox =
        label?.querySelector('input[type="checkbox"]') ??
        label?.parentElement?.querySelector('input[type="checkbox"]') ??
        label?.parentElement?.parentElement?.querySelector(
          'input[type="checkbox"]',
        );
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error(`Overlay checkbox was not found: ${expectedLabel}`);
      }
      if (checkbox.checked === nextChecked) return;
      checkbox.click();
    },
    { expectedLabel: labelText, nextChecked: checked },
  );
}
