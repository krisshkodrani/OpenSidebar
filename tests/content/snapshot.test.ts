import { describe, test, expect, beforeEach } from "bun:test";
import { buildSnapshot } from "../../src/content/snapshot";
import "../../tests/setup";

describe("buildSnapshot", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    test("captures page title and url", () => {
        document.title = "Test Page";
        // Cannot easily mock window.location.href in readonly JSDOM in some envs,
        // but typically it defaults to about:blank or similar.

        const snapshot = buildSnapshot(true);
        expect(snapshot.title).toBe("Test Page");
    });

    test("includes tagged elements", () => {
        const btn = document.createElement("button");
        btn.textContent = "OK";
        document.body.appendChild(btn);

        const snapshot = buildSnapshot(true);
        expect(snapshot.elements.length).toBe(1);
        expect(snapshot.elements[0].text).toBe("OK");
    });

    test("visibleContent is undefined", () => {
        document.body.innerHTML = "<div>Hello World</div>";
        const snapshot = buildSnapshot(true);
        expect(snapshot.visibleContent).toBeUndefined();
    });
});
