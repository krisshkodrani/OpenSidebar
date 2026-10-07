import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        paper: { value: "var(--os-canvas)" },
        surface: { value: "var(--os-surface)" },
        ink: { value: "var(--os-text)" },
        muted: { value: "var(--os-muted)" },
        accent: { value: "var(--os-accent)" },
        accentStrong: { value: "var(--os-accent-strong)" },
        line: { value: "var(--os-line)" },
        success: { value: "var(--os-success)" },
        danger: { value: "var(--os-danger)" },
      },
      fonts: {
        body: { value: "'OpenSidebar Sans', system-ui, sans-serif" },
        heading: { value: "'OpenSidebar Sans', system-ui, sans-serif" },
      },
      radii: { card: { value: "10px" } },
      shadows: { card: { value: "none" } },
    },
    semanticTokens: {
      colors: {
        bg: { value: "{colors.paper}" },
        fg: { value: "{colors.ink}" },
        focusRing: { value: "{colors.accent}" },
      },
    },
  },
  globalCss: {
    "html, body, #root": { minHeight: "100%" },
    body: { bg: "bg", color: "fg" },
    "*:focus-visible": {
      outline: "3px solid",
      outlineColor: "focusRing",
      outlineOffset: "3px",
    },
  },
});
export const openSidebarSystem = createSystem(defaultConfig, config);
