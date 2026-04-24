/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./apps/extension/src/**/*.{js,ts,jsx,tsx,html}"],
    darkMode: "class",
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
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
                    surface: "#F8FAFC",
                    panel: "#FFFFFF",
                    text: "#0F172A",
                    muted: "#475569",
                    subtle: "#334155",
                    accent: "#2563EB",
                    "accent-strong": "#1D4ED8",
                    live: "#14B8A6",
                    "live-soft": "#99F6E4",
                },
                state: {
                    success: "#15803D",
                    warning: "#D97706",
                    error: "#DC2626",
                    info: "#2563EB",
                    live: "#14B8A6",
                },
                trace: {
                    bg: "#F8FAFC",
                    panel: "#FFFFFF",
                    border: "#E2E8F0",
                    accent: "#2563EB",
                    "accent-light": "#1D4ED8",
                    text: "#0F172A",
                    muted: "#475569",
                    dim: "#64748B",
                    subtle: "#334155",
                },
            },
            boxShadow: {
                soft: "0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)",
                "soft-md": "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
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
                    "100%": { height: "var(--accordion-height)", opacity: "1" },
                },
                "accordion-up": {
                    "0%": { height: "var(--accordion-height)", opacity: "1" },
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
