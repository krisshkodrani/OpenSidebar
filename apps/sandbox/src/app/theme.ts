import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import tokens from "../../../../packages/ui-tokens/tokens.json";
const color = (light: string, dark: string) => ({
  value: { base: light, _dark: dark },
});
export const openSidebarSystem = createSystem(
  defaultConfig,
  defineConfig({
    conditions: { light: ":root:not(.dark) &, .light &" },
    theme: {
      tokens: {
        fonts: {
          body: { value: "Inter, 'Segoe UI', system-ui, sans-serif" },
          heading: { value: "Inter, 'Segoe UI', system-ui, sans-serif" },
        },
        colors: {
          brand: {
            50: { value: "#EAF4EF" },
            100: { value: "#D4E9DD" },
            200: { value: "#AED9C7" },
            300: { value: "#81C3AA" },
            400: { value: "#4DA88E" },
            500: { value: "#238577" },
            600: { value: tokens.colors.accent },
            700: { value: tokens.colors.accentStrong },
            800: { value: "#103F3C" },
            900: { value: "#102F2D" },
          },
        },
        radii: {
          card: { value: tokens.radii.card },
          control: { value: tokens.radii.control },
        },
        shadows: { card: { value: "0 1px 3px rgb(0 0 0 / 0.04)" } },
      },
      semanticTokens: {
        colors: {
          bg: color(tokens.colors.canvas, tokens.darkColors.canvas),
          fg: color(tokens.colors.text, tokens.darkColors.text),
          surface: color(tokens.colors.surface, tokens.darkColors.surface),
          surfaceMuted: color(tokens.colors.surfaceMuted, tokens.darkColors.surfaceMuted),
          muted: color(tokens.colors.textMuted, tokens.darkColors.textMuted),
          line: color(tokens.colors.line, tokens.darkColors.line),
          accent: color(tokens.colors.accent, tokens.darkColors.accent),
          accentStrong: color(tokens.colors.accentStrong, tokens.darkColors.accentStrong),
          highlight: color(tokens.colors.highlight, tokens.darkColors.highlight),
          success: color(tokens.colors.success, tokens.darkColors.success),
          danger: color(tokens.colors.danger, tokens.darkColors.danger),
          focusRing: color(tokens.colors.accent, tokens.darkColors.accent),
          brand: {
            solid: color(tokens.colors.accent, tokens.darkColors.accent),
            contrast: color("#FFFFFF", tokens.darkColors.canvas),
            fg: color(tokens.colors.accentStrong, tokens.darkColors.accent),
            muted: color("#D4E9DD", "#21362E"),
            subtle: color("#EAF4EF", "#172621"),
            emphasized: color("#D4E9DD", "#21362E"),
            focusRing: color(tokens.colors.accent, tokens.darkColors.accent),
          },
        },
      },
      recipes: {
        button: {
          base: {
            borderRadius: "control",
            fontWeight: "600",
            colorPalette: "brand",
          },
          defaultVariants: { size: "sm" },
        },
        heading: { base: { fontWeight: "650", letterSpacing: "-0.025em" } },
        input: {
          base: { borderRadius: "control", bg: "surface", borderColor: "line" },
        },
      },
    },
    globalCss: {
      "html, body, #root": { minHeight: "100%" },
      body: { bg: "bg", color: "fg", fontSize: "sm" },
      "*:focus-visible": {
        outline: "2px solid",
        outlineColor: "focusRing",
        outlineOffset: "3px",
      },
      "[id]": { scrollMarginTop: "6rem" },
      "input[type=checkbox]": {
        accentColor: "accent",
        width: "4",
        height: "4",
      },
    },
  }),
);
