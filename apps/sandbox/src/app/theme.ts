import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import productTokens from "../../../../packages/ui-tokens/tokens.json";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        paper: { value: productTokens.colors.canvas },
        surface: { value: productTokens.colors.surface },
        ink: { value: productTokens.colors.text },
        muted: { value: productTokens.colors.textMuted },
        accent: { value: productTokens.colors.accent },
        accentStrong: { value: productTokens.colors.accentStrong },
        line: { value: productTokens.colors.line },
        success: { value: productTokens.colors.success },
        danger: { value: productTokens.colors.danger },
      },
      fonts: {
        body: { value: "'Segoe UI', system-ui, sans-serif" },
        heading: {
          value: "'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
        },
      },
      radii: { card: { value: productTokens.radii.card } },
      shadows: {
        card: {
          value: productTokens.shadows.card,
        },
      },
    },
    semanticTokens: {
      colors: {
        bg: { value: { base: "{colors.paper}" } },
        fg: { value: { base: "{colors.ink}" } },
        focusRing: { value: { base: "{colors.accent}" } },
      },
    },
  },
  globalCss: {
    "html, body, #root": { minHeight: "100%" },
    body: { bg: "bg", color: "fg" },
    "*:focus-visible": {
      outline: "3px solid",
      outlineColor: "focusRing",
      outlineOffset: "2px",
    },
  },
});

export const openSidebarSystem = createSystem(defaultConfig, config);
