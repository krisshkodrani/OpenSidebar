import { describe, test, expect, beforeEach } from "vitest";
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

    test("captures non-English page language from <html lang>", () => {
        document.documentElement.lang = "de";
        const snapshot = buildSnapshot(true);
        expect(snapshot.lang).toBe("de");
        document.documentElement.lang = "";
    });

    test("omits lang for English pages", () => {
        document.documentElement.lang = "en";
        const snapshot = buildSnapshot(true);
        expect(snapshot.lang).toBeUndefined();
        document.documentElement.lang = "";
    });

    test("extracts base language from full locale tag", () => {
        document.documentElement.lang = "pt-BR";
        const snapshot = buildSnapshot(true);
        expect(snapshot.lang).toBe("pt");
        document.documentElement.lang = "";
    });

    test("captures RTL dir attribute", () => {
        document.documentElement.lang = "ar";
        document.documentElement.dir = "rtl";
        const snapshot = buildSnapshot(true);
        expect(snapshot.lang).toBe("ar");
        expect(snapshot.dir).toBe("rtl");
        document.documentElement.lang = "";
        document.documentElement.dir = "";
    });
});
