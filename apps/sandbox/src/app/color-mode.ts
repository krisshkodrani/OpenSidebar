export type ControlColorMode = "light" | "dark" | "system";

const storageKey = "opensidebar:control:color-mode";
const eventName = "opensidebar:color-mode";

function isMode(value: string | null): value is ControlColorMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readColorMode(): ControlColorMode {
  const stored = localStorage.getItem(storageKey);
  return isMode(stored) ? stored : "system";
}

export function applyColorMode(mode: ControlColorMode) {
  localStorage.setItem(storageKey, mode);
  const dark =
    mode === "dark" ||
    (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  window.dispatchEvent(new CustomEvent(eventName, { detail: mode }));
}

export function watchColorMode() {
  applyColorMode(readColorMode());
  const media = matchMedia("(prefers-color-scheme: dark)");
  const sync = () => {
    if (readColorMode() === "system") applyColorMode("system");
  };
  media.addEventListener("change", sync);
  return () => media.removeEventListener("change", sync);
}
