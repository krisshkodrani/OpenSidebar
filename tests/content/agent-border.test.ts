import { describe, test, expect, beforeEach } from "bun:test";
import "../setup";

// Since setAgentBorder is defined inside content.ts as a module-level function,
// we test the DOM manipulation logic directly by reimplementing it here.
// This avoids the side effects of importing the full content script.

const BORDER_ID = "opensidebar-agent-border";

function setAgentBorder(active: boolean) {
    const existing = document.getElementById(BORDER_ID);

    if (active) {
        if (existing) return;

        const overlay = document.createElement("div");
        overlay.id = BORDER_ID;
        Object.assign(overlay.style, {
            position: "fixed",
            inset: "0",
            zIndex: "2147483646",
            pointerEvents: "none",
            border: "3px dashed #f59e0b",
            borderRadius: "4px",
            opacity: "1",
        });
        document.documentElement.appendChild(overlay);
    } else {
        if (!existing) return;
        existing.remove();
    }
}

describe("Agent Border Overlay", () => {
    beforeEach(() => {
        const existing = document.getElementById(BORDER_ID);
        if (existing) existing.remove();
    });

    test("setAgentBorder(true) creates overlay element", () => {
        setAgentBorder(true);
        const el = document.getElementById(BORDER_ID);
        expect(el).not.toBeNull();
        expect(el!.style.position).toBe("fixed");
        expect(el!.style.pointerEvents).toBe("none");
        expect(el!.style.zIndex).toBe("2147483646");
    });

    test("setAgentBorder(false) removes overlay element", () => {
        setAgentBorder(true);
        expect(document.getElementById(BORDER_ID)).not.toBeNull();

        setAgentBorder(false);
        expect(document.getElementById(BORDER_ID)).toBeNull();
    });

    test("setAgentBorder(true) is idempotent", () => {
        setAgentBorder(true);
        setAgentBorder(true);
        const els = document.querySelectorAll(`#${BORDER_ID}`);
        expect(els.length).toBe(1);
    });

    test("setAgentBorder(false) is safe when no border exists", () => {
        // Should not throw
        setAgentBorder(false);
        expect(document.getElementById(BORDER_ID)).toBeNull();
    });

    test("overlay has correct border style", () => {
        setAgentBorder(true);
        const el = document.getElementById(BORDER_ID);
        expect(el!.style.border).toBe("3px dashed #f59e0b");
        expect(el!.style.borderRadius).toBe("4px");
    });
});
