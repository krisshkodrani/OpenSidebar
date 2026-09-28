import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { executeAction } from "../../src/content/actions";
import { addDynamicTag, resetStableIds } from "../../src/content/tagging";

beforeEach(() => {
  document.body.innerHTML = "";
  resetStableIds();
});

describe("dialog container clicks", () => {
  test("points to the actual confirmation control without claiming a click", async () => {
    document.body.innerHTML = `
      <div id="confirm-dialog">
        <h3>Confirm Deletion</h3>
        <button id="cancel">Cancel</button>
        <button id="confirm">Confirm Delete</button>
      </div>`;
    const confirm = document.getElementById("confirm")!;
    const clicked = vi.fn();
    confirm.addEventListener("click", clicked);

    const containerTag = addDynamicTag(document.getElementById("confirm-dialog")!);
    const result = await executeAction(ToolName.CLICK_ELEMENT, { id: containerTag });

    expect(result.success).toBe(false);
    expect(result.result).toContain("dialog container");
    expect(result.result).toContain("Confirm Delete");
    expect(clicked).not.toHaveBeenCalled();

    const confirmTag = addDynamicTag(confirm);
    const confirmed = await executeAction(ToolName.CLICK_ELEMENT, { id: confirmTag });
    expect(confirmed.success).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });
});
