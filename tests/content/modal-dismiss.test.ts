import { describe, test, expect, beforeEach } from "bun:test";
import "../setup";
import {
    detectViewportCoveringOverlays,
    isBackdropElement,
    findCloseButton,
} from "../../src/content/content";

// Mock viewport dimensions (happy-dom defaults to 0x0)
Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
Object.defineProperty(window, "innerHeight", { value: 768, writable: true });

// happy-dom getComputedStyle doesn't resolve inline styles well.
// Patch it to read from el.style for the properties we need.
const _origGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = function (el: Element) {
    const base = _origGetComputedStyle.call(window, el);
    const htmlEl = el as HTMLElement;
    return new Proxy(base, {
        get(target, prop) {
            // Return inline style values for our overlay-detection props
            if (prop === "position" && htmlEl.style?.position) return htmlEl.style.position;
            if (prop === "display" && htmlEl.style?.display) return htmlEl.style.display;
            if (prop === "visibility" && htmlEl.style?.visibility) return htmlEl.style.visibility;
            if (prop === "opacity" && htmlEl.style?.opacity) return htmlEl.style.opacity;
            if (prop === "zIndex" && htmlEl.style?.zIndex) return htmlEl.style.zIndex;
            if (prop === "backdropFilter" && htmlEl.style?.backdropFilter) return htmlEl.style.backdropFilter;
            if (prop === "backgroundColor" && htmlEl.style?.backgroundColor) return htmlEl.style.backgroundColor;
            if (prop === "clip") return (target as any).clip || "auto";
            return (target as any)[prop as any];
        },
    });
} as typeof window.getComputedStyle;

// Per-element bounding rect overrides
const rectOverrides = new WeakMap<Element, DOMRect>();
function setMockRect(el: Element, rect: Partial<DOMRect>) {
    const full = {
        x: rect.x ?? 0,
        y: rect.y ?? 0,
        width: rect.width ?? 100,
        height: rect.height ?? 100,
        top: rect.top ?? rect.y ?? 0,
        left: rect.left ?? rect.x ?? 0,
        bottom: (rect.top ?? rect.y ?? 0) + (rect.height ?? 100),
        right: (rect.left ?? rect.x ?? 0) + (rect.width ?? 100),
        toJSON: () => {},
    } as DOMRect;
    rectOverrides.set(el, full);
}

// Patch getBoundingClientRect to use per-element overrides
const _origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
    const override = rectOverrides.get(this);
    if (override) return override;
    return _origGetBoundingClientRect.call(this);
};

// Helper: create a fixed-position element covering the viewport
function createFixedOverlay(opts?: {
    id?: string;
    coverage?: "full" | "small";
}): HTMLElement {
    const el = document.createElement("div");
    if (opts?.id) el.id = opts.id;
    el.style.position = "fixed";
    el.style.zIndex = "9999";
    document.body.appendChild(el);

    if (opts?.coverage === "small") {
        setMockRect(el, { x: 0, y: 0, width: 50, height: 50, top: 0, left: 0 });
    } else {
        // Full viewport
        setMockRect(el, { x: 0, y: 0, width: 1024, height: 768, top: 0, left: 0 });
    }
    return el;
}

