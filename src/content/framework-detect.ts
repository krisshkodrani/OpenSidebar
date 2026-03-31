/**
 * Detect the SPA framework running on the current page.
 * Used by DOM_READY_PROBE to choose the optimal settle strategy.
 * Result is cached — framework doesn't change during a page session.
 */

export type Framework = "react" | "vue" | "angular" | "unknown";

let cached: Framework | null = null;

export function detectFramework(): Framework {
  if (cached) return cached;

  // React: devtools hook (injected by React itself, not just devtools extension)
  // or data-reactroot attribute on the mount point
  if (
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
    document.querySelector("[data-reactroot]") ||
    document.querySelector("[data-react-root]")
  ) {
    cached = "react";
    return cached;
  }

  // Vue: global __VUE__ or devtools hook
  if ((window as any).__VUE__ || (window as any).__VUE_DEVTOOLS_GLOBAL_HOOK__) {
    cached = "vue";
    return cached;
  }

  // Angular: testability API or ng global
  if ((window as any).getAllAngularTestabilities || (window as any).ng) {
    cached = "angular";
    return cached;
  }

  cached = "unknown";
  return cached;
}

/** Reset cache (for testing or after navigation) */
export function resetFrameworkCache(): void {
  cached = null;
}
