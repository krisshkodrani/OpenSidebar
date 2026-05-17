import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createOpenSidebarOverlayHost,
  OPENSIDEBAR_OVERLAY_HOST_ID,
} from "../../src/overlay/host";

describe("overlay host", () => {
  afterEach(() => {
    document.getElementById(OPENSIDEBAR_OVERLAY_HOST_ID)?.remove();
  });

  test("creates a single Shadow DOM host with a sidepanel mount", () => {
    const overlay = createOpenSidebarOverlayHost({
      sidepanelCss: ".probe { color: red; }",
    });
    const second = createOpenSidebarOverlayHost();

    expect(overlay.host).toBe(second.host);
    expect(document.getElementById(OPENSIDEBAR_OVERLAY_HOST_ID)).toBe(
      overlay.host,
    );
    expect(overlay.shadowRoot).toBeTruthy();
    expect(overlay.mountElement.id).toBe("root");
    expect(overlay.portalElement.dataset.osbOverlayPortal).toBe("");
    expect(overlay.portalElement.getRootNode()).toBe(overlay.shadowRoot);
    expect(overlay.shadowRoot.textContent).toContain(".probe");
  });

  test("minimizes, restores, and closes from host controls", () => {
    const onClose = vi.fn();
    const overlay = createOpenSidebarOverlayHost({ onClose });
    const minimize = overlay.shadowRoot.querySelector(
      "[data-osb-minimize]",
    ) as HTMLButtonElement;
    const close = overlay.shadowRoot.querySelector(
      "[data-osb-close]",
    ) as HTMLButtonElement;

    minimize.click();
    expect(overlay.host.getAttribute("data-minimized")).toBe("true");
    expect(overlay.host.style.height).toBe("34px");

    minimize.click();
    expect(overlay.host.hasAttribute("data-minimized")).toBe(false);
    expect(overlay.host.style.height).not.toBe("34px");

    close.click();
    expect(document.getElementById(OPENSIDEBAR_OVERLAY_HOST_ID)).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("drag handle moves the host inside the viewport", () => {
    const overlay = createOpenSidebarOverlayHost();
    const titlebar = overlay.shadowRoot.querySelector(
      "[data-osb-drag-handle]",
    ) as HTMLElement;
    const startLeft = Number.parseFloat(overlay.host.style.left);

    titlebar.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 60,
        clientY: 140,
      }),
    );
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(Number.parseFloat(overlay.host.style.left)).toBeLessThan(startLeft);
    expect(Number.parseFloat(overlay.host.style.top)).toBeGreaterThanOrEqual(
      16,
    );
  });

  test("docks the overlay left and right for dense pages", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1400,
    });

    try {
      const overlay = createOpenSidebarOverlayHost();
      const dock = overlay.shadowRoot.querySelector(
        "[data-osb-dock]",
      ) as HTMLButtonElement;

      expect(overlay.host.dataset.dock).toBe("right");
      dock.click();
      expect(overlay.host.dataset.dock).toBe("left");
      expect(overlay.host.style.left).toBe("16px");
      expect(dock.getAttribute("aria-label")).toContain("right side");

      dock.click();
      expect(overlay.host.dataset.dock).toBe("right");
      expect(Number.parseFloat(overlay.host.style.left)).toBeGreaterThan(900);
      expect(dock.getAttribute("aria-label")).toContain("left side");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  test("marks E2E glass overlays for scoped translucent styling", () => {
    const overlay = createOpenSidebarOverlayHost({ glass: true });

    expect(overlay.host.getAttribute("data-glass")).toBe("true");
    expect(overlay.shadowRoot.textContent).toContain("backdrop-filter");
  });

  test("sizes the initial overlay to about 95vh while respecting gutters", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1400,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1000,
    });

    try {
      const overlay = createOpenSidebarOverlayHost();

      expect(overlay.host.style.height).toBe("950px");
      expect(overlay.host.style.top).toBe("25px");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
    }
  });
});
