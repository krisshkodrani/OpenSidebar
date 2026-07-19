/**
 * File-upload targeting + OS-dialog guard.
 *
 * Real forms hide their <input type="file"> behind a styled "Attach" button.
 * Before this fix the hidden input was never tagged, so the agent clicked the
 * button — which opens an OS file dialog nothing in a page can control, and the
 * run strands there (exactly what the qwen refurbed run hit). The fix: always
 * tag file inputs so upload_file can reach them, and refuse clicks that would
 * open the dialog.
 */

import { describe, test, expect, beforeEach } from "vitest";
import "../setup";
import { ToolName } from "../../src/types";
import { executeAction } from "../../src/content/actions";
import {
  tagElements,
  getTagMap,
  resetStableIds,
  extractAttributes,
  isUploadFileInput,
} from "../../src/content/tagging";

function tagOf(el: Element): number {
  resetStableIds();
  tagElements();
  for (const [tag, entry] of getTagMap().entries()) {
    if (entry === el) return tag;
  }
  return -1;
}

// A tiny valid file, base64 (the SW hands upload_file pre-fetched bytes).
const TINY = { data: btoa("hello"), filename: "cv.pdf", mimeType: "application/pdf" };

beforeEach(() => {
  document.body.innerHTML = "";
  resetStableIds();
});

describe("isUploadFileInput", () => {
  test("true for a file input, false for others", () => {
    document.body.innerHTML = `
      <input id="f" type="file" />
      <input id="t" type="text" />
      <input id="d" type="file" disabled />`;
    expect(isUploadFileInput(document.getElementById("f")!)).toBe(true);
    expect(isUploadFileInput(document.getElementById("t")!)).toBe(false);
    expect(isUploadFileInput(document.getElementById("d")!)).toBe(false);
  });
});

describe("hidden file inputs are tagged and labeled", () => {
  test("a display:none file input still gets a tag + upload hint", () => {
    document.body.innerHTML = `
      <div class="attach">
        <button type="button">Attach resume</button>
        <input id="hidden-file" type="file" style="display:none" />
      </div>`;
    const input = document.getElementById("hidden-file")!;
    const tag = tagOf(input);
    expect(tag).toBeGreaterThan(0); // tagged despite being hidden

    const attrs = extractAttributes(input);
    expect(attrs["type"]).toBe("file");
    expect(attrs["upload"]).toContain("upload_file");
  });
});

describe("click guard: never opens the OS file dialog", () => {
  test("clicking the file input is refused and redirects to upload_file", async () => {
    document.body.innerHTML = `<input id="f" type="file" />`;
    const tag = tagOf(document.getElementById("f")!);
    const res = await executeAction(ToolName.CLICK_ELEMENT, { id: tag });
    expect(res.success).toBe(false);
    expect(res.result).toContain("system file-picker dialog");
    expect(res.result).toContain("upload_file");
  });

  test("clicking a <label for=fileInput> is refused too", async () => {
    document.body.innerHTML = `
      <label id="lbl" for="f" style="cursor:pointer">Upload your CV</label>
      <input id="f" type="file" style="display:none" />`;
    const tag = tagOf(document.getElementById("lbl")!);
    expect(tag).toBeGreaterThan(0);
    const res = await executeAction(ToolName.CLICK_ELEMENT, { id: tag });
    expect(res.success).toBe(false);
    expect(res.result).toContain("upload_file");
  });

  test("clicking a <label> that WRAPS a file input is refused too", async () => {
    document.body.innerHTML = `
      <label id="lbl" style="cursor:pointer">Attach<input id="f" type="file" style="display:none" /></label>`;
    const tag = tagOf(document.getElementById("lbl")!);
    expect(tag).toBeGreaterThan(0);
    const res = await executeAction(ToolName.CLICK_ELEMENT, { id: tag });
    expect(res.success).toBe(false);
    expect(res.result).toContain("upload_file");
  });

  test("a normal button is NOT affected by the guard", async () => {
    document.body.innerHTML = `<button id="b" type="button">Save</button>`;
    const tag = tagOf(document.getElementById("b")!);
    const res = await executeAction(ToolName.CLICK_ELEMENT, { id: tag });
    expect(res.success).toBe(true);
    expect(res.result).toContain("Clicked");
  });
});

describe("upload_file works on the (now tagged) hidden input", () => {
  test("sets the file programmatically — no dialog", async () => {
    document.body.innerHTML = `<input id="f" type="file" style="display:none" />`;
    const input = document.getElementById("f") as HTMLInputElement;
    const tag = tagOf(input);
    const res = await executeAction(ToolName.UPLOAD_FILE, { id: tag, ...TINY });
    expect(res.success).toBe(true);
    expect(res.result).toContain("cv.pdf");
    expect(input.files?.[0]?.name).toBe("cv.pdf");
  });
});