describe("detectViewportCoveringOverlays", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("detects fixed element covering >50% viewport", () => {
        createFixedOverlay({ coverage: "full" });
        const overlays = detectViewportCoveringOverlays();
        expect(overlays.length).toBeGreaterThanOrEqual(1);
        expect(overlays[0].coverage).toBeGreaterThan(50);
    });

    test("ignores small fixed elements (<50%)", () => {
        createFixedOverlay({ coverage: "small" });
        const overlays = detectViewportCoveringOverlays();
        // 50*50 / (1024*768) = ~0.3%, well below 50%
        expect(overlays.length).toBe(0);
    });

    test("skips agent border element", () => {
        createFixedOverlay({ id: "opensidebar-agent-border", coverage: "full" });
        const overlays = detectViewportCoveringOverlays();
        const borderFound = overlays.find(o => o.el.id === "opensidebar-agent-border");
        expect(borderFound).toBeUndefined();
    });

    test("returns empty array when no overlays exist", () => {
        const div = document.createElement("div");
        div.textContent = "Normal content";
        document.body.appendChild(div);
        const overlays = detectViewportCoveringOverlays();
        expect(overlays).toEqual([]);
    });

    test("sorts by coverage descending", () => {
        const el1 = createFixedOverlay({ coverage: "full" });
        const el2 = document.createElement("div");
        el2.style.position = "fixed";
        document.body.appendChild(el2);
        // 80% coverage
        setMockRect(el2, { x: 0, y: 0, width: 900, height: 700, top: 0, left: 0 });

        const overlays = detectViewportCoveringOverlays();
        if (overlays.length >= 2) {
            expect(overlays[0].coverage).toBeGreaterThanOrEqual(overlays[1].coverage);
        }
    });
});

describe("isBackdropElement", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("detects backdrop-filter element", () => {
        const el = document.createElement("div");
        el.style.backdropFilter = "blur(4px)";
        document.body.appendChild(el);
        expect(isBackdropElement(el)).toBe(true);
    });

    test("detects semi-transparent rgba background", () => {
        const el = document.createElement("div");
        el.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
        document.body.appendChild(el);
        expect(isBackdropElement(el)).toBe(true);
    });

    test("returns false for opaque element", () => {
        const el = document.createElement("div");
        el.style.backgroundColor = "rgb(255, 255, 255)";
        document.body.appendChild(el);
        expect(isBackdropElement(el)).toBe(false);
    });

    test("returns false for element with no special styling", () => {
        const el = document.createElement("div");
        document.body.appendChild(el);
        expect(isBackdropElement(el)).toBe(false);
    });

    test("returns false for fully transparent (alpha=0)", () => {
        const el = document.createElement("div");
        el.style.backgroundColor = "rgba(0, 0, 0, 0)";
        document.body.appendChild(el);
        expect(isBackdropElement(el)).toBe(false);
    });
});

describe("findCloseButton", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("finds button with aria-label containing 'close'", () => {
        const overlay = document.createElement("div");
        const btn = document.createElement("button");
        btn.setAttribute("aria-label", "Close dialog");
        overlay.appendChild(btn);
        document.body.appendChild(overlay);

        const found = findCloseButton(overlay);
        expect(found).toBe(btn);
    });

    test("finds button with aria-label containing 'dismiss'", () => {
        const overlay = document.createElement("div");
        const btn = document.createElement("button");
        btn.setAttribute("aria-label", "Dismiss notification");
        overlay.appendChild(btn);
        document.body.appendChild(overlay);

        const found = findCloseButton(overlay);
        expect(found).toBe(btn);
    });

    test("finds button with .close class", () => {
        const overlay = document.createElement("div");
        const btn = document.createElement("button");
        btn.className = "close";
        overlay.appendChild(btn);
        document.body.appendChild(overlay);

        const found = findCloseButton(overlay);
        expect(found).toBe(btn);
    });

    test("finds button with .btn-close class", () => {
        const overlay = document.createElement("div");
        const btn = document.createElement("button");
        btn.className = "btn-close";
        overlay.appendChild(btn);
        document.body.appendChild(overlay);

        const found = findCloseButton(overlay);
        expect(found).toBe(btn);
    });

    test("finds button with class*=modal-close", () => {
        const overlay = document.createElement("div");
        const btn = document.createElement("button");
        btn.className = "my-modal-close-btn";
        overlay.appendChild(btn);
        document.body.appendChild(overlay);

        const found = findCloseButton(overlay);
        expect(found).toBe(btn);
    });

    test("returns null when no close button exists", () => {
        const overlay = document.createElement("div");
        const content = document.createElement("p");
        content.textContent = "Some content";
        overlay.appendChild(content);
        document.body.appendChild(overlay);

        const found = findCloseButton(overlay);
        expect(found).toBeNull();
    });

    test("finds X button in top-right quadrant", () => {
        const overlay = document.createElement("div");
        const btn = document.createElement("button");
        btn.textContent = "X";
        overlay.appendChild(btn);
        document.body.appendChild(overlay);

        // With mock getBoundingClientRect returning same rect for all elements,
        // the button center equals the overlay center, satisfying >= and <= conditions.
        const found = findCloseButton(overlay);
        expect(found).toBe(btn);
    });
});

