/**
 * ServiceNow adapter — catalog-item inspect / configure tools (RFC LP-16 Phase 4).
 *
 * Relocated verbatim from tools/index.ts, then split by tool concern so no
 * single adapter file is itself a landmine. Registered at its original ordinal
 * position in registerTools() to keep LLM-facing definition order unchanged.
 * Import-direction rule: never imports "../index" or the tools barrel.
 */

import type { ToolRegistry } from "../registry";
import { ToolName } from "../../../types";
import { waitForNavigation } from "../bridge";
import { waitForDomReady } from "../../tab-ready";
import {
  INSPECT_CATALOG_ITEM_DEF,
  CONFIGURE_CATALOG_ITEM_DEF,
} from "../definitions";

import {
  runReadOnlyPageInspector,
} from "../page-inspector";

export function registerServiceNowCatalogTools(
  toolRegistry: ToolRegistry,
): void {
  toolRegistry.register(
    ToolName.INSPECT_CATALOG_ITEM,
    INSPECT_CATALOG_ITEM_DEF,
    async (args, tabId) => {
      const maxControls = Math.min(
        Math.max((args.maxControls as number) || 40, 1),
        80,
      );
      return runReadOnlyPageInspector(
        tabId,
        (max: number) => {
          const norm = (value: unknown) =>
            String(value ?? "")
              .replace(/\s+/g, " ")
              .trim();
          const lines: string[] = [
            `URL: ${location.href}`,
            `Title: ${document.title}`,
          ];
          const bodyText = document.body?.innerText || "";
          const itemNameCandidates = [
            ...document.querySelectorAll(
              "h1, h2, h3, [data-test-id*='title' i], [class*='item' i][class*='title' i], [class*='catalog' i][class*='title' i], .cat_item_name, .sc-cat-item-title",
            ),
          ]
            .map((el) => norm(el.textContent))
            .filter(Boolean)
            .slice(0, 10);
          const titleCandidate = norm(document.title.replace(/\s*\|\s*ServiceNow.*$/i, ""));
          if (titleCandidate) itemNameCandidates.push(titleCandidate);
          const uniqueItemNames = [...new Set(itemNameCandidates)].slice(0, 8);
          if (uniqueItemNames.length > 0) {
            lines.push("Catalog item candidates:");
            lines.push(...uniqueItemNames.map((name) => `- ${name.slice(0, 220)}`));
          }
          const priceText = norm(bodyText)
            .match(
              /(?:[$€£]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP)|annually|monthly|total|price)/gi,
            )
            ?.slice(0, 20)
            .join(" | ");
          if (priceText) lines.push(`Price/summary cues: ${priceText}`);
          const cartLines = bodyText
            .split(/\r?\n/)
            .map(norm)
            .filter(Boolean)
            .filter((line) =>
              /\b(shopping cart|cart|checkout|order status|request number|thank you|submitted|line items?|quantity|total|delivery date|req\d+|ritm\d+)\b/i.test(
                line,
              ),
            )
            .slice(0, 30);
          if (cartLines.length) {
            lines.push("Cart/order cues:");
            lines.push(...cartLines.map((line) => `- ${line.slice(0, 220)}`));
          }

          const controls = [
            ...document.querySelectorAll(
              "input, select, textarea, button, [role='button'], [role='checkbox'], [role='spinbutton']",
            ),
          ].slice(0, max * 2);
          const rows: string[] = [];
          for (const el of controls) {
            const control = el as
              | HTMLInputElement
              | HTMLSelectElement
              | HTMLTextAreaElement;
            const type =
              el.getAttribute("type") ||
              el.getAttribute("role") ||
              el.tagName.toLowerCase();
            const label = norm(
              [
                el.getAttribute("aria-label"),
                el.getAttribute("title"),
                el.getAttribute("name"),
                el.getAttribute("id"),
                el.closest("label")?.textContent,
                control.value,
                el.textContent,
              ]
                .filter(Boolean)
                .join(" "),
            );
            if (!label) continue;
            const checked =
              "checked" in control && typeof control.checked === "boolean"
                ? ` checked=${control.checked}`
                : "";
            rows.push(`- ${type}${checked}: ${label.slice(0, 220)}`);
            if (rows.length >= max) break;
          }
          if (rows.length === 0) lines.push("No catalog controls found.");
          else {
            lines.push("Catalog controls:");
            lines.push(...rows);
          }
          return lines.join("\n");
        },
        [maxControls],
        "No catalog item state found.",
      );
    },
  );

  toolRegistry.register(
    ToolName.CONFIGURE_CATALOG_ITEM,
    CONFIGURE_CATALOG_ITEM_DEF,
    async (args, tabId) => {
      const expectedItem =
        typeof args.expectedItem === "string" && args.expectedItem.trim()
          ? args.expectedItem.trim()
          : null;
      const quantity =
        args.quantity === undefined || args.quantity === null
          ? null
          : String(args.quantity);
      const textFields = Array.isArray(args.textFields)
        ? args.textFields
            .filter(
              (field: any) =>
                typeof field?.field === "string" &&
                typeof field?.value === "string" &&
                field.field.trim(),
            )
            .map((field: any) => ({
              field: field.field.trim(),
              value: field.value,
            }))
        : [];
      const optionFields = Array.isArray(args.optionFields)
        ? args.optionFields
            .filter(
              (field: any) =>
                typeof field?.field === "string" &&
                typeof field?.value === "string" &&
                field.field.trim(),
            )
            .map((field: any) => ({
              field: field.field.trim(),
              value: field.value,
            }))
        : [];
      const checkboxes = Array.isArray(args.checkboxes)
        ? args.checkboxes
            .filter(
              (checkbox: any) =>
                typeof checkbox?.label === "string" &&
                typeof checkbox?.checked === "boolean" &&
                checkbox.label.trim(),
            )
            .map((checkbox: any) => ({
              label: checkbox.label.trim(),
              checked: checkbox.checked,
            }))
        : [];
      const submit = args.submit === true;
      const submitButton =
        typeof args.submitButton === "string" && args.submitButton.trim()
          ? args.submitButton.trim()
          : null;
      const continueToCheckout = args.continueToCheckout === true;

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: "MAIN" as any,
          func: async (input: {
            quantity: string | null;
            textFields: Array<{ field: string; value: string }>;
            optionFields: Array<{ field: string; value: string }>;
            checkboxes: Array<{ label: string; checked: boolean }>;
            submit: boolean;
            submitButton: string | null;
            continueToCheckout: boolean;
            expectedItem: string | null;
          }) => {
            const sleep = (ms: number) =>
              new Promise((resolve) => setTimeout(resolve, ms));
            const norm = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
            const display = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const visible = (el: Element | null) => {
              if (!el || !(el instanceof HTMLElement)) return false;
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.opacity !== "0" &&
                rect.width > 0 &&
                rect.height > 0
              );
            };
            const escapeCss = (value: string) =>
              window.CSS?.escape
                ? window.CSS.escape(value)
                : value.replace(/["\\]/g, "\\$&");
            const directLabelsFor = (el: Element): string[] => {
              const control = el as
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement;
              return [
                el.getAttribute("aria-label"),
                el.getAttribute("aria-labelledby"),
                el.getAttribute("title"),
                el.getAttribute("data-original-title"),
                el.getAttribute("placeholder"),
                el.getAttribute("name"),
                el.getAttribute("id"),
                el.getAttribute("control"),
                control.value,
                el.textContent,
              ]
                .map(display)
                .filter(Boolean);
            };
            const labelsFor = (el: Element): string[] => {
              const labels = directLabelsFor(el);
              const labelledBy = el.getAttribute("aria-labelledby");
              if (labelledBy) {
                for (const labelId of labelledBy.split(/\s+/)) {
                  if (!labelId) continue;
                  const labelText = document.getElementById(labelId)?.textContent;
                  if (labelText) labels.push(labelText);
                }
              }
              const id = el.getAttribute("id");
              if (id) {
                document
                  .querySelectorAll(`label[for="${escapeCss(id)}"]`)
                  .forEach((label) => labels.push(label.textContent));
              }
              const closestLabel = el.closest("label");
              if (closestLabel) labels.push(closestLabel.textContent);
              const previous = el.previousElementSibling;
              if (previous) labels.push(previous.textContent);
              let ancestor = el.parentElement;
              let depth = 0;
              while (ancestor && ancestor !== document.body && depth < 4) {
                const ancestorText = display(
                  ancestor.innerText || ancestor.textContent,
                );
                if (ancestorText && ancestorText.length <= 300) {
                  labels.push(ancestorText);
                }
                Array.from(ancestor.children)
                  .filter(
                    (node) =>
                      node !== el &&
                      node.matches(
                        "label, [aria-label], [title], .label, .question_text, .sc-variable-label",
                      ),
                  )
                  .forEach((node) => {
                    labels.push(
                      node.getAttribute("aria-label") ||
                        node.getAttribute("title") ||
                        node.textContent,
                    );
                  });
                ancestor = ancestor.parentElement;
                depth += 1;
              }
              return labels.map(display).filter(Boolean);
            };
            const matches = (labels: string[], expected: string) => {
              const needle = norm(expected);
              return labels.some((label) => {
                const haystack = norm(label);
                return haystack === needle || haystack.includes(needle);
              });
            };
            const compact = (value: unknown) =>
              norm(value).replace(/[^a-z0-9]+/g, "");
            const itemNameCandidates = () => {
              const candidates = [
                ...document.querySelectorAll(
                  "h1, h2, h3, [data-test-id*='title' i], [class*='item' i][class*='title' i], [class*='catalog' i][class*='title' i], .cat_item_name, .sc-cat-item-title",
                ),
              ]
                .map((el) => display(el.textContent))
                .filter(Boolean);
              const titleCandidate = display(
                document.title.replace(/\s*\|\s*ServiceNow.*$/i, ""),
              );
              if (titleCandidate) candidates.push(titleCandidate);
              return [...new Set(candidates)].slice(0, 12);
            };
            const expectedItemMatches = (expected: string, candidates: string[]) => {
              const wanted = norm(expected);
              const compactWanted = compact(expected);
              return candidates.some((candidate) => {
                const candidateNorm = norm(candidate);
                const compactCandidate = compact(candidate);
                return (
                  candidateNorm === wanted ||
                  candidateNorm.includes(wanted) ||
                  (compactWanted.length >= 8 &&
                    compactCandidate === compactWanted)
                );
              });
            };
            const triggerLibraryEvents = (
              el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
            ) => {
              const win = (el.ownerDocument?.defaultView || window) as any;
              for (const candidate of [win.jQuery, win.$j]) {
                if (typeof candidate !== "function") continue;
                try {
                  const wrapped = candidate(el);
                  wrapped?.trigger?.("change");
                  wrapped?.trigger?.("input");
                } catch {
                  // Library hooks are best-effort; native events remain primary.
                }
              }
            };
            const serviceNowFieldNamesFor = (el: Element) => {
              const rawNames = [
                el.getAttribute("name"),
                el.getAttribute("id"),
                el.getAttribute("control"),
                el.getAttribute("for"),
                el.getAttribute("aria-controls"),
              ]
                .map(display)
                .filter(Boolean);
              const names: string[] = [];
              for (const rawName of rawNames) {
                names.push(rawName);
                const withoutLabel = rawName.replace(/_label$/i, "");
                if (withoutLabel !== rawName) names.push(withoutLabel);
                const withoutNi = withoutLabel.replace(/^ni\./i, "");
                if (withoutNi !== withoutLabel) names.push(withoutNi);
              }
              return [...new Set(names)];
            };
            const commitServiceNowValue = (el: Element, value: string) => {
              const gForm = (window as any).g_form;
              if (typeof gForm?.setValue !== "function") return;
              for (const name of serviceNowFieldNamesFor(el)) {
                try {
                  gForm.setValue(name, value);
                } catch {
                  // Some visible catalog controls are not g_form fields.
                }
              }
            };
            const setNativeValue = (
              el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
              value: string,
            ) => {
              if (el instanceof HTMLSelectElement) {
                const optionIndex = [...el.options].findIndex(
                  (option) => option.value === value,
                );
                try {
                  el.scrollIntoView({ behavior: "instant", block: "center" });
                  el.focus();
                } catch {
                  // Non-visual test environments may not implement scrolling.
                }
                const setter = Object.getOwnPropertyDescriptor(
                  HTMLSelectElement.prototype,
                  "value",
                )?.set;
                if (setter) setter.call(el, value);
                else el.value = value;
                if (optionIndex >= 0) el.selectedIndex = optionIndex;
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("input", { bubbles: true }));
                triggerLibraryEvents(el);
                commitServiceNowValue(el, value);
                return;
              }
              const prototype = Object.getPrototypeOf(el);
              const descriptor =
                Object.getOwnPropertyDescriptor(prototype, "value") ||
                Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value",
                );
              if (descriptor?.set) descriptor.set.call(el, value);
              el.value = value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("blur", { bubbles: true }));
              triggerLibraryEvents(el);
              commitServiceNowValue(el, value);
            };
            const setNativeChecked = (
              el: HTMLInputElement,
              checked: boolean,
            ) => {
              const descriptor =
                Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "checked",
                ) ||
                Object.getOwnPropertyDescriptor(
                  Object.getPrototypeOf(el),
                  "checked",
                );
              if (descriptor?.set) descriptor.set.call(el, checked);
              el.checked = checked;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              triggerLibraryEvents(el);
              commitServiceNowValue(el, checked ? "true" : "false");
            };
            const setRelatedCheckboxControls = (
              source: Element,
              checked: boolean,
            ) => {
              const aliases = new Set(serviceNowFieldNamesFor(source));
              if (aliases.size === 0) return;
              const value = checked ? "true" : "false";
              const controls = [
                ...document.querySelectorAll("input, select, textarea"),
              ] as Array<
                HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
              >;
              for (const control of controls) {
                if (control === source) continue;
                const names = serviceNowFieldNamesFor(control);
                if (!names.some((name) => aliases.has(name))) continue;
                if (
                  control instanceof HTMLInputElement &&
                  control.type === "checkbox"
                ) {
                  setNativeChecked(control, checked);
                } else {
                  setNativeValue(control, value);
                }
              }
            };
            const checkboxState = (el: Element): boolean | null => {
              if (el instanceof HTMLInputElement && el.type === "checkbox") {
                return el.checked;
              }
              const controlId =
                el.getAttribute("for") ||
                el.getAttribute("control") ||
                el.getAttribute("aria-controls");
              const controlled = controlId
                ? document.getElementById(controlId)
                : null;
              if (
                controlled instanceof HTMLInputElement &&
                controlled.type === "checkbox"
              ) {
                return controlled.checked;
              }
              const checked =
                el.getAttribute("aria-checked") ||
                el.getAttribute("checked") ||
                el.getAttribute("data-checked");
              if (checked === "true") return true;
              if (checked === "false") return false;
              return null;
            };
            const labelAnchorsFor = (field: string) => {
              const root = document.body || document.documentElement;
              const needle = norm(field);
              const anchors: Node[] = [];
              const walker = document.createTreeWalker(root, 4);
              let node = walker.nextNode();
              while (node) {
                const parent = node.parentElement;
                const text = norm(node.textContent);
                if (
                  parent &&
                  text &&
                  !/^(script|style|noscript)$/i.test(parent.tagName) &&
                  (text === needle || text.includes(needle))
                ) {
                  anchors.push(parent);
                }
                node = walker.nextNode();
              }
              return anchors;
            };
            const findFollowingControl = <T extends Element>(
              field: string,
              controls: T[],
            ): T | undefined => {
              for (const anchor of labelAnchorsFor(field)) {
                const control = controls.find(
                  (el) => Boolean(anchor.compareDocumentPosition(el) & 4),
                );
                if (control) return control;
              }
              return undefined;
            };
            const findQuantity = () => {
              const controls = [
                ...document.querySelectorAll(
                  "select, input:not([type='button']):not([type='submit'])",
                ),
              ] as Array<HTMLInputElement | HTMLSelectElement>;
              const visibleControls = controls.filter(visible);
              const byLabel = (
                candidates: Array<HTMLInputElement | HTMLSelectElement>,
              ) =>
                candidates.find((el) => matches(labelsFor(el), "quantity")) ||
                candidates.find((el) =>
                  /quantity|qty/i.test(`${el.id} ${el.name}`),
                );
              return (
                byLabel(visibleControls) ||
                findFollowingControl("quantity", visibleControls) ||
                byLabel(controls) ||
                findFollowingControl("quantity", controls)
              );
            };
            const setRelatedQuantityControls = (
              value: string,
              primary: HTMLInputElement | HTMLSelectElement,
            ) => {
              const controls = [
                ...document.querySelectorAll(
                  "select, input:not([type='button']):not([type='submit'])",
                ),
              ] as Array<HTMLInputElement | HTMLSelectElement>;
              for (const control of controls) {
                if (control === primary) continue;
                if (!/quantity|qty/i.test(`${control.id} ${control.name}`)) {
                  continue;
                }
                setNativeValue(control, value);
              }
            };
            const findTextControl = (field: string) => {
              const controls = [
                ...document.querySelectorAll(
                  "textarea, input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit'])",
                ),
              ] as Array<HTMLInputElement | HTMLTextAreaElement>;
              const visibleControls = controls.filter(visible);
              return (
                visibleControls.find((el) => matches(labelsFor(el), field)) ||
                findFollowingControl(field, visibleControls) ||
                controls.find((el) => matches(labelsFor(el), field)) ||
                findFollowingControl(field, controls)
              );
            };
            const selectOptionFor = (
              control: HTMLSelectElement,
              value: string,
            ) =>
              [...control.options].find(
                (candidate) =>
                  norm(candidate.value) === norm(value) ||
                  norm(candidate.textContent) === norm(value),
              ) ||
              [...control.options].find((candidate) =>
                norm(candidate.textContent).includes(norm(value)),
              );
            const findOptionControl = (field: string, value: string) => {
              const controls = [
                ...document.querySelectorAll("select"),
              ] as HTMLSelectElement[];
              const labelled = controls.find(
                (el) => matches(labelsFor(el), field) && selectOptionFor(el, value),
              );
              if (labelled) return labelled;
              const visibleFollowing = findFollowingControl(
                field,
                controls.filter(visible),
              );
              if (visibleFollowing && selectOptionFor(visibleFollowing, value)) {
                return visibleFollowing;
              }
              const following = findFollowingControl(field, controls);
              if (following && selectOptionFor(following, value)) return following;
              const valueMatches = controls.filter((el) =>
                selectOptionFor(el, value),
              );
              return valueMatches.length === 1 ? valueMatches[0] : undefined;
            };
            const radioLikeControls = () =>
              [
                ...document.querySelectorAll(
                  "input[type='radio'], [role='radio'], label[type='radio'], label[role='radio']",
                ),
              ] as Element[];
            const radioGroupNameFor = (el: Element) =>
              display(
                el.getAttribute("name") ||
                  el.getAttribute("data-name") ||
                  el.getAttribute("aria-controls") ||
                  "",
              );
            const radioInputFor = (el: Element): HTMLInputElement | null => {
              if (el instanceof HTMLInputElement && el.type === "radio") {
                return el;
              }
              const nested = el.querySelector?.("input[type='radio']");
              if (nested instanceof HTMLInputElement) return nested;
              const controlId =
                el.getAttribute("for") ||
                el.getAttribute("control") ||
                el.getAttribute("aria-controls");
              const controlled = controlId ? document.getElementById(controlId) : null;
              if (
                controlled instanceof HTMLInputElement &&
                controlled.type === "radio"
              ) {
                return controlled;
              }
              const groupName = radioGroupNameFor(el);
              if (!groupName) return null;
              const groupInputs = [
                ...document.querySelectorAll(
                  `input[type='radio'][name="${escapeCss(groupName)}"]`,
                ),
              ] as HTMLInputElement[];
              if (groupInputs.length === 0) return null;
              const visibleGroupControls = radioLikeControls().filter(
                (candidate) =>
                  !(candidate instanceof HTMLInputElement) &&
                  radioGroupNameFor(candidate) === groupName,
              );
              const labelIndex = visibleGroupControls.indexOf(el);
              if (labelIndex >= 0 && groupInputs[labelIndex]) {
                return groupInputs[labelIndex];
              }
              const labelText = norm(el.textContent);
              return (
                groupInputs.find((input) =>
                  [
                    ...directLabelsFor(input),
                    input.closest("label")?.textContent,
                    input.nextElementSibling?.matches("label")
                      ? input.nextElementSibling.textContent
                      : null,
                  ].some((label) => {
                    const candidate = norm(label);
                    return (
                      candidate &&
                      labelText &&
                      (candidate === labelText ||
                        candidate.includes(labelText) ||
                        labelText.includes(candidate))
                    );
                  }),
                ) ?? null
              );
            };
            const radioStoredValueFor = (el: Element) => {
              const input = radioInputFor(el);
              return display(
                input?.value ||
                  input?.id ||
                  el.getAttribute("id") ||
                  (el as HTMLInputElement).value ||
                  el.getAttribute("value") ||
                  el.textContent ||
                  "",
              );
            };
            const radioCheckedMarkerValueFor = (el: Element) => {
              const input = radioInputFor(el);
              return display(
                input?.id ||
                  el.getAttribute("id") ||
                  (el as HTMLInputElement).value ||
                  el.getAttribute("value") ||
                  el.textContent ||
                  "",
              );
            };
            const radioDisplayValueFor = (el: Element) =>
              display(
                [
                  el.getAttribute("aria-label"),
                  el.getAttribute("title"),
                  el.getAttribute("id")
                    ? document.querySelector(
                        `label[for="${escapeCss(el.getAttribute("id") || "")}"]`,
                      )?.textContent
                    : null,
                  el.closest("label")?.textContent,
                  el.nextElementSibling?.matches("label")
                    ? el.nextElementSibling.textContent
                    : null,
                  el.textContent,
                  (el as HTMLInputElement).value,
                ]
                  .filter(Boolean)
                  .join(" "),
              );
            const radioOptionMatches = (el: Element, value: string) => {
              const wanted = norm(value);
              const compactWanted = wanted.replace(/[^a-z0-9]+/g, "");
              const labels = [
                radioDisplayValueFor(el),
                ...directLabelsFor(el),
                ...labelsFor(el).filter((label) => label.length <= 160),
              ];
              return labels.some((label) => {
                const candidate = norm(label);
                const compactCandidate = candidate.replace(/[^a-z0-9]+/g, "");
                return (
                  candidate === wanted ||
                  candidate.includes(wanted) ||
                  (compactWanted.length > 0 &&
                  compactCandidate.includes(compactWanted))
                );
              });
            };
            const radioStoredValueMatches = (el: Element, value: string) => {
              const wanted = norm(value);
              const compactWanted = wanted.replace(/[^a-z0-9]+/g, "");
              const candidate = norm(radioStoredValueFor(el));
              const compactCandidate = candidate.replace(/[^a-z0-9]+/g, "");
              return (
                candidate === wanted ||
                (compactWanted.length > 0 && compactCandidate === compactWanted)
              );
            };
            const findRadioOptionControl = (field: string, value: string) => {
              const controls = radioLikeControls();
              const findAfterField = (candidates: Element[]) => {
                for (const anchor of labelAnchorsFor(field)) {
                  const after = candidates.filter((el) =>
                    Boolean(anchor.compareDocumentPosition(el) & 4),
                  );
                  const match =
                    after.find((el) => radioStoredValueMatches(el, value)) ||
                    after.find((el) => radioOptionMatches(el, value));
                  if (match) return match;
                }
                return undefined;
              };
              const visibleMatch = findAfterField(controls.filter(visible));
              if (visibleMatch) return visibleMatch;
              const followingMatch = findAfterField(controls);
              if (followingMatch) return followingMatch;
              const exactValueMatches = controls.filter((el) =>
                radioStoredValueMatches(el, value),
              );
              if (exactValueMatches.length === 1) return exactValueMatches[0];
              const valueMatches = controls.filter((el) =>
                radioOptionMatches(el, value),
              );
              return valueMatches.length === 1 ? valueMatches[0] : undefined;
            };
            const setRadioOptionControlState = (
              control: Element,
              desiredValue: string,
            ) => {
              const inputControl = radioInputFor(control);
              const commitControl = inputControl || control;
              const groupName =
                radioGroupNameFor(commitControl) || radioGroupNameFor(control);
              const selectedValue = radioStoredValueFor(commitControl);
              const selectedCheckedMarker =
                radioCheckedMarkerValueFor(commitControl);
              if (control instanceof HTMLElement && visible(control)) {
                control.click();
              }
              const groupControls = groupName
                ? radioLikeControls().filter(
                    (candidate) => radioGroupNameFor(candidate) === groupName,
                  )
                : [control];
              for (const candidate of groupControls) {
                const candidateInput = radioInputFor(candidate);
                const selected =
                  candidate === control ||
                  (Boolean(inputControl) && candidateInput === inputControl);
                if (candidateInput) {
                  setNativeChecked(candidateInput, selected);
                }
                if (candidate instanceof HTMLElement) {
                  candidate.setAttribute("checked", String(selected));
                  candidate.setAttribute("aria-checked", String(selected));
                }
              }
              const checkedRadioName = groupName
                ? `${groupName}_checked_radio`
                : null;
              if (checkedRadioName && selectedCheckedMarker) {
                document
                  .querySelectorAll(
                    `input[name="${escapeCss(checkedRadioName)}"], input[id="${escapeCss(checkedRadioName)}"]`,
                  )
                  .forEach((el) => {
                    if (el instanceof HTMLInputElement) {
                      setNativeValue(el, selectedCheckedMarker);
                    }
                  });
              }
              const compactDesired = compact(desiredValue);
              const compactSelected = compact(selectedValue);
              const compactDisplay = compact(radioDisplayValueFor(control));
              const valueToCommit =
                selectedValue &&
                (compactSelected.includes(compactDesired) ||
                  compactDesired.includes(compactSelected) ||
                  compactDisplay.includes(compactSelected))
                  ? selectedValue
                  : desiredValue;
              if (valueToCommit) {
                commitServiceNowValue(commitControl, valueToCommit);
                if (commitControl !== control) {
                  commitServiceNowValue(control, valueToCommit);
                }
              }
              if (inputControl?.checked) {
                return true;
              }
              const checked =
                control.getAttribute("checked") ||
                control.getAttribute("aria-checked");
              return checked === "true";
            };
            const findCheckbox = (label: string) => {
              const controls = [
                ...document.querySelectorAll(
                  "input[type='checkbox'], [role='checkbox'], label[type='checkbox'], label[control]",
                ),
              ];
              const checkboxLabelsFor = (el: Element): string[] => {
                const labels = directLabelsFor(el);
                const id = el.getAttribute("id");
                if (id) {
                  document
                    .querySelectorAll(
                      `label[for="${escapeCss(id)}"], label[control="${escapeCss(id)}"]`,
                    )
                    .forEach((candidate) => labels.push(candidate.textContent));
                  const idLabel = document.getElementById(`${id}_label`)?.textContent;
                  if (idLabel) labels.push(idLabel);
                }
                const controlId =
                  el.getAttribute("for") ||
                  el.getAttribute("control") ||
                  el.getAttribute("aria-controls");
                if (controlId) {
                  const controlText = document.getElementById(controlId)?.textContent;
                  if (controlText) labels.push(controlText);
                }
                return labels.map(display).filter(Boolean);
              };
              return controls.find((el) => matches(checkboxLabelsFor(el), label));
            };
            const setCheckboxControlState = (
              control: Element,
              checked: boolean,
              allowClick: boolean,
            ) => {
              const before = checkboxState(control);
              if (
                allowClick &&
                before !== checked &&
                control instanceof HTMLElement &&
                visible(control)
              ) {
                control.click();
              }
              const controlId =
                control.getAttribute("for") ||
                control.getAttribute("control") ||
                control.getAttribute("aria-controls");
              const inputEl = controlId
                ? document.getElementById(controlId)
                : control;
              if (
                inputEl instanceof HTMLInputElement &&
                inputEl.type === "checkbox"
              ) {
                setNativeChecked(inputEl, checked);
                setRelatedCheckboxControls(inputEl, checked);
              }
              if (control instanceof HTMLElement) {
                control.setAttribute("checked", String(checked));
                control.setAttribute("aria-checked", String(checked));
                commitServiceNowValue(control, checked ? "true" : "false");
                setRelatedCheckboxControls(control, checked);
              }
              return checkboxState(control);
            };
            const currentBodyText = () =>
              display(document.body?.innerText || "");
            const cartCheckoutVisible = () => {
              const text = currentBodyText();
              return (
                /\bcart\b/i.test(text) &&
                /\b(proceed to checkout|checkout)\b/i.test(text)
              );
            };
            const hasOrderOrCartSubmitControl = () => {
              const controls = [
                ...document.querySelectorAll(
                  "button, input[type='button'], input[type='submit'], a, [role='button']",
                ),
              ].filter(visible);
              return controls.some((el) =>
                directLabelsFor(el).some((label) =>
                  /\b(add to cart|order now|place order|submit order|request|checkout|order)\b/i.test(
                    label,
                  ),
                ),
              );
            };
            let quantityDeferredToCart = false;
            const findSubmitControl = () => {
              const controls = [
                ...document.querySelectorAll(
                  "button, input[type='button'], input[type='submit'], a, [role='button']",
                ),
              ].filter(visible);
              const findByPattern = (pattern: RegExp) =>
                controls.find((el) =>
                  directLabelsFor(el).some((label) => pattern.test(label)),
                ) as HTMLElement | undefined;
              if (
                input.continueToCheckout &&
                input.submitButton &&
                /\badd to cart\b/i.test(input.submitButton)
              ) {
                const directOrder = findByPattern(
                  /\b(order now|place order|submit order|request)\b/i,
                );
                if (directOrder) return directOrder;
              }
              if (input.submitButton) {
                const exact = controls.find((el) =>
                  matches(directLabelsFor(el), input.submitButton as string),
                );
                if (exact) return exact as HTMLElement;
              }
              const patterns = cartCheckoutVisible()
                ? [
                    /\b(proceed to checkout|checkout)\b/i,
                    /\b(order now|place order|submit order|request)\b/i,
                    /\badd to cart\b/i,
                    /\border\b/i,
                  ]
                : input.continueToCheckout && quantityDeferredToCart
                  ? [
                      /\badd to cart\b/i,
                      /\b(order now|place order|submit order|request)\b/i,
                      /\b(proceed to checkout|checkout)\b/i,
                      /\border\b/i,
                    ]
                : [
                    /\b(order now|place order|submit order|request)\b/i,
                    /\badd to cart\b/i,
                    /\b(proceed to checkout|checkout)\b/i,
                    /\border\b/i,
                  ];
              for (const pattern of patterns) {
                const control = findByPattern(pattern);
                if (control) return control;
              }
              return undefined;
            };

            const configured: string[] = [];
            const mismatches: string[] = [];
            const currentItemNames = itemNameCandidates();
            if (input.expectedItem) {
              if (expectedItemMatches(input.expectedItem, currentItemNames)) {
                configured.push(`Catalog item=${input.expectedItem}`);
              } else {
                mismatches.push(
                  `Catalog item mismatch: expected ${input.expectedItem}; visible ${currentItemNames.length ? currentItemNames.join(" | ") : "(unknown)"}.`,
                );
              }
            }
            const cartReady = cartCheckoutVisible();
            const pageLooksCatalog =
              /catalog|cat_item|service catalog|order now|request/i.test(
                `${location.href} ${document.title} ${document.body?.innerText || ""}`,
              );

            for (const field of input.textFields) {
              const control = findTextControl(field.field);
              if (!control) {
                mismatches.push(`Text field not found: ${field.field}.`);
                continue;
              }
              setNativeValue(control, field.value);
              configured.push(`${field.field}="${field.value}"`);
            }

            for (const field of input.optionFields) {
              const control = findOptionControl(field.field, field.value);
              if (control) {
                const option = selectOptionFor(control, field.value);
                if (!option) {
                  mismatches.push(
                    `Option not found for ${field.field}: ${field.value}.`,
                  );
                  continue;
                }
                setNativeValue(control, option.value);
                const selectedText =
                  control.selectedOptions[0]?.textContent?.trim() ||
                  control.value;
                if (
                  norm(control.value) !== norm(option.value) &&
                  norm(selectedText) !== norm(field.value)
                ) {
                  mismatches.push(
                    `Option ${field.field} is ${selectedText || control.value}.`,
                  );
                } else {
                  configured.push(`${field.field}=${selectedText || option.value}`);
                }
                continue;
              }
              const radioControl = findRadioOptionControl(field.field, field.value);
              if (!radioControl) {
                mismatches.push(`Option field not found: ${field.field}.`);
                continue;
              }
              const selected = setRadioOptionControlState(
                radioControl,
                field.value,
              );
              if (!selected) {
                mismatches.push(`Option ${field.field} was not selected.`);
              } else {
                configured.push(
                  `${field.field}=${radioDisplayValueFor(radioControl) || field.value}`,
                );
              }
            }

            for (const checkbox of input.checkboxes) {
              const control = findCheckbox(checkbox.label);
              if (!control) {
                mismatches.push(`Checkbox not found: ${checkbox.label}.`);
                continue;
              }
              const after = setCheckboxControlState(
                control,
                checkbox.checked,
                true,
              );
              if (after !== null && after !== checkbox.checked) {
                mismatches.push(
                  `Checkbox ${checkbox.label} is ${after ? "checked" : "unchecked"}.`,
                );
              } else {
                configured.push(
                  `${checkbox.label}=${checkbox.checked ? "checked" : "unchecked"}`,
                );
              }
            }

            if (input.quantity !== null) {
              const quantity = findQuantity();
              if (!quantity) {
                if (pageLooksCatalog && hasOrderOrCartSubmitControl()) {
                  quantityDeferredToCart = true;
                  configured.push(
                    `Quantity=${input.quantity} (defer to cart/checkout; no item-page quantity control)`,
                  );
                } else {
                  mismatches.push(
                    `Quantity control not found for ${input.quantity}.`,
                  );
                }
              } else if (quantity instanceof HTMLSelectElement) {
                const option = [...quantity.options].find(
                  (candidate) =>
                    norm(candidate.value) === norm(input.quantity) ||
                    norm(candidate.textContent) === norm(input.quantity),
                );
                if (!option) {
                  mismatches.push(
                    `Quantity option not found for ${input.quantity}.`,
                  );
                } else {
                  setNativeValue(quantity, option.value);
                  setRelatedQuantityControls(option.value, quantity);
                  const selectedText =
                    quantity.selectedOptions[0]?.textContent?.trim() ||
                    quantity.value;
                  if (
                    norm(quantity.value) !== norm(option.value) &&
                    norm(selectedText) !== norm(input.quantity)
                  ) {
                    mismatches.push(
                      `Quantity is ${selectedText || quantity.value}.`,
                    );
                  } else {
                    configured.push(`Quantity=${selectedText || option.value}`);
                  }
                }
              } else {
                setNativeValue(quantity, input.quantity);
                setRelatedQuantityControls(input.quantity, quantity);
                if (norm(quantity.value) !== norm(input.quantity)) {
                  mismatches.push(`Quantity is ${quantity.value}.`);
                } else {
                  configured.push(`Quantity=${input.quantity}`);
                }
              }
            }

            if (input.submit && configured.length > 0 && mismatches.length === 0) {
              await sleep(2_000);
              for (const checkbox of input.checkboxes) {
                const control = findCheckbox(checkbox.label);
                if (control) {
                  setCheckboxControlState(control, checkbox.checked, false);
                }
              }
            }

            let submitControl =
              mismatches.length === 0 && input.submit
                ? findSubmitControl()
                : null;
            let submitClicked = false;
            let submitLabel: string | null = null;
            if (input.submit && mismatches.length === 0) {
              if (!submitControl) {
                mismatches.push("Submit/order control not found.");
              } else {
                const submitInput = submitControl as HTMLInputElement;
                const submitLabels = [
                  submitControl.textContent,
                  submitInput.value,
                  submitControl.getAttribute("aria-label"),
                  submitControl.getAttribute("title"),
                  ...directLabelsFor(submitControl),
                ]
                  .map(display)
                  .filter(Boolean);
                submitLabel =
                  submitLabels.find((label) =>
                    /\b(add to cart|checkout|order|request|submit)\b/i.test(
                      label,
                    ),
                  ) ||
                  submitLabels[0] ||
                  submitControl.textContent ||
                  "submit";
                if (cartReady && /\badd to cart\b/i.test(submitLabel)) {
                  mismatches.push(
                    "Cart already has checkout controls; refusing duplicate Add to Cart.",
                  );
                  submitControl = null;
                } else {
                  submitControl.click();
                  submitClicked = true;
                }
              }
            }

            return {
              matched:
                pageLooksCatalog ||
                configured.length > 0 ||
                mismatches.length > 0,
              ok: mismatches.length === 0 && (!input.submit || submitClicked),
              url: location.href,
              title: document.title,
              configured,
              mismatches,
              cartReady,
              submitClicked,
              submitLabel,
              quantityDeferredToCart,
              currentItemNames,
            };
          },
          args: [
            {
              expectedItem,
              quantity,
              textFields,
              optionFields,
              checkboxes,
              submit,
              submitButton,
              continueToCheckout,
            },
          ],
        });

        const plans = (results || [])
          .map((result) => result.result as Record<string, unknown> | undefined)
          .filter((result): result is Record<string, unknown> =>
            Boolean(result),
          );
        const configuredCount = (plan: Record<string, unknown>) =>
          Array.isArray(plan.configured) ? plan.configured.length : 0;
        const mismatchCount = (plan: Record<string, unknown>) =>
          Array.isArray(plan.mismatches) ? plan.mismatches.length : 0;
        const bestMatched = plans
          .filter((plan) => plan.matched === true)
          .sort(
            (a, b) =>
              configuredCount(b) - configuredCount(a) ||
              mismatchCount(a) - mismatchCount(b),
          )[0];
        const selected =
          plans.find((plan) => plan.ok === true) ||
          bestMatched;

        if (!selected) {
          return "Error: Could not find a catalog item form on the current page.";
        }

        if (selected.submitClicked === true) {
          await waitForNavigation(tabId, 12_000);
          await waitForDomReady(tabId, {
            timeoutMs: 2_000,
            waitForElements: true,
          });
        }

        let checkoutClick: Record<string, unknown> | null = null;
        const clickedSubmitLabel = String(selected.submitLabel || "");
        const shouldContinueFromCart =
          continueToCheckout &&
          selected.submitClicked === true &&
          /\badd to cart\b/i.test(clickedSubmitLabel);

        if (shouldContinueFromCart) {
          const checkoutResults = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "MAIN" as any,
            func: async (requestedQuantity: string | null) => {
              const sleep = (ms: number) =>
                new Promise((resolve) => setTimeout(resolve, ms));
              const display = (value: unknown) =>
                String(value ?? "")
                  .replace(/\s+/g, " ")
                  .trim();
              const visible = (el: Element | null) => {
                if (!el || !(el instanceof HTMLElement)) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  style.opacity !== "0" &&
                  rect.width > 0 &&
                  rect.height > 0
                );
              };
              const labelsFor = (el: Element): string[] => {
                const control = el as HTMLInputElement;
                const id = el.getAttribute("id");
                return [
                  el.getAttribute("aria-label"),
                  el.getAttribute("title"),
                  el.getAttribute("name"),
                  el.getAttribute("id"),
                  id
                    ? document.querySelector(
                        `label[for="${window.CSS?.escape ? window.CSS.escape(id) : id.replace(/["\\]/g, "\\$&")}"]`,
                      )?.textContent
                    : null,
                  control.value,
                  el.textContent,
                ]
                  .map(display)
                  .filter(Boolean);
              };
              const norm = (value: unknown) => display(value).toLowerCase();
              const triggerEvents = (
                el: HTMLInputElement | HTMLSelectElement,
              ) => {
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("blur", { bubbles: true }));
              };
              const setNativeValue = (
                el: HTMLInputElement | HTMLSelectElement,
                value: string,
              ) => {
                try {
                  el.scrollIntoView({ behavior: "instant", block: "center" });
                  el.focus();
                } catch {
                  // Best-effort for browser and test DOMs.
                }
                if (el instanceof HTMLSelectElement) {
                  const option = [...el.options].find(
                    (candidate) =>
                      norm(candidate.value) === norm(value) ||
                      norm(candidate.textContent) === norm(value),
                  );
                  if (!option) return false;
                  el.value = option.value;
                  triggerEvents(el);
                  return true;
                }
                el.value = value;
                triggerEvents(el);
                return norm(el.value) === norm(value);
              };
              const setCartQuantity = () => {
                if (!requestedQuantity) return null;
                const controls = [
                  ...document.querySelectorAll(
                    "select, input:not([type='button']):not([type='submit']):not([type='hidden'])",
                  ),
                ] as Array<HTMLInputElement | HTMLSelectElement>;
                const quantityControl = controls.find((el) =>
                  labelsFor(el).some((label) => /\b(quantity|qty)\b/i.test(label)),
                );
                if (!quantityControl) return false;
                return setNativeValue(quantityControl, requestedQuantity);
              };
              const currentBodyText = () =>
                display(document.body?.innerText || document.body?.textContent || "");
              const cartReady = () => {
                const text = currentBodyText();
                return (
                  /\b(cart|basket|bag)\b/i.test(text) &&
                  /\b(proceed to checkout|continue to checkout|checkout)\b/i.test(
                    text,
                  )
                );
              };
              const findCheckoutControl = () => {
                const controls = [
                  ...document.querySelectorAll(
                    "button, input[type='button'], input[type='submit'], a, [role='button']",
                  ),
                ].filter(visible);
                return controls.find((el) =>
                  labelsFor(el).some((label) =>
                    /\b(proceed to checkout|continue to checkout|checkout)\b/i.test(
                      label,
                    ),
                  ),
                ) as HTMLElement | undefined;
              };

              const deadline = Date.now() + 3_000;
              do {
                const control = findCheckoutControl();
                if (control && cartReady()) {
                  const quantityConfigured = setCartQuantity();
                  if (quantityConfigured === true) {
                    await sleep(500);
                  }
                  const labels = labelsFor(control);
                  const label =
                    labels.find((value) =>
                      /\b(proceed to checkout|continue to checkout|checkout)\b/i.test(
                        value,
                      ),
                    ) ||
                    labels[0] ||
                    control.textContent ||
                    "checkout";
                  control.click();
                  return {
                    cartReady: true,
                    clicked: true,
                    label,
                    url: location.href,
                    title: document.title,
                    quantityConfigured,
                  };
                }
                await sleep(150);
              } while (Date.now() < deadline);

              return {
                cartReady: cartReady(),
                clicked: false,
                label: null,
                url: location.href,
                title: document.title,
                quantityConfigured: setCartQuantity(),
              };
            },
            args: [quantity],
          });
          const checkoutPlans = (checkoutResults || [])
            .map(
              (result) =>
                result.result as Record<string, unknown> | undefined,
            )
            .filter((result): result is Record<string, unknown> =>
              Boolean(result),
            );
          checkoutClick =
            checkoutPlans.find((plan) => plan.clicked === true) || null;
          if (checkoutClick?.clicked === true) {
            await waitForNavigation(tabId, 12_000);
            await waitForDomReady(tabId, {
              timeoutMs: 2_000,
              waitForElements: true,
            });
          }
        }

        const tab = await chrome.tabs.get(tabId);
        const configured = Array.isArray(selected.configured)
          ? selected.configured.map(String)
          : [];
        const mismatches = Array.isArray(selected.mismatches)
          ? selected.mismatches.map(String)
          : [];
        const lines = [
          selected.ok
            ? "Configured catalog item."
            : "Catalog item configuration incomplete.",
          configured.length ? `Configured:\n- ${configured.join("\n- ")}` : "",
          mismatches.length ? `Mismatches:\n- ${mismatches.join("\n- ")}` : "",
          Array.isArray(selected.currentItemNames) &&
          selected.currentItemNames.length > 0
            ? `Current catalog item: ${selected.currentItemNames.map(String).slice(0, 3).join(" | ")}`
            : "",
          selected.cartReady === true
            ? "Cart/order controls are already visible. Do not add the same item again; inspect cart state and proceed only if line count and quantity match the request."
            : "",
          selected.submitClicked
            ? `Clicked submit control: ${String(selected.submitLabel || "submit")}`
            : "",
          checkoutClick?.quantityConfigured === true
            ? `Configured cart quantity: ${quantity}`
            : "",
          checkoutClick?.clicked === true
            ? `Clicked cart checkout control: ${String(checkoutClick.label || "checkout")}`
            : "",
          `Current URL: ${tab.url || selected.url || ""}`,
          `Current title: ${tab.title || selected.title || ""}`,
        ];
        return lines.filter(Boolean).join("\n");
      } catch (e: any) {
        return `Error configuring catalog item: ${e.message}`;
      }
    },
  );
}
