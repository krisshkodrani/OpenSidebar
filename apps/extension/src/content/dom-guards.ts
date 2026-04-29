/**
 * Cross-document DOM type guards.
 *
 * Elements discovered through same-origin iframes belong to that frame's
 * JavaScript realm. Top-window `instanceof HTMLInputElement` checks reject
 * those valid controls, so use the element's ownerDocument constructors.
 */

function getRealmCtor(
  el: Element,
  name: string,
): Function | null {
  const view = el.ownerDocument?.defaultView ?? window;
  const ctor = (view as unknown as Record<string, unknown>)[name];
  return typeof ctor === "function" ? ctor : null;
}

function isRealmInstance(
  el: Element | null,
  ctorName: string,
  fallbackTagName: string,
): boolean {
  if (!el) return false;
  const ctor = getRealmCtor(el, ctorName);
  if (ctor && el instanceof ctor) return true;
  return el.tagName.toLowerCase() === fallbackTagName;
}

export function isHtmlElement(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const ctor = getRealmCtor(el, "HTMLElement");
  if (ctor && el instanceof ctor) return true;
  return el instanceof HTMLElement;
}

export function isInputElement(el: Element | null): el is HTMLInputElement {
  return isRealmInstance(el, "HTMLInputElement", "input");
}

export function isTextAreaElement(
  el: Element | null,
): el is HTMLTextAreaElement {
  return isRealmInstance(el, "HTMLTextAreaElement", "textarea");
}

export function isSelectElement(el: Element | null): el is HTMLSelectElement {
  return isRealmInstance(el, "HTMLSelectElement", "select");
}

export function isFormElement(el: Element | null): el is HTMLFormElement {
  return isRealmInstance(el, "HTMLFormElement", "form");
}

export function isButtonElement(el: Element | null): el is HTMLButtonElement {
  return isRealmInstance(el, "HTMLButtonElement", "button");
}

export function isAnchorElement(el: Element | null): el is HTMLAnchorElement {
  return isRealmInstance(el, "HTMLAnchorElement", "a");
}

