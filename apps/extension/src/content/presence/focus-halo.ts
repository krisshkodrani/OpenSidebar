/**
 * LP-24 presence layer — field focus halo (RFC §5 text-field grammar).
 *
 * A soft glow aura drawn around the field: 180ms fade-in, auto-fades after
 * HALO_TTL_MS. It deliberately does NOT persist until the next action — the
 * per-turn capture suspend would hide and re-show it, which reads as the
 * highlight appearing twice (owner report, 2026-07-24). One halo at a time.
 */

export const HALO_TTL_MS = 900;

export class FocusHalo {
  private el: HTMLElement | null = null;
  private target: Element | null = null;
  private ttlTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.ttlTimer = setTimeout(() => this.clear(), HALO_TTL_MS);
  }

  /** Fade and remove; safe to call when nothing is shown. */
  clear(): void {
    if (this.ttlTimer) clearTimeout(this.ttlTimer);
    this.ttlTimer = null;
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
