/** @type {import('tailwindcss').Config} */

// Semantic colors come from packages/ui-tokens (CSS variables with RGB
// triplets). `.dark` on <html> switches every role, so components need no
// `dark:` color variants.
const role = (name) => `rgb(var(--os-${name}) / <alpha-value>)`;

module.exports = {
  content: [
    "./apps/extension/src/sidepanel/**/*.{js,ts,jsx,tsx,html}",
    "./apps/extension/src/trace-viewer/**/*.{js,ts,jsx,tsx,html}",
    "./apps/extension/src/overlay/**/*.{js,ts,jsx,tsx,html}",
    "./apps/extension/src/ui/**/*.{js,ts,jsx,tsx,html}",
    "./apps/extension/src/lib/**/*.{js,ts,jsx,tsx,html}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Inter"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      // Smallest text is 12px. Body text is 14px.
      fontSize: {
        "ui-caption": ["12px", { lineHeight: "16px" }],
        "ui-control": ["13px", { lineHeight: "18px" }],
        "ui-body": ["14px", { lineHeight: "20px" }],
        "ui-body-strong": ["14px", { lineHeight: "20px" }],
        "ui-section": ["15px", { lineHeight: "22px" }],
        "ui-title": ["16px", { lineHeight: "24px" }],
        "ui-display": ["20px", { lineHeight: "28px" }],
        "ui-xs": ["12px", { lineHeight: "16px" }],
        "ui-sm": ["13px", { lineHeight: "18px" }],
        "ui-base": ["14px", { lineHeight: "20px" }],
        "ui-md": ["15px", { lineHeight: "22px" }],
        "ui-lg": ["16px", { lineHeight: "24px" }],
        "ui-metric": ["20px", { lineHeight: "28px" }],
      },
      colors: {
        canvas: role("canvas"),
        surface: {
          DEFAULT: role("surface"),
          subtle: role("surface-subtle"),
          hover: role("surface-hover"),
          // LEGACY (migration only): remove with the palettes below.
          light: "#F5F8F4",
          dark: "#101B18",
        },
        line: {
          DEFAULT: role("line"),
          strong: role("line-strong"),
        },
        fg: {
          DEFAULT: role("fg"),
          secondary: role("fg-secondary"),
          tertiary: role("fg-tertiary"),
        },
        accent: {
          DEFAULT: role("accent"),
          hover: role("accent-hover"),
          fg: role("accent-fg"),
          subtle: role("accent-subtle"),
          text: role("accent-text"),
        },
        success: { DEFAULT: role("success"), subtle: role("success-subtle") },
        warning: { DEFAULT: role("warning"), subtle: role("warning-subtle") },
        danger: { DEFAULT: role("danger"), subtle: role("danger-subtle") },
        // LEGACY palettes (migration only). The side panel and src/ui must
        // not use them; scripts/check-ui-palette.mjs enforces this.
        warm: {
          50: "#F5F8F4",
          100: "#EAF0EB",
          200: "#D9E4DE",
          300: "#BDD0C3",
          400: "#95AA9D",
          500: "#6D8376",
          600: "#586A62",
          700: "#40534A",
          800: "#182925",
          900: "#14221E",
          950: "#101B18",
        },
        primary: {
          50: "#EAF4EF",
          100: "#D4E9DD",
          200: "#AED9C7",
          300: "#81C3AA",
          400: "#4DA88E",
          500: "#238577",
          600: "#126B64",
          700: "#0D554F",
          800: "#103F3C",
          900: "#102F2D",
        },
        brand: {
          surface: "#F5F8F4",
          panel: "#FFFFFF",
          text: "#182925",
          muted: "#586A62",
          subtle: "#40534A",
          accent: "#126B64",
          "accent-strong": "#0D554F",
          highlight: "#A5C842",
          live: "rgb(var(--brand-live, 18 107 100) / <alpha-value>)",
          "live-soft": "#D4E9DD",
        },
        // `success`/`warning`/`error` resolve to CSS variables so the
        // trace viewer can flip them per theme; the fallback triplet is
        // the light value, so surfaces that don't define the vars
        // (sidepanel/overlay) render exactly as before. `info`/`live`
        // have no themed variant and stay fixed.
        state: {
          success: "rgb(var(--state-success, 40 117 69) / <alpha-value>)",
          warning: "rgb(var(--state-warning, 217 119 6) / <alpha-value>)",
          error: "rgb(var(--state-error, 220 38 38) / <alpha-value>)",
          info: "#126B64",
          live: "#126B64",
        },
        // Trace-viewer semantic tokens: back the Tailwind color by the
        // `--trace-*` CSS variable (RGB triplet) so `.dark` on <html>
        // re-themes every `bg-trace-*` / `text-trace-*` / `border-trace-*`
        // utility, including opacity modifiers. Fallback = light value.
        trace: {
          bg: "rgb(var(--trace-bg, 245 248 244) / <alpha-value>)",
          panel: "rgb(var(--trace-panel, 255 255 255) / <alpha-value>)",
          border: "rgb(var(--trace-border, 217 228 222) / <alpha-value>)",
          surface: "rgb(var(--trace-surface, 228 241 236) / <alpha-value>)",
          accent: "rgb(var(--trace-accent, 18 107 100) / <alpha-value>)",
          "accent-light":
            "rgb(var(--trace-accent-light, 13 85 79) / <alpha-value>)",
          text: "rgb(var(--trace-text, 24 41 37) / <alpha-value>)",
          muted: "rgb(var(--trace-muted, 88 106 98) / <alpha-value>)",
          dim: "rgb(var(--trace-dim, 109 131 118) / <alpha-value>)",
          subtle: "rgb(var(--trace-subtle, 64 83 74) / <alpha-value>)",
        },
      },
      boxShadow: {
        soft: "0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)",
        "soft-md":
          "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
        glass: "0 2px 16px 0 rgba(0,0,0,0.06)",
        glow: "0 0 0 2px #FFFFFF, 0 0 0 5px rgba(18,107,100,0.3)",
      },
      animation: {
        "fade-in-up": "fade-in-up 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        shimmer: "shimmer 2s ease-in-out infinite",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "accordion-down": {
          "0%": { height: "0", opacity: "0" },
          "100%": {
            height:
              "var(--radix-collapsible-content-height, var(--accordion-height))",
            opacity: "1",
          },
        },
        "accordion-up": {
          "0%": {
            height:
              "var(--radix-collapsible-content-height, var(--accordion-height))",
            opacity: "1",
          },
          "100%": { height: "0", opacity: "0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.8" },
          "50%": { opacity: "0.4" },
        },
        shimmer: {
          "0%, 100%": { backgroundPosition: "200% 0" },
          "50%": { backgroundPosition: "-200% 0" },
        },
      },
    },
  },
  plugins: [],
};
