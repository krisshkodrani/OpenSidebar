/**
 * Main-world input/click bridges (RFC LP-16 Phase 4). Injected fallbacks that
 * mirror text-entry and click events in the page's MAIN world so framework
 * (React/Vue) controlled inputs and handlers see them. Verbatim movement from
 * tools/index.ts; the only dependency is the frame-id resolver from ./helpers.
 */

import { getFrameIdsForMainWorldBridge } from "./helpers";

export async function mirrorTextInputInMainWorld(
  tabId: number,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const id = args.id;
  const text = args.text;
  if (
    (typeof id !== "number" && typeof id !== "string") ||
    typeof text !== "string"
  ) {
    return;
  }

  try {
    const frameIds = await getFrameIdsForMainWorldBridge(tabId);
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
            const isAutocompleteLikeTextInput = (
              input: HTMLInputElement,
            ): boolean => {
              const role = input.getAttribute("role")?.toLowerCase() ?? "";
              const blob = [
                input.id,
                input.name,
                input.className,
                input.getAttribute("autocomplete"),
                input.getAttribute("aria-label"),
                input.getAttribute("aria-controls"),
                input.getAttribute("aria-haspopup"),
                input.getAttribute("aria-autocomplete"),
                input.getAttribute("placeholder"),
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

              return (
                role === "combobox" ||
                input.hasAttribute("list") ||
                input.hasAttribute("aria-autocomplete") ||
                /\b(combo|autocomplete|typeahead|suggest|lookup|reference)\b/.test(
                  blob,
                ) ||
                /\bsys_display\./.test(blob)
              );
            };

            const detectServiceNowReference = (
              input: HTMLInputElement,
            ): string | undefined => {
              const displayValue = value.trim();
              const displayName = input.name || input.id;
              if (!displayName.startsWith("sys_display.")) {
                return undefined;
              }
              if (!displayValue) {
                return "servicenow_reference_failed:empty_display_value";
              }

              const fieldPath = displayName.slice("sys_display.".length);
              const fieldName = fieldPath.includes(".")
                ? fieldPath.slice(fieldPath.indexOf(".") + 1)
                : fieldPath;
              const hiddenControl =
                document.getElementById(fieldPath) ??
                Array.from(document.getElementsByName(fieldPath))[0] ??
                null;

              const getReferenceAttr = (
                node: Element | null | undefined,
              ): string | null => {
                if (!node) return null;
                for (const attr of [
                  "data-ref",
                  "data-reference",
                  "data-ref-table",
                  "data-reference-table",
                  "reference",
                  "ref",
                ]) {
                  const attrValue = node.getAttribute(attr);
                  if (attrValue) return attrValue;
                }
                return null;
              };

              const inferReferenceTable = (): string | null => {
                const attrRef =
                  getReferenceAttr(input) ?? getReferenceAttr(hiddenControl);
                if (attrRef) return attrRef;

                const gForm = (window as any).g_form;
                try {
                  const uiElement =
                    gForm?.getGlideUIElement?.(fieldName) ??
                    gForm?.getControl?.(fieldName) ??
                    null;
                  for (const prop of [
                    "reference",
                    "referenceTable",
                    "refTable",
                    "refName",
                    "tableName",
                  ]) {
                    const propValue = uiElement?.[prop];
                    if (typeof propValue === "string" && propValue) {
                      return propValue;
                    }
                  }
                } catch {
                  // Fall through to common ServiceNow reference field names.
                }

                const commonRefs: Record<string, string> = {
                  assigned_to: "sys_user",
                  caller_id: "sys_user",
                  opened_by: "sys_user",
                  resolved_by: "sys_user",
                  assignment_group: "sys_user_group",
                  rfc: "change_request",
                  problem_id: "problem",
                  parent_incident: "incident",
                  business_service: "cmdb_ci_service",
                  service_offering: "service_offering",
                  cmdb_ci: "cmdb_ci",
                };
                return commonRefs[fieldName] ?? null;
              };

              const referenceTable = inferReferenceTable();
              if (!referenceTable) {
                return "servicenow_reference_failed:no_reference_table";
              }

              return `servicenow_reference_candidate:${JSON.stringify({
                fieldPath,
                fieldName,
                referenceTable,
              })}`;
            };

            if (
              el instanceof HTMLInputElement &&
              isAutocompleteLikeTextInput(el)
            ) {
              return detectServiceNowReference(el);
            }

            const commitServiceNowField = (): string | undefined => {
              const host = location.hostname.toLowerCase();
              if (
                !host.endsWith(".service-now.com") &&
                !host.endsWith(".servicenow.com")
              ) {
                return undefined;
              }
              const rawName = [
                (el as HTMLInputElement | HTMLTextAreaElement).name,
                (el as HTMLInputElement | HTMLTextAreaElement).id,
              ].find(
                (candidate) => candidate && !/^sys_original\./i.test(candidate),
              );
              if (!rawName) return undefined;
              if (/\b(?:search|typeahead|filter|query)\b/i.test(rawName)) {
                return undefined;
              }
              if (
                el instanceof HTMLInputElement &&
                [
                  "button",
                  "submit",
                  "reset",
                  "hidden",
                  "checkbox",
                  "radio",
                  "file",
                ].includes(el.type.toLowerCase())
              ) {
                return undefined;
              }
              const fieldName = rawName.includes(".")
                ? rawName.slice(rawName.lastIndexOf(".") + 1)
                : rawName;
              if (
                !fieldName ||
                (fieldName === rawName && !/^[a-z][a-z0-9_]*$/i.test(fieldName))
              ) {
                return undefined;
              }

              const gForm = (window as any).g_form;
              if (typeof gForm?.setValue !== "function") return undefined;
              try {
                gForm.setValue(fieldName, value);
                const committed =
                  typeof gForm?.getValue === "function"
                    ? String(gForm.getValue(fieldName) ?? "")
                    : value;
                return committed === value
                  ? "servicenow_field_committed"
                  : "servicenow_field_commit_attempted";
              } catch {
                return undefined;
              }
            };

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
            return commitServiceNowField();
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
      const results = await Promise.race([
        inject(frameId),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Main-world text bridge timed out")),
            5_000,
          ),
        ),
      ]).catch(() => null);
      const value = results?.find(
        (result) => typeof result.result === "string",
      )?.result;
      if (typeof value === "string") return value;
    }
    return undefined;
  } catch {
    // Best-effort: the content-script action already updated the visible DOM.
    return undefined;
  }
}

export async function clickElementInMainWorld(
  tabId: number,
  args: Record<string, unknown>,
): Promise<boolean> {
  const id = args.id;
  if (typeof id !== "number" && typeof id !== "string") return false;

  try {
    const results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
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
