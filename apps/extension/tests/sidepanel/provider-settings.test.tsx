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

  test("shows setup guidance when no OpenRouter key is configured", async () => {
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

    expect(container.textContent).toContain("Connect OpenRouter");
    expect(container.textContent).not.toContain("Advanced model settings");
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
  });

  test("offers only OpenRouter and keeps advanced controls collapsed", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <ModelsSettingsTab
          formState={{
            ...DEFAULT_SETTINGS,
            openRouterApiKey: "sk-or-test",
          }}
          models={[]}
          modelsLoading={false}
          onChange={onChange}
        />,
      );
    });

    const rows = container.querySelectorAll("details > summary");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("OpenRouter");
    expect(rows[1]?.textContent).toContain("Advanced model settings");
    expect(container.querySelectorAll("details")[1]?.hasAttribute("open")).toBe(
      false,
    );
    expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
    expect(container.textContent).not.toContain("Choose which provider");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("editing the key reports the openRouterApiKey field", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <ModelsSettingsTab
          formState={{ ...DEFAULT_SETTINGS, openRouterApiKey: "" }}
          models={[]}
          modelsLoading={false}
          onChange={onChange}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      "#provider-key-openRouterApiKey",
    );
    expect(input).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(input, "sk-or-new");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("openRouterApiKey", "sk-or-new");
  });
});
