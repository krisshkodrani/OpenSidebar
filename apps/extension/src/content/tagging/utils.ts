import {
  isInputElement,
  isSelectElement,
  isTextAreaElement,
} from "../dom-guards";

/**
 * Tagging utilities - visibility, role inference, text extraction, attribute parsing
 */

/** Priority attributes for agent identification (AgentOccam hierarchy) */
const PRIORITY_ATTRS = [
  "id",
  "data-testid",
  "name",
  "href",
  "src",
  "type",
  "placeholder",
  "value",
  "role",
  "aria-label",
  "aria-roledescription",
  "alt",
  "title",
  "draggable",
];

/** Max chars per attribute value */
const ATTR_TRUNCATION = 60;

export function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);

  // Must have non-zero dimensions
  if (rect.width === 0 || rect.height === 0) return false;

  // Must not be hidden via CSS
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;

  // Must not be clipped entirely
  if (style.clip === "rect(0px, 0px, 0px, 0px)") return false;

  return true;
}

/** Mark an element as dismissed via data attribute (survives framework re-renders). */
export function dismissElement(el: HTMLElement): void {
  if (!document.getElementById("osb-dismiss-style")) {
    const style = document.createElement("style");
    style.id = "osb-dismiss-style";
    style.textContent = "[data-osb-dismissed] { display: none !important; }";
    document.documentElement.appendChild(style);
  }
  el.setAttribute("data-osb-dismissed", "true");
}

export function inferRole(el: Element): string {
  const checkboxOrRadio = getCheckboxOrRadioControl(el);
  if (checkboxOrRadio) return checkboxOrRadio.type;

  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "input") return (el as HTMLInputElement).type || "textbox";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  return tag;
}

export function getLabelControl(el: Element | null): Element | null {
  if (!el || el.tagName.toLowerCase() !== "label") return null;

  const label = el as HTMLLabelElement;
  const explicitFor = label.htmlFor || el.getAttribute("for");
  if (explicitFor) {
    return el.ownerDocument.getElementById(explicitFor);
  }

  if (label.control) {
    return label.control;
  }

  return el.querySelector("input, textarea, select, button");
}

export function getCheckboxOrRadioControl(
  el: Element | null,
): HTMLInputElement | null {
  if (isInputElement(el) && (el.type === "checkbox" || el.type === "radio")) {
    return el;
  }

  const control = getLabelControl(el);
  if (
    isInputElement(control) &&
    (control.type === "checkbox" || control.type === "radio")
  ) {
    return control;
  }

  return null;
}

export function getVisibleText(el: Element): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  const text = el.textContent?.trim();
  if (text) return text;

  if (isInputElement(el)) {
    return el.value || el.placeholder || "";
  }

  return "";
}

