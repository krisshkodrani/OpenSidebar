import { describe, test, expect, beforeEach } from "bun:test";
import "../setup";
import { ToolName } from "../../src/types";
import { executeAction, isLikelyOverlay } from "../../src/content/actions";
import { tagElements, getTagMap, addDynamicTag, resetStableIds } from "../../src/content/tagging";

describe("Content Actions", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        resetStableIds();
        tagElements(false);
    });

    describe("executeFindElement", () => {
        test("returns not-found when text doesn't exist", async () => {
            document.body.innerHTML = "<p>Hello world</p>";
            resetStableIds();
            tagElements(false);

            const origFind = (window as any).find;
            (window as any).find = () => false;

            try {
                const result = await executeAction(ToolName.FIND_ELEMENT, { text: "nonexistent" });
                expect(result.success).toBe(false);
                expect(result.result).toContain("not found");
                expect(result.navigated).toBe(false);
            } finally {
                (window as any).find = origFind;
            }
        });

        test("returns tag ID when text is found inside a semantic element", async () => {
            document.body.innerHTML = `
                <div>
                    <p id="target">The answer to the riddle is 42</p>
                    <button>Submit</button>
                </div>
            `;
            resetStableIds();
            tagElements(false);

            const origFind = (window as any).find;
            (window as any).find = (text: string) => {
                const p = document.getElementById("target")!;
                const textNode = p.firstChild!;
                const sel = window.getSelection()!;
                sel.removeAllRanges();
                const range = document.createRange();
                range.setStart(textNode, 0);
                range.setEnd(textNode, text.length);
                sel.addRange(range);
                return true;
            };

            try {
                const result = await executeAction(ToolName.FIND_ELEMENT, { text: "The answer" });
                expect(result.success).toBe(true);
                expect(result.result).toContain("Found");
                expect(result.result).toContain("Use tag");
                expect(result.result).toMatch(/\[\d+\]/);
                expect(result.result).toContain("<p>");
                expect(result.navigated).toBe(false);
            } finally {
                (window as any).find = origFind;
            }
        });

        test("walks up to nearest interactive element when text is inside one", async () => {
            document.body.innerHTML = `
                <div>
                    <a href="/link" id="link-el"><span id="inner">Click me</span></a>
                </div>
            `;
            resetStableIds();
            tagElements(false);

            const origFind = (window as any).find;
            (window as any).find = (text: string) => {
                const span = document.getElementById("inner")!;
                const textNode = span.firstChild!;
                const sel = window.getSelection()!;
                sel.removeAllRanges();
                const range = document.createRange();
                range.setStart(textNode, 0);
                range.setEnd(textNode, text.length);
                sel.addRange(range);
                return true;
            };

            try {
                const result = await executeAction(ToolName.FIND_ELEMENT, { text: "Click me" });
                expect(result.success).toBe(true);
                expect(result.result).toContain("<a>");
                expect(result.result).toMatch(/\[\d+\]/);
            } finally {
                (window as any).find = origFind;
            }
        });

        test("drills down from container to interactive child containing text", async () => {
            document.body.innerHTML = `
                <p id="container">Click <a href="/action" id="inner-link">here</a> to continue</p>
            `;
            resetStableIds();
            tagElements(false);

            const origFind = (window as any).find;
            (window as any).find = (text: string) => {
                // Simulate finding "here" inside the <p> text (lands on text node in <p>)
                const container = document.getElementById("container")!;
                const textNode = container.firstChild!; // "Click " text node
                const sel = window.getSelection()!;
                sel.removeAllRanges();
                const range = document.createRange();
                range.setStart(textNode, 0);
                range.setEnd(textNode, text.length);
                sel.addRange(range);
                return true;
            };

            try {
                const result = await executeAction(ToolName.FIND_ELEMENT, { text: "here" });
                expect(result.success).toBe(true);
                // Should drill down from <p> to the <a> child since it's interactive
                // and contains the search text
                expect(result.result).toContain("<a>");
                expect(result.result).toMatch(/\[\d+\]/);
            } finally {
                (window as any).find = origFind;
            }
        });

        test("clears selection after tagging", async () => {
            document.body.innerHTML = "<p>Some text here</p>";
            resetStableIds();
            tagElements(false);

            const origFind = (window as any).find;
            (window as any).find = (text: string) => {
                const p = document.querySelector("p")!;
                const textNode = p.firstChild!;
                const sel = window.getSelection()!;
                sel.removeAllRanges();
                const range = document.createRange();
                range.setStart(textNode, 0);
                range.setEnd(textNode, text.length);
                sel.addRange(range);
                return true;
            };

            try {
                await executeAction(ToolName.FIND_ELEMENT, { text: "Some text" });
                const sel = window.getSelection();
                expect(sel?.rangeCount ?? 0).toBe(0);
            } finally {
                (window as any).find = origFind;
            }
        });

        test("dynamic tag persists in tagMap for interaction", async () => {
            document.body.innerHTML = "<p>Target paragraph</p>";
            resetStableIds();
            tagElements(false);

            const origFind = (window as any).find;
            (window as any).find = (text: string) => {
                const p = document.querySelector("p")!;
                const textNode = p.firstChild!;
                const sel = window.getSelection()!;
                sel.removeAllRanges();
                const range = document.createRange();
                range.setStart(textNode, 0);
                range.setEnd(textNode, text.length);
                sel.addRange(range);
                return true;
            };

            try {
                const result = await executeAction(ToolName.FIND_ELEMENT, { text: "Target" });
                const match = result.result.match(/\[(\d+)\]/);
                expect(match).not.toBeNull();
                const tagId = parseInt(match![1]);

                const tagMap = getTagMap();
                expect(tagMap.has(tagId)).toBe(true);
                expect(tagMap.get(tagId)?.tagName.toLowerCase()).toBe("p");
            } finally {
                (window as any).find = origFind;
            }
        });
    });

    describe("executeRead (read_page)", () => {
        test("returns page info with elements", async () => {
            document.body.innerHTML = `
                <button id="btn1">Submit</button>
                <input type="text" placeholder="Name" />
            `;
            resetStableIds();
            tagElements(false);

            const result = await executeAction(ToolName.READ_PAGE, {});
            expect(result.success).toBe(true);
            expect(result.result).toContain("Interactive elements:");
            expect(result.navigated).toBe(false);
        });
    });

    describe("isLikelyOverlay", () => {
        test("returns true for fixed + high z-index element", () => {
            document.body.innerHTML = '<div id="test" style="position: fixed; z-index: 200;">Overlay</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });

        test("returns true for absolute + high z-index element", () => {
            document.body.innerHTML = '<div id="test" style="position: absolute; z-index: 999;">Overlay</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });

        test("returns true for role=dialog element", () => {
            document.body.innerHTML = '<div id="test" role="dialog">Modal</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });

        test("returns true for role=alertdialog element", () => {
            document.body.innerHTML = '<div id="test" role="alertdialog">Alert</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });

        test("returns true for .modal class", () => {
            document.body.innerHTML = '<div id="test" class="modal">Modal</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });

        test("returns true for .cookie class", () => {
            document.body.innerHTML = '<div id="test" class="cookie">Cookie banner</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });

        test("returns true for .consent class", () => {
            document.body.innerHTML = '<div id="test" class="consent">Consent banner</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });

        test("returns false for normal paragraph", () => {
            document.body.innerHTML = '<p id="test">Just a paragraph</p>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(false);
        });

        test("returns false for normal button", () => {
            document.body.innerHTML = '<button id="test">Submit</button>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(false);
        });

        test("returns false for normal input", () => {
            document.body.innerHTML = '<input id="test" type="text" />';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(false);
        });

        test("returns false for static div with no overlay characteristics", () => {
            document.body.innerHTML = '<div id="test" style="position: static;">Normal content</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(false);
        });

        test("returns false for fixed element with low z-index", () => {
            document.body.innerHTML = '<div id="test" style="position: fixed; z-index: 5;">Sticky nav</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(false);
        });
    });

    describe("executeHideElement", () => {
        test("hides an overlay element (role=dialog)", async () => {
            document.body.innerHTML = '<div role="dialog" id="overlay"><button>Close</button></div>';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let overlayTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "overlay") { overlayTag = tag; break; }
            }
            // If the dialog itself isn't tagged, add it dynamically
            if (overlayTag < 0) {
                const el = document.getElementById("overlay")!;
                overlayTag = addDynamicTag(el);
            }
            expect(overlayTag).toBeGreaterThan(0);

            const result = await executeAction(ToolName.HIDE_ELEMENT, { id: overlayTag });
            expect(result.success).toBe(true);
            expect(result.result).toContain("Hidden");

            const overlay = document.getElementById("overlay")!;
            expect(overlay.style.display).toBe("none");
        });

        test("hides a fixed + high z-index overlay", async () => {
            document.body.innerHTML = '<div id="popup" style="position: fixed; z-index: 9999;">Popup</div>';
            resetStableIds();
            tagElements(false);
            const el = document.getElementById("popup")!;
            const tag = addDynamicTag(el);

            const result = await executeAction(ToolName.HIDE_ELEMENT, { id: tag });
            expect(result.success).toBe(true);
            expect(result.result).toContain("Hidden");
            expect(el.style.display).toBe("none");
        });

        test("rejects non-overlay element", async () => {
            document.body.innerHTML = '<p id="content">Important content</p>';
            resetStableIds();
            tagElements(false);
            const el = document.getElementById("content")!;
            const tag = addDynamicTag(el);

            const result = await executeAction(ToolName.HIDE_ELEMENT, { id: tag });
            expect(result.success).toBe(false);
            expect(result.result).toContain("not an overlay");
            expect(result.result).toContain("press_key");
            expect(el.style.display).not.toBe("none");
        });

        test("rejects normal button element", async () => {
            document.body.innerHTML = '<button id="btn">Submit</button>';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let btnTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "btn") { btnTag = tag; break; }
            }
            expect(btnTag).toBeGreaterThan(0);

            const result = await executeAction(ToolName.HIDE_ELEMENT, { id: btnTag });
            expect(result.success).toBe(false);
            expect(result.result).toContain("not an overlay");
        });

        test("rejects normal input element", async () => {
            document.body.innerHTML = '<input id="inp" type="text" />';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let inpTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "inp") { inpTag = tag; break; }
            }
            expect(inpTag).toBeGreaterThan(0);

            const result = await executeAction(ToolName.HIDE_ELEMENT, { id: inpTag });
            expect(result.success).toBe(false);
            expect(result.result).toContain("not an overlay");
        });

        test("walks up to overlay ancestor when targeting a child button (WI-2)", async () => {
            document.body.innerHTML = `
                <div id="modal" role="dialog" style="position: fixed; z-index: 9999;">
                    <h3>Modal Title</h3>
                    <button id="close-btn">Close</button>
                </div>
            `;
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let btnTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "close-btn") { btnTag = tag; break; }
            }
            expect(btnTag).toBeGreaterThan(0);

            const result = await executeAction(ToolName.HIDE_ELEMENT, { id: btnTag });
            expect(result.success).toBe(true);
            expect(result.result).toContain("overlay ancestor");
            expect(result.result).toContain("parent of");

            // The modal ancestor should be hidden, not just the button
            const modal = document.getElementById("modal")!;
            expect(modal.style.display).toBe("none");
        });

        test("returns failure with helpful message for non-overlay child (WI-2)", async () => {
            document.body.innerHTML = `
                <div id="content">
                    <button id="btn">Click</button>
                </div>
            `;
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let btnTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "btn") { btnTag = tag; break; }
            }
            expect(btnTag).toBeGreaterThan(0);

            const result = await executeAction(ToolName.HIDE_ELEMENT, { id: btnTag });
            expect(result.success).toBe(false);
            expect(result.result).toContain("not an overlay");
            expect(result.result).toContain("no overlay ancestor");
            expect(result.result).toContain("press_key");
        });

        test("sticky banner passes isLikelyOverlay (WI-2)", () => {
            document.body.innerHTML = '<div id="banner" style="position: sticky; z-index: 200;">Banner</div>';
            const el = document.getElementById("banner") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });

        test("class*=modal selector matches (WI-2)", () => {
            document.body.innerHTML = '<div id="test" class="my-modal-wrapper">Modal</div>';
            const el = document.getElementById("test") as HTMLElement;
            expect(isLikelyOverlay(el)).toBe(true);
        });
    });

    describe("executeClick with count (multi-click)", () => {
        test("dispatches multiple click sequences when count > 1", async () => {
            document.body.innerHTML = '<button id="btn">Click me 3 times</button>';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let btnTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "btn") { btnTag = tag; break; }
            }
            expect(btnTag).toBeGreaterThan(0);

            const clickEvents: string[] = [];
            const btn = document.getElementById("btn")!;
            btn.addEventListener("click", () => clickEvents.push("click"));

            const result = await executeAction(ToolName.CLICK_ELEMENT, { id: btnTag, count: 3 });
            expect(result.success).toBe(true);
            expect(result.result).toContain("(3 times)");
            // Each iteration dispatches click event + el.click() = 2 per iteration
            expect(clickEvents.length).toBe(6);
        });

        test("defaults to 1 click when count is omitted", async () => {
            document.body.innerHTML = '<button id="btn">Click me</button>';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let btnTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "btn") { btnTag = tag; break; }
            }

            const clickEvents: string[] = [];
            const btn = document.getElementById("btn")!;
            btn.addEventListener("click", () => clickEvents.push("click"));

            const result = await executeAction(ToolName.CLICK_ELEMENT, { id: btnTag });
            expect(result.success).toBe(true);
            expect(result.result).not.toContain("times");
            expect(clickEvents.length).toBe(2); // click event + el.click()
        });

        test("clamps count to max 10", async () => {
            document.body.innerHTML = '<button id="btn">Click</button>';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let btnTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "btn") { btnTag = tag; break; }
            }

            const clickEvents: string[] = [];
            const btn = document.getElementById("btn")!;
            btn.addEventListener("click", () => clickEvents.push("click"));

            const result = await executeAction(ToolName.CLICK_ELEMENT, { id: btnTag, count: 50 });
            expect(result.success).toBe(true);
            expect(result.result).toContain("(10 times)");
            expect(clickEvents.length).toBe(20); // 10 * 2
        });
    });

    describe("executeType (type_text) — WI-5 SPA robustness", () => {
        test("fires InputEvent with data and inputType properties", async () => {
            document.body.innerHTML = '<input id="inp" type="text" />';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let inpTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "inp") { inpTag = tag; break; }
            }
            expect(inpTag).toBeGreaterThan(0);

            const events: { type: string; data?: string | null; inputType?: string }[] = [];
            const inp = document.getElementById("inp")!;
            inp.addEventListener("input", (e: Event) => {
                const ie = e as InputEvent;
                events.push({ type: "input", data: ie.data, inputType: ie.inputType });
            });

            const result = await executeAction(ToolName.TYPE_TEXT, { id: inpTag, text: "ab" });
            expect(result.success).toBe(true);
            expect(result.result).toContain('Typed "ab"');

            // First event is the clear (deleteContentBackward), then 2 chars
            expect(events.length).toBe(3);
            expect(events[0].inputType).toBe("deleteContentBackward");
            expect(events[1].data).toBe("a");
            expect(events[1].inputType).toBe("insertText");
            expect(events[2].data).toBe("b");
            expect(events[2].inputType).toBe("insertText");
        });

        test("final value is correct after typing", async () => {
            document.body.innerHTML = '<input id="inp" type="text" />';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let inpTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "inp") { inpTag = tag; break; }
            }

            await executeAction(ToolName.TYPE_TEXT, { id: inpTag, text: "hello" });
            expect((document.getElementById("inp") as HTMLInputElement).value).toBe("hello");
        });

        test("contenteditable uses textContent approach", async () => {
            document.body.innerHTML = '<div id="editable" contenteditable="true"></div>';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let editTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "editable") { editTag = tag; break; }
            }
            expect(editTag).toBeGreaterThan(0);

            const result = await executeAction(ToolName.TYPE_TEXT, { id: editTag, text: "hi" });
            expect(result.success).toBe(true);
            expect(document.getElementById("editable")!.textContent).toBe("hi");
        });
    });
});
