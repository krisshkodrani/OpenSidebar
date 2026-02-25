
import { describe, test, expect, beforeEach } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { executeAction } from "../../src/content/actions";
import { tagElements, getTagMap, resetStableIds } from "../../src/content/tagging";

describe("Content Actions - Click Robustness", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        resetStableIds();
        tagElements(false);
    });

    test("clicks element when center is occluded but corner is visible", async () => {
        // Create a large button
        const btn = document.createElement("button");
        btn.id = "target";
        btn.textContent = "Click Me";
        btn.style.cssText = "position: absolute; top: 100px; left: 100px; width: 200px; height: 50px;";
        document.body.appendChild(btn);

        // Create an overlay that covers the center of the button
        const overlay = document.createElement("div");
        overlay.style.cssText = "position: absolute; top: 115px; left: 150px; width: 100px; height: 20px; z-index: 999; background: red;";
        document.body.appendChild(overlay);

        // Mock getBoundingClientRect for our elements
        // Button: 100,100 -> 300,150. Center: 200, 125.
        // Overlay: 150,115 -> 250,135. Covers center (200,125).
        btn.getBoundingClientRect = () => ({
            top: 100, left: 100, right: 300, bottom: 150, width: 200, height: 50, x: 100, y: 100, toJSON: () => { }
        });
        overlay.getBoundingClientRect = () => ({
            top: 115, left: 150, right: 250, bottom: 135, width: 100, height: 20, x: 150, y: 115, toJSON: () => { }
        });

        // Mock document.elementFromPoint
        const originalElementFromPoint = document.elementFromPoint;
        document.elementFromPoint = (x, y) => {
            // Check if point hits overlay
            if (x >= 150 && x <= 250 && y >= 115 && y <= 135) {
                return overlay;
            }
            // Check if point hits button
            if (x >= 100 && x <= 300 && y >= 100 && y <= 150) {
                return btn;
            }
            return document.body;
        };

        tagElements(false);
        const tagMap = getTagMap();
        let targetTag = -1;
        for (const [tag, el] of tagMap) {
            if (el.id === "target") {
                targetTag = tag;
                break;
            }
        }
        expect(targetTag).toBeGreaterThan(0);

        // Execute click
        const result = await executeAction(ToolName.CLICK_ELEMENT, { id: targetTag });

        // Restore
        document.elementFromPoint = originalElementFromPoint;

        // Verify success
        expect(result.success).toBe(true);
        expect(result.result).toContain("Clicked");
    });

    test("fails if element is completely occluded", async () => {
        // Create a button
        const btn = document.createElement("button");
        btn.id = "target";
        btn.textContent = "Hidden";
        btn.style.cssText = "position: absolute; top: 100px; left: 100px; width: 100px; height: 50px;";
        document.body.appendChild(btn);

        // Create a huge overlay that covers everything
        const overlay = document.createElement("div");
        overlay.style.cssText = "position: absolute; top: 0; left: 0; width: 500px; height: 500px; z-index: 999;";
        // Mark as likely overlay so executeClick treats it as such
        overlay.className = "modal";
        document.body.appendChild(overlay);

        btn.getBoundingClientRect = () => ({
            top: 100, left: 100, right: 200, bottom: 150, width: 100, height: 50, x: 100, y: 100, toJSON: () => { }
        });

        // Mock document.elementFromPoint to always return overlay
        const originalElementFromPoint = document.elementFromPoint;
        document.elementFromPoint = (x, y) => overlay;

        tagElements(false);
        const tagMap = getTagMap();
        let targetTag = -1;
        for (const [tag, el] of tagMap) {
            if (el.id === "target") {
                targetTag = tag;
                break;
            }
        }

        const result = await executeAction(ToolName.CLICK_ELEMENT, { id: targetTag });
        document.elementFromPoint = originalElementFromPoint;

        expect(result.success).toBe(false);
        expect(result.result).toContain("Click intercepted");
    });
});
