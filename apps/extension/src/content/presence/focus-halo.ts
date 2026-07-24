/**
 * LP-24 presence layer — field focus halo (RFC §5 text-field grammar).
 *
 * A rounded-rect outline drawn around the field border: 180ms fade-in,
 * subtle breathing at a 4s period, persists while the field stays the
 * action target, fades on retarget or explicit clear. One halo at a time.
 */

export class FocusHalo {
  private el: HTMLElement | null = null;
  private target: Element | null = null;

  constructor(private getLayer: () => HTMLElement | null) {}

  show(target: Element): void {
    if (this.target === target && this.el) return;
    this.clear();
    const layer = this.getLayer();
    const doc = layer?.ownerDocument;
    if (!layer || !doc) return;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const el = doc.createElement("div");
    el.className = "halo";
    el.style.left = `${rect.left - 3}px`;
    el.style.top = `${rect.top - 3}px`;
    el.style.width = `${rect.width + 2}px`;
    el.style.height = `${rect.height + 2}px`;
    layer.appendChild(el);
    // Next frame so the opacity transition runs.
    requestAnimationFrame(() => el.classList.add("visible"));
    this.el = el;
    this.target = target;
  }

  /** Fade and remove; safe to call when nothing is shown. */
  clear(): void {
    const el = this.el;
    this.el = null;
    this.target = null;
    if (!el) return;
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 220);
  }

  /** Halo survives only while the same element stays the action target. */
  retargetCheck(nextTarget: Element | null): void {
    if (this.target && this.target !== nextTarget) this.clear();
  }
}