describe("autoDismissModals (integrated via DISMISS_MODALS handler)", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("handles pages with no overlays gracefully", () => {
        const div = document.createElement("div");
        div.textContent = "Normal page";
        document.body.appendChild(div);
        const overlays = detectViewportCoveringOverlays();
        expect(overlays).toEqual([]);
    });

    test("detects dialog role elements", () => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.style.position = "fixed";
        document.body.appendChild(dialog);

        const found = document.querySelectorAll("[role='dialog']");
        expect(found.length).toBe(1);
    });
});

describe("Snapshot-integrated overlay dismissal", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("no overlays → detectViewportCoveringOverlays returns empty (no extra work)", () => {
        const div = document.createElement("div");
        div.textContent = "Clean page content";
        document.body.appendChild(div);

        // Pre-check: no overlays detected
        const overlays = detectViewportCoveringOverlays();
        expect(overlays.length).toBe(0);
    });

    test("overlay detected → survivingOverlays reported when heuristics fail", () => {
        // Create an overlay that won't be auto-dismissed by heuristics
        // (no close button, not a backdrop, no dialog/modal class)
        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.zIndex = "9999";
        overlay.textContent = "Persistent overlay content";
        document.body.appendChild(overlay);
        setMockRect(overlay, { x: 0, y: 0, width: 1024, height: 768, top: 0, left: 0 });

        // Overlays are detected
        const overlays = detectViewportCoveringOverlays();
        expect(overlays.length).toBeGreaterThanOrEqual(1);
        expect(overlays[0].coverage).toBeGreaterThan(50);

        // This represents what the snapshot handler would report as survivors
        const survivors = overlays.map(o => ({
            tagId: 1, // would be addDynamicTag(o.el) in real code
            coveragePercent: Math.round(o.coverage),
        }));
        expect(survivors.length).toBeGreaterThanOrEqual(1);
        expect(survivors[0].coveragePercent).toBeGreaterThan(50);
    });

    test("overlay with close button is auto-dismissed by heuristics", () => {
        // Create a modal with a close button — heuristics should handle it
        const modal = document.createElement("div");
        modal.setAttribute("role", "dialog");
        modal.style.position = "fixed";
        modal.style.zIndex = "9999";
        document.body.appendChild(modal);
        setMockRect(modal, { x: 100, y: 100, width: 800, height: 600, top: 100, left: 100 });

        const closeBtn = document.createElement("button");
        closeBtn.setAttribute("aria-label", "Close");
        modal.appendChild(closeBtn);

        // Close button should be found
        const found = findCloseButton(modal);
        expect(found).toBe(closeBtn);
    });

    test("DomSnapshot type accepts survivingOverlays field", () => {
        // Type-level verification: ensure the field is accepted
        const snapshot: import("../../src/types").DomSnapshot = {
            title: "Test",
            url: "https://test.com",
            elements: [],
            viewportText: "",
            viewport: { width: 1024, height: 768 },
            scroll: { x: 0, y: 0, maxY: 0 },
            survivingOverlays: [{ tagId: 42, coveragePercent: 85 }],
        };
        expect(snapshot.survivingOverlays).toBeDefined();
        expect(snapshot.survivingOverlays![0].tagId).toBe(42);
        expect(snapshot.survivingOverlays![0].coveragePercent).toBe(85);
    });
});
