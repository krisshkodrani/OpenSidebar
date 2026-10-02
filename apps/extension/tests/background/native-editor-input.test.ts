import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { requestPageSnapshot } from "../../src/background/perception/frame-snapshot-runtime";
import { typeInNativeEditor } from "../../src/background/tools/native-editor-input";

vi.mock("../../src/background/perception/frame-snapshot-runtime", () => ({
  requestPageSnapshot: vi.fn(),
}));

const url = "https://example.test/editor";
const state = {
  documentInstanceId: "document-1",
  mutationEpoch: 1,
  url,
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0 },
};
const editor = {
  tag: 7,
  tagName: "div",
  role: "document",
  text: "Document content",
  attributes: {},
  rect: { x: 100, y: 60, width: 400, height: 300 },
  isVisible: true,
  isDisabled: false,
};

function setSnapshot(element = editor, documentState = state) {
  vi.mocked(requestPageSnapshot).mockResolvedValue({
    payload: {
      documentState,
      snapshot: {
        title: "Editor",
        url,
        elements: [element],
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 600 },
      },
    },
  } as Awaited<ReturnType<typeof requestPageSnapshot>>);
}

describe("native editor text input", () => {
  const attach = vi.fn().mockResolvedValue(undefined);
  const detach = vi.fn().mockResolvedValue(undefined);
  const sendCommand = vi.fn().mockResolvedValue(undefined);
  const getTab = vi.fn().mockResolvedValue({ url });

  beforeEach(() => {
    vi.clearAllMocks();
    setSnapshot();
    vi.stubGlobal("chrome", {
      tabs: { TAB_ID_NONE: -1, get: getTab },
      debugger: { attach, detach, sendCommand },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test("clicks a visible editor with browser input, inserts text, and detaches", async () => {
    const result = await typeInNativeEditor(3, { id: 7, text: "Hello world" }, state);
    expect(result).toContain("verify it appeared");
    expect(attach).toHaveBeenCalledWith({ tabId: 3 }, "1.3");
    expect(sendCommand.mock.calls.map((call) => call[1])).toEqual([
      "Input.dispatchMouseEvent", "Input.dispatchMouseEvent", "Input.insertText",
    ]);
    expect(sendCommand.mock.calls[0][2]).toMatchObject({ x: 300, y: 210, type: "mousePressed" });
    expect(sendCommand.mock.calls[2][2]).toEqual({ text: "Hello world" });
    expect(detach).toHaveBeenCalledWith({ tabId: 3 });
  });

  test("does not insert after navigation or a stale observation", async () => {
    getTab.mockResolvedValueOnce({ url: "https://example.test/other" });
    const navigated = await typeInNativeEditor(3, { id: 7, text: "Do not write" }, state);
    expect(navigated).toContain("navigated away");
    expect(sendCommand).not.toHaveBeenCalledWith(
      { tabId: 3 }, "Input.insertText", expect.anything(),
    );
    expect(detach).toHaveBeenCalledTimes(1);

    sendCommand.mockClear();
    const stale = await typeInNativeEditor(3, { id: 7, text: "Do not write" },
      { ...state, documentInstanceId: "old-document" });
    expect(stale).toContain("page changed");
    expect(sendCommand).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledTimes(2);
  });

  test("rejects ordinary fields and still detaches after command failure", async () => {
    setSnapshot({ ...editor, tagName: "textarea" });
    expect(await typeInNativeEditor(3, { id: 7, text: "Use DOM" }, state))
      .toContain("unavailable");
    expect(sendCommand).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledTimes(1);

    setSnapshot();
    sendCommand.mockRejectedValueOnce(new Error("Debugger was dismissed"));
    expect(await typeInNativeEditor(3, { id: 7, text: "Retry" }, state))
      .toContain("Debugger was dismissed");
    expect(detach).toHaveBeenCalledTimes(2);
  });
});
