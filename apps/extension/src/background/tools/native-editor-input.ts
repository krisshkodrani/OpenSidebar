import type { PageDocumentState } from "../../types";
import { requestPageSnapshot } from "../perception/frame-snapshot-runtime";
import { isNativeEditorSurface } from "./native-editor-policy";

/** Insert into a visible editor surface that does not expose a DOM text field. */
export async function typeInNativeEditor(
  tabId: number,
  args: Record<string, unknown>,
  observationBasis?: PageDocumentState,
  signal?: AbortSignal,
): Promise<string> {
  const id = args.id;
  const text = args.text;
  if (typeof id !== "number" || !Number.isInteger(id) || typeof text !== "string" || !text) {
    return "Error: nativeEditor requires a tag ID and nonempty text.";
  }
  if (args.pressEnter) {
    return "Error: nativeEditor does not submit or press Enter. Use a separate verified action.";
  }
  if (tabId === chrome.tabs.TAB_ID_NONE) {
    return "Error: No active tab to type into.";
  }

  const target = { tabId };
  let attached = false;
  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await chrome.debugger.attach(target, "1.3");
    attached = true;

    // Attaching displays Chrome's debugger bar, which can change viewport
    // geometry. Resolve the target only after the bar is visible.
    const response = await requestPageSnapshot(tabId, {
      refresh: true,
      autoDismiss: false,
    });
    const state = response.payload.documentState;
    const snapshot = response.payload.snapshot;
    if (!state || !snapshot ||
        (observationBasis && (state.documentInstanceId !== observationBasis.documentInstanceId ||
          state.url !== observationBasis.url))) {
      return "Error: The page changed before native text entry. Read the page again.";
    }
    const element = snapshot.elements.find((candidate) => candidate.tag === id);
    if (!element || !isNativeEditorSurface(element) ||
        element.rect.width <= 0 || element.rect.height <= 0) {
      return `Error: Editor surface [${id}] is unavailable. Read the page again.`;
    }
    const left = Math.max(0, element.rect.x);
    const top = Math.max(0, element.rect.y);
    const right = Math.min(snapshot.viewport.width, element.rect.x + element.rect.width);
    const bottom = Math.min(snapshot.viewport.height, element.rect.y + element.rect.height);
    if (right <= left || bottom <= top) {
      return `Error: Editor surface [${id}] is outside the viewport. Scroll it into view first.`;
    }
    const x = Math.round((left + right) / 2);
    const y = Math.round((top + bottom) / 2);

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", clickCount: 1,
    });
    const tab = await chrome.tabs.get(tabId);
    if (tab.url !== snapshot.url) {
      return "Error: The editor click navigated away. Text was not inserted.";
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await chrome.debugger.sendCommand(target, "Input.insertText", { text });
    return `Browser text input sent to editor surface [${id}]. Read the page or inspect the screenshot to verify it appeared.`;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return `Error: Native editor input failed (${error instanceof Error ? error.message : String(error)}).`;
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}
