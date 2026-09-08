import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import productTokens from "../../../../packages/ui-tokens/tokens.json";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        paper: { value: productTokens.colors.canvas },
        surfaceBase: { value: productTokens.colors.surface },
        ink: { value: productTokens.colors.text },
        mutedBase: { value: productTokens.colors.textMuted },
        accentBase: { value: productTokens.colors.accent },
        accentStrongBase: { value: productTokens.colors.accentStrong },
        lineBase: { value: productTokens.colors.line },
        successBase: { value: productTokens.colors.success },
        warningBase: { value: productTokens.colors.warning },
        dangerBase: { value: productTokens.colors.danger },
        surfaceMutedBase: { value: productTokens.colors.surfaceMuted },
        darkPaper: { value: productTokens.darkColors.canvas },
        darkSurface: { value: productTokens.darkColors.surface },
        darkSurfaceMuted: { value: productTokens.darkColors.surfaceMuted },
        darkInk: { value: productTokens.darkColors.text },
        darkMuted: { value: productTokens.darkColors.textMuted },
        darkAccent: { value: productTokens.darkColors.accent },
        darkAccentStrong: { value: productTokens.darkColors.accentStrong },
        darkLine: { value: productTokens.darkColors.line },
        darkSuccess: { value: productTokens.darkColors.success },
        darkWarning: { value: productTokens.darkColors.warning },
        darkDanger: { value: productTokens.darkColors.danger },
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
        bg: { value: { base: "{colors.paper}", _dark: "{colors.darkPaper}" } },
        fg: { value: { base: "{colors.ink}", _dark: "{colors.darkInk}" } },
        surface: {
          value: {
            base: "{colors.surfaceBase}",
            _dark: "{colors.darkSurface}",
          },
        },
        surfaceMuted: {
          value: {
            base: "{colors.surfaceMutedBase}",
            _dark: "{colors.darkSurfaceMuted}",
          },
        },
        muted: {
          value: { base: "{colors.mutedBase}", _dark: "{colors.darkMuted}" },
        },
        accent: {
          value: { base: "{colors.accentBase}", _dark: "{colors.darkAccent}" },
        },
        accentStrong: {
          value: {
            base: "{colors.accentStrongBase}",
            _dark: "{colors.darkAccentStrong}",
          },
        },
        line: {
          value: { base: "{colors.lineBase}", _dark: "{colors.darkLine}" },
        },
        success: {
          value: {
            base: "{colors.successBase}",
            _dark: "{colors.darkSuccess}",
          },
        },
        warning: {
          value: {
            base: "{colors.warningBase}",
            _dark: "{colors.darkWarning}",
          },
        },
        danger: {
          value: { base: "{colors.dangerBase}", _dark: "{colors.darkDanger}" },
        },
        focusRing: {
          value: { base: "{colors.accentBase}", _dark: "{colors.darkAccent}" },
        },
      },
    },
  },
  globalCss: {
    "html, body, #root": { minHeight: "100%" },
    body: { bg: "bg", color: "fg", margin: "0" },
    "button, input, select, textarea": { font: "inherit" },
    a: { color: "inherit", textDecoration: "none" },
    "*:focus-visible": {
      outline: "3px solid",
      outlineColor: "focusRing",
      outlineOffset: "2px",
    },
  },
});

export const openSidebarSystem = createSystem(defaultConfig, config);
