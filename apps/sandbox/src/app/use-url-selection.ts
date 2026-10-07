import { useSyncExternalStore } from "react";
export function useUrlSelection(key: string) {
  const value = useSyncExternalStore(
    (listener) => {
      window.addEventListener("popstate", listener);
      return () => window.removeEventListener("popstate", listener);
    },
    () => new URLSearchParams(location.search).get(key),
  );
  const setValue = (next: string | null) => {
    const url = new URL(location.href);
    if (next) url.searchParams.set(key, next);
    else url.searchParams.delete(key);
    history.pushState(null, "", url.pathname + url.search + url.hash);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return [value, setValue] as const;
}
