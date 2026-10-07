import { useState } from "react";
export type Appearance = "light" | "dark";
const storageKey = "opensidebar:workspace-appearance";
function apply(value: Appearance) {
  document.documentElement.dataset.osTheme = value;
  document.documentElement.classList.toggle("dark", value === "dark");
  document.documentElement.style.colorScheme = value;
}
export function initializeAppearance() {
  let value: Appearance = "light";
  try {
    value = localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
  } catch {
    /* Storage can be disabled. */
  }
  apply(value);
}
export function useAppearance() {
  const [value, setValue] = useState<Appearance>(() =>
    document.documentElement.dataset.osTheme === "dark" ? "dark" : "light",
  );
  return [
    value,
    () => {
      const next = value === "light" ? "dark" : "light";
      apply(next);
      setValue(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* Preference remains valid for this page. */
      }
    },
  ] as const;
}
