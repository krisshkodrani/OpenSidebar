/**
 * Main-world input/click bridges (RFC LP-16 Phase 4). Injected fallbacks that
 * mirror text-entry and click events in the page's MAIN world so framework
 * (React/Vue) controlled inputs and handlers see them. Verbatim movement from
 * tools/index.ts; the only dependency is the frame-id resolver from ./helpers.
 */

import { getFrameIdsForMainWorldBridge } from "./helpers";
import { frameActionRoutes } from "../perception/frame-action-routes";

export async function mirrorTextInputInMainWorld(
  tabId: number,
  args: Record<string, unknown>,
): Promise<void> {
  const frameTarget = frameActionRoutes.target(tabId, args);
  if (frameTarget.kind === "stale") return;
  const id = frameTarget.kind === "child" ? frameTarget.args.id : args.id;
  const text = args.text;
  if (
    (typeof id !== "number" && typeof id !== "string") ||
    typeof text !== "string"
  ) {
    return;
  }

  try {
    const frameIds = frameTarget.kind === "child"
      ? [frameTarget.frameId] : await getFrameIdsForMainWorldBridge(tabId);
    const inject = (frameId: number) =>
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: "MAIN" as any,
        func: (tagId: string, value: string) => {
          const selector = `[data-os-tag="${tagId.replace(/"/g, '\\"')}"]`;
          const el = document.querySelector(selector);
          if (!el) return;

          if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement
          ) {
            if (
              el instanceof HTMLInputElement &&
              (el.getAttribute("role") === "combobox" ||
                el.hasAttribute("list") ||
                el.hasAttribute("aria-autocomplete"))
            ) {
              return;
            }
            const dispatchInput = (
              data: string | null,
              inputType: string,
              previousValue: string,
            ) => {
              const tracker = (el as any)._valueTracker;
              if (tracker && typeof tracker.setValue === "function") {
                tracker.setValue(previousValue);
              }
              el.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  data,
                  inputType,
                }),
              );
            };
            const proto =
              el instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            const setValue = (nextValue: string) => {
              if (setter) {
                setter.call(el, nextValue);
              } else {
                el.value = nextValue;
              }
            };
            const setAndNotify = (
              nextValue: string,
              inputType: string,
              data: string | null,
            ) => {
              const previousValue = el.value;
              setValue(nextValue);
              dispatchInput(data, inputType, previousValue);
            };

            // React's value tracker may already match the visible DOM value after
            // the isolated-world action. Force a real MAIN-world value transition
            // so framework onChange handlers update state before submit clicks.
            el.focus();
            setAndNotify("", "deleteContentBackward", null);
            setAndNotify(value, "insertText", value);
            if (el instanceof HTMLInputElement) {
              el.setAttribute("value", value);
            }
            el.dispatchEvent(
              new Event("change", { bubbles: true, composed: true }),
            );
            return;
          }

          if ((el as HTMLElement).isContentEditable) {
            (el as HTMLElement).textContent = value;
            el.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                composed: true,
                data: value,
                inputType: "insertText",
              }),
            );
            el.dispatchEvent(
              new Event("change", { bubbles: true, composed: true }),
            );
          }
        },
        args: [String(id), text],
      });

    for (const frameId of frameIds) {
      await Promise.race([
        inject(frameId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Main-world text bridge timed out")),
            5_000,
          ),
        ),
      ]).catch(() => null);
    }
    return;
  } catch {
    // Best-effort: the content-script action already updated the visible DOM.
    return;
  }
}

export async function clickElementInMainWorld(
  tabId: number,
  args: Record<string, unknown>,
): Promise<boolean> {
  const frameTarget = frameActionRoutes.target(tabId, args);
  if (frameTarget.kind === "stale") return false;
  const id = frameTarget.kind === "child" ? frameTarget.args.id : args.id;
  if (typeof id !== "number" && typeof id !== "string") return false;

  try {
    const results = await Promise.race([
      chrome.scripting.executeScript({
        target: frameTarget.kind === "child"
          ? { tabId, frameIds: [frameTarget.frameId] }
          : { tabId, allFrames: true },
        world: "MAIN" as any,
        func: async (tagId: string) => {
          const selector = `[data-os-tag="${tagId.replace(/"/g, '\\"')}"]`;
          const el = document.querySelector(selector);
          if (!(el instanceof HTMLElement)) return false;

          el.scrollIntoView({ block: "center", inline: "center" });
          const rect = el.getBoundingClientRect();
          const clientX = rect.left + rect.width / 2;
          const clientY = rect.top + rect.height / 2;
          const mouseInit: MouseEventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX,
            clientY,
            button: 0,
          };
          const pointerInit: PointerEventInit = {
            ...mouseInit,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          };

          try {
            el.dispatchEvent(
              new PointerEvent("pointerdown", {
                ...pointerInit,
                buttons: 1,
              }),
            );
          } catch {
            // PointerEvent may be unavailable in older page contexts.
          }
          el.dispatchEvent(
            new MouseEvent("mousedown", { ...mouseInit, buttons: 1 }),
          );
          el.focus({ preventScroll: true });
          try {
            el.dispatchEvent(
              new PointerEvent("pointerup", { ...pointerInit, buttons: 0 }),
            );
          } catch {
            // PointerEvent may be unavailable in older page contexts.
          }
          el.dispatchEvent(new MouseEvent("mouseup", mouseInit));
          el.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return true;
        },
        args: [String(id)],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Main-world click bridge timed out")),
          2_000,
        ),
      ),
    ]);
    return results?.some((result) => result.result === true) ?? false;
  } catch {
    // Best-effort: the content-script click already ran.
    return false;
  }
}
