import { describe, test, expect, beforeEach } from "bun:test";
import "../setup";
import { ToolName } from "../../src/types";
import { executeAction } from "../../src/content/actions";
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

    describe("executeHideElement", () => {
        test("hides a tagged element", async () => {
            document.body.innerHTML = '<div><button id="overlay">Close</button></div>';
            resetStableIds();
            tagElements(false);
            const tagMap = getTagMap();
            let btnTag = -1;
            for (const [tag, el] of tagMap) {
                if (el.id === "overlay") { btnTag = tag; break; }
            }
            expect(btnTag).toBeGreaterThan(0);

            const result = await executeAction(ToolName.HIDE_ELEMENT, { id: btnTag });
            expect(result.success).toBe(true);
            expect(result.result).toContain("Hidden");

            const btn = document.getElementById("overlay")!;
            expect(btn.style.display).toBe("none");
        });
    });
});
