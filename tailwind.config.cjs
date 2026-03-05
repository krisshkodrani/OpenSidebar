/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    darkMode: "class",
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
            },
            colors: {
                warm: {
                    50: "#faf9f7",
                    100: "#f5f3f0",
                    200: "#e7e5e0",
                    300: "#d6d3cc",
                    400: "#a8a29e",
                    500: "#78716c",
                    600: "#57534e",
                    700: "#44403c",
                    800: "#292524",
                    900: "#1c1917",
                    950: "#0f0d0a",
                },
                primary: {
                    50: "#f5f3ff",
                    100: "#ede9fe",
                    200: "#ddd6fe",
                    300: "#c4b5fd",
                    400: "#a78bfa",
                    500: "#7c5cfc",
                    600: "#6d4ee6",
                    700: "#5c3fd0",
                    800: "#4c1d95",
                    900: "#3b0f7a",
                },
                accent: {
                    50: "#fff7ed",
                    100: "#ffedd5",
                    200: "#fed7aa",
                    300: "#fdba74",
                    400: "#fb923c",
                    500: "#f97316",
                },
                surface: {
                    light: "#faf9f7",
                    dark: "#1c1917",
                },
                trace: {
                    bg: "#1a1a2e",
                    panel: "#16213e",
                    border: "#0f3460",
                    accent: "#3a7bd5",
                    "accent-light": "#5dade2",
                    text: "#e0e0e0",
                    muted: "#7a7a9e",
                    dim: "#4a4a6e",
                    subtle: "#a0a0c0",
                },
            },
            boxShadow: {
                soft: "0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)",
                "soft-md": "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
                glass: "0 2px 16px 0 rgba(0,0,0,0.06)",
                glow: "0 0 0 4px rgba(124,92,252,0.08)",
            },
            animation: {
                "fade-in-up": "fade-in-up 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                "pulse-soft": "pulse-soft 2s ease-in-out infinite",
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
            },
        },
    },
    plugins: [],
};