export function extractAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const name of PRIORITY_ATTRS) {
    const val = el.getAttribute(name);
    if (!val || val.length === 0) continue;

    if ((name === "id" || name === "name") && isRandomHash(val)) continue;

    attrs[name] = val.slice(0, ATTR_TRUNCATION);
  }

  const checkboxOrRadio = getCheckboxOrRadioControl(el);
  if (checkboxOrRadio) {
    attrs["type"] = checkboxOrRadio.type;
    attrs["checked"] = String(checkboxOrRadio.checked);
    if (checkboxOrRadio.id && !isRandomHash(checkboxOrRadio.id)) {
      attrs["control"] = checkboxOrRadio.id;
    }
    if (checkboxOrRadio.name && !isRandomHash(checkboxOrRadio.name)) {
      attrs["name"] = checkboxOrRadio.name.slice(0, ATTR_TRUNCATION);
    }
  }

  // Select element: surface available options so LLM doesn't guess blind
  if (isSelectElement(el)) {
    const opts = Array.from(el.options)
      .map((o) => o.textContent?.trim() || o.value)
      .filter(Boolean);
    if (opts.length > 0) {
      attrs["options"] = truncateText(opts.join(" | "), ATTR_TRUNCATION * 2);
    }
    if (el.value) {
      const selected = el.options[el.selectedIndex];
      if (selected) {
        attrs["selected"] = selected.textContent?.trim() || selected.value;
      }
    }
  }

  // Form-specific label association
  if (
    isInputElement(el) ||
    isTextAreaElement(el) ||
    isSelectElement(el)
  ) {
    const elId = el.getAttribute("id");
    if (elId) {
      const labelEl = document.querySelector(
        `label[for="${CSS.escape(elId)}"]`,
      );
      if (labelEl)
        attrs["label"] = truncateText(labelEl.textContent?.trim() || "", 40);
    }
    if (!attrs["label"]) {
      const parentLabel = el.closest("label");
      if (parentLabel) {
        const labelText = parentLabel.textContent
          ?.trim()
          .replace(el.value || "", "")
          .trim();
        if (labelText) attrs["label"] = truncateText(labelText, 40);
      }
    }
  }

  // General aria-labelledby resolution
  if (!attrs["label"] && !attrs["aria-label"]) {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts: string[] = [];
      for (const refId of labelledBy.split(/\s+/)) {
        const refEl = document.getElementById(refId);
        if (refEl) {
          const txt = refEl.textContent?.trim();
          if (txt) parts.push(txt);
        }
      }
      if (parts.length > 0) {
        attrs["label"] = truncateText(parts.join(" "), 40);
      }
    }
  }

  // Deduplicate: aria-label supersedes title and alt
  if (attrs["aria-label"]) {
    delete attrs["title"];
    delete attrs["alt"];
  }

  // Deduplicate: placeholder redundant when label already describes the field
  if (attrs["placeholder"] && attrs["label"]) {
    delete attrs["placeholder"];
  }

  // Detect drop zone — JS event handlers aren't HTML attributes, check properties
  if (
    typeof (el as any).ondrop === "function" ||
    typeof (el as any).ondragover === "function" ||
    el.hasAttribute("dropzone") ||
    (el as HTMLElement).dataset?.droptarget ||
    (el as HTMLElement).dataset?.dropzone
  ) {
    attrs["dropzone"] = "true";
  }

  // State attributes
  if (el.hasAttribute("disabled")) attrs["disabled"] = "true";
  if (el.getAttribute("aria-expanded") === "true")
    attrs["aria-expanded"] = "true";
  if (el.getAttribute("aria-selected") === "true")
    attrs["aria-selected"] = "true";

  // Resolve aria-describedby
  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) {
    const parts: string[] = [];
    for (const refId of describedBy.split(/\s+/)) {
      const refEl = document.getElementById(refId);
      if (refEl) {
        const txt = refEl.textContent?.trim();
        if (txt) parts.push(txt);
      }
    }
    if (parts.length > 0) {
      attrs["description"] = truncateText(parts.join(" "), 80);
    }
  }

  // aria-description direct attribute
  if (!attrs["description"]) {
    const ariaDesc = el.getAttribute("aria-description");
    if (ariaDesc) {
      attrs["description"] = truncateText(ariaDesc, 80);
    }
  }

  // Visual style hints (color) for disambiguation
  try {
    const style = window.getComputedStyle(el);
    const bg = style.backgroundColor;
    // Only emit non-trivial backgrounds (skip transparent/rgba(0,0,0,0))
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      attrs["bg-color"] = bg;
    }
    const fg = style.color;
    if (fg) attrs["text-color"] = fg;
  } catch {
    // getComputedStyle can fail for detached elements
  }

  return attrs;
}

/**
 * Detect random hash/generated ID strings that waste tokens.
 * Tuned to preserve short, stable suffixes (e.g., "row-1a2b") while
 * still catching Webpack/Vite chunk hashes and CSS-module suffixes.
 */
export function isRandomHash(value: string): boolean {
  // Purely numeric HTML IDs (e.g., id="76", id="3") are auto-generated noise
  // that confuse the LLM into passing them as tool `id` parameters
  if (/^\d+$/.test(value)) return true;

  // Double-underscore suffixes are almost always CSS-module / build-tool noise
  if (/__[a-zA-Z0-9]{2,}$/.test(value)) return true;

  // React-generated IDs: multiple underscore-separated segments with mixed alphanumeric parts
  // e.g., "u_0_j_8W0000", "id_1_a2B3c4"
  if (/^([a-zA-Z0-9]_)+[a-zA-Z0-9]{4,}$/i.test(value)) return true;

  // Check trailing alphanumeric suffix after _ or -
  const suffixMatch = value.match(/[_-]([a-zA-Z0-9]{4,})$/);
  if (suffixMatch) {
    const suffix = suffixMatch[1];
    // Only strip if suffix is long enough (≥6) AND has mixed letters+digits
    // with roughly even entropy (rules out "row-1" or "step-2a" type patterns)
    if (suffix.length >= 6 && /\d/.test(suffix) && /[a-zA-Z]/.test(suffix)) {
      const digits = suffix.replace(/[^0-9]/g, "").length;
      const ratio = digits / suffix.length;
      // Random hashes have ~20-80% digit ratio; structured IDs tend to be outside this
      if (ratio > 0.2 && ratio < 0.8) return true;
    }
  }

  // Pure alphanumeric blobs without readable words (e.g., "xK9mQ2pL")
  if (/^[a-zA-Z0-9]{8,}$/.test(value) && !/[a-z]{3,}/.test(value)) return true;
  return false;
}

/** Smart truncation preserving head + tail for context */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const head = Math.floor(maxLength * 0.8);
  const tail = maxLength - head - 3;
  return text.slice(0, head) + "..." + text.slice(-tail);
}

export function isDisabled(el: Element): boolean {
  const checkboxOrRadio = getCheckboxOrRadioControl(el);
  if (checkboxOrRadio) {
    return checkboxOrRadio.disabled;
  }

  return (
    el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
  );
}
