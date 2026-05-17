import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRoot, type Root } from "react-dom/client";

import "../setup";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  UiPortalProvider,
  useUiPortalContainer,
} from "../../src/ui";

function PortalConsumer() {
  const container = useUiPortalContainer();
  return <div data-container-id={container?.id ?? "none"} />;
}

describe("UiPortalProvider", () => {
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
    document.body.replaceChildren();
  });

  test("exposes the supplied portal container", async () => {
    const portalRoot = document.createElement("div");
    portalRoot.id = "shadow-portal";

    await act(async () => {
      root.render(
        <UiPortalProvider container={portalRoot}>
          <PortalConsumer />
        </UiPortalProvider>,
      );
    });

    expect(container.querySelector("[data-container-id]")?.getAttribute("data-container-id")).toBe(
      "shadow-portal",
    );
  });

  test("keeps Radix dialog portals inside the supplied shadow root portal element", async () => {
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const portalRoot = document.createElement("div");
    portalRoot.id = "overlay-portal";
    shadowRoot.appendChild(portalRoot);
    document.body.appendChild(host);

    await act(async () => {
      root.render(
        <UiPortalProvider container={portalRoot}>
          <Dialog open>
            <DialogContent>
              <DialogTitle>Portal title</DialogTitle>
              <p>Portal body</p>
            </DialogContent>
          </Dialog>
        </UiPortalProvider>,
      );
    });

    expect(portalRoot.textContent).toContain("Portal title");
    expect(portalRoot.textContent).toContain("Portal body");
    expect(document.body.textContent).not.toContain("Portal title");
  });
});
