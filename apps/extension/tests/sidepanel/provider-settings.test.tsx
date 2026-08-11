import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import "../setup";
import { ModelsSettingsTab } from "../../src/sidepanel/components/settings/ModelsSettingsTab";
import { DEFAULT_SETTINGS } from "../../src/sidepanel/store/settings-slice";

describe("key-driven provider settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("shows setup guidance instead of unavailable provider choices", async () => {
    await act(async () => {
      root.render(
        <ModelsSettingsTab
          formState={{ ...DEFAULT_SETTINGS, openRouterApiKey: "" }}
          models={[]}
          modelsLoading={false}
          onChange={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("Connect an AI provider");
    expect(
      container.querySelectorAll('button[aria-pressed="false"]'),
    ).toHaveLength(0);
    expect(container.textContent).not.toContain("OpenAI-Compatible");
    expect(container.textContent).not.toContain("Gemini");
  });

  test("shows only release-verified providers and keeps advanced controls collapsed", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <ModelsSettingsTab
          formState={{
            ...DEFAULT_SETTINGS,
            openRouterApiKey: "sk-or-test",
            groqApiKey: "gsk-test",
            providerMode: "openrouter",
          }}
          models={[]}
          modelsLoading={false}
          onChange={onChange}
        />,
      );
    });

    const stackButtons = container.querySelectorAll("button[aria-pressed]");
    const connectionRows = container.querySelectorAll("details > summary");
    expect(connectionRows).toHaveLength(3);
    expect(connectionRows[0]?.textContent).toContain("OpenRouter");
    expect(connectionRows[1]?.textContent).toContain("Fireworks");
    expect(connectionRows[2]?.textContent).toContain("Advanced model settings");
    expect(container.querySelectorAll("details")[2]?.hasAttribute("open")).toBe(
      false,
    );
    expect(stackButtons).toHaveLength(1);
    expect(stackButtons[0]?.textContent).toContain("OpenRouter");
    expect(container.textContent).not.toContain("OpenRouter + Groq");
    expect(container.textContent).not.toContain("Fireworks + DeepSeek");
    expect(container.textContent).not.toContain("Moonshot AI");
    expect(container.textContent).not.toContain("Xiaomi MiMo");
    expect(onChange).not.toHaveBeenCalled();
  });
});
