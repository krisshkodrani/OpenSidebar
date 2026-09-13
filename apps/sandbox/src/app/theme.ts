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
          body: { value: "'Segoe UI', system-ui, sans-serif" },
          heading: { value: "'Segoe UI', system-ui, sans-serif" },
        },
        radii: {
          card: { value: tokens.radii.card },
          control: { value: tokens.radii.control },
        },
        shadows: { card: { value: "0 1px 3px rgb(0 0 0 / 0.04)" } },
      },
      semanticTokens: {
        colors: {
          bg: color(tokens.colors.canvas, "#0B1120"),
          fg: color(tokens.colors.text, "#F1F5F9"),
          surface: color(tokens.colors.surface, "#141E30"),
          surfaceMuted: color(tokens.colors.surfaceMuted, "#1E293B"),
          muted: color("#526176", "#A8B7CD"),
          line: color(tokens.colors.line, "#334155"),
          accent: color(tokens.colors.accent, "#93C5FD"),
          accentStrong: color(tokens.colors.accentStrong, "#BFDBFE"),
          success: color(tokens.colors.success, "#86EFAC"),
          danger: color(tokens.colors.danger, "#FCA5A5"),
          focusRing: color(tokens.colors.accent, "#93C5FD"),
        },
      },
      recipes: {
        button: {
          base: {
            borderRadius: "control",
            fontWeight: "600",
            colorPalette: "blue",
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
