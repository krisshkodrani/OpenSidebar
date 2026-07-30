import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "../setup";
import {
  FLEET_TELEMETRY_CONSENT_STORAGE_KEY,
  loadFleetTelemetryConsent,
} from "../../src/background/telemetry";
import { FleetTelemetrySettings } from "../../src/sidepanel/components/settings/FleetTelemetrySettings";
import {
  chromeUiRuntimePort,
  setUiRuntimePortForTesting,
} from "../../src/sidepanel/runtime";
import { createFakeStorageArea } from "../fakes/persistence";

describe("fleet telemetry settings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreRuntime: () => void;
  const local = createFakeStorageArea();

  beforeEach(() => {
    local.store.clear();
    restoreRuntime = setUiRuntimePortForTesting({
      ...chromeUiRuntimePort,
      storage: { ...chromeUiRuntimePort.storage, local },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    restoreRuntime();
    container.remove();
  });

  test("is off by default and shows the prominent disclosure", async () => {
    await act(async () => {
      root.render(<FleetTelemetrySettings />);
      await Promise.resolve();
    });

    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox?.checked).toBe(false);
    expect(container.textContent).toContain("Off by default");
    expect(container.textContent).toContain("Never includes task text");
    expect(container.textContent).toContain(
      "Uploading is not enabled in this build",
    );
    expect(local.store.has(FLEET_TELEMETRY_CONSENT_STORAGE_KEY)).toBe(false);
  });

  test("records affirmative local consent and exposes the example payload", async () => {
    await act(async () => {
      root.render(<FleetTelemetrySettings />);
      await Promise.resolve();
    });

    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await act(async () => {
      checkbox?.click();
      await Promise.resolve();
    });

    expect(await loadFleetTelemetryConsent(local)).toMatchObject({
      status: "enabled",
    });
    expect(checkbox?.checked).toBe(true);

    const exampleButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "View example payload");
    await act(async () => {
      exampleButton?.click();
    });
    expect(container.querySelector("pre")?.textContent).toContain(
      '"taskShape": "single_interaction"',
    );
    expect(container.querySelector("pre")?.textContent).not.toContain("url");
  });
});
