/** @type {import('tailwindcss').Config} */
const productTokens = require("./packages/ui-tokens/tokens.json");
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
      fontSize: {
        "ui-caption": ["11px", { lineHeight: "16px" }],
        "ui-control": ["12px", { lineHeight: "18px" }],
        "ui-body": ["13px", { lineHeight: "20px" }],
        "ui-body-strong": ["13px", { lineHeight: "20px" }],
        "ui-section": ["14px", { lineHeight: "22px" }],
        "ui-title": ["16px", { lineHeight: "24px" }],
        "ui-display": ["20px", { lineHeight: "28px" }],
        "ui-xs": ["11px", { lineHeight: "16px" }],
        "ui-sm": ["12px", { lineHeight: "18px" }],
        "ui-base": ["13px", { lineHeight: "20px" }],
        "ui-md": ["14px", { lineHeight: "22px" }],
        "ui-lg": ["16px", { lineHeight: "24px" }],
        "ui-metric": ["20px", { lineHeight: "28px" }],
      },
      colors: {
        warm: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#0F172A",
          900: "#0F172A",
          950: "#020617",
        },
        primary: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          200: "#BFDBFE",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
          800: "#1E40AF",
          900: "#1E3A8A",
        },
        surface: {
          light: "#F8FAFC",
          dark: "#0F172A",
        },
        brand: {
          surface: productTokens.colors.canvas,
          panel: productTokens.colors.surface,
          text: productTokens.colors.text,
          muted: "#475569",
          subtle: "#334155",
          accent: productTokens.colors.accent,
          "accent-strong": productTokens.colors.accentStrong,
          live: "rgb(var(--brand-live, 20 184 166) / <alpha-value>)",
          "live-soft": "#99F6E4",
        },
        // `success`/`warning`/`error` resolve to CSS variables so the
        // trace viewer can flip them per theme; the fallback triplet is
        // the light value, so surfaces that don't define the vars
        // (sidepanel/overlay) render exactly as before. `info`/`live`
        // have no themed variant and stay fixed.
        state: {
          success: "rgb(var(--state-success, 21 128 61) / <alpha-value>)",
          warning: "rgb(var(--state-warning, 217 119 6) / <alpha-value>)",
          error: "rgb(var(--state-error, 220 38 38) / <alpha-value>)",
          info: "#2563EB",
          live: "#14B8A6",
        },
        // Trace-viewer semantic tokens: back the Tailwind color by the
        // `--trace-*` CSS variable (RGB triplet) so `.dark` on <html>
        // re-themes every `bg-trace-*` / `text-trace-*` / `border-trace-*`
        // utility, including opacity modifiers. Fallback = light value.
        trace: {
          bg: "rgb(var(--trace-bg, 248 250 252) / <alpha-value>)",
          panel: "rgb(var(--trace-panel, 255 255 255) / <alpha-value>)",
          border: "rgb(var(--trace-border, 226 232 240) / <alpha-value>)",
          surface: "rgb(var(--trace-surface, 241 245 249) / <alpha-value>)",
          accent: "rgb(var(--trace-accent, 37 99 235) / <alpha-value>)",
          "accent-light":
            "rgb(var(--trace-accent-light, 29 78 216) / <alpha-value>)",
          text: "rgb(var(--trace-text, 15 23 42) / <alpha-value>)",
          muted: "rgb(var(--trace-muted, 71 85 105) / <alpha-value>)",
          dim: "rgb(var(--trace-dim, 100 116 139) / <alpha-value>)",
          subtle: "rgb(var(--trace-subtle, 51 65 85) / <alpha-value>)",
        },
      },
      boxShadow: {
        soft: "0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)",
        "soft-md":
          "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
        glass: "0 2px 16px 0 rgba(0,0,0,0.06)",
        glow: "0 0 0 2px #FFFFFF, 0 0 0 5px rgba(37,99,235,0.22)",
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
