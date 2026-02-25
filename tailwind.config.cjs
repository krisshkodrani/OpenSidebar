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
                    50: "#eef2ff",
                    100: "#e0e7ff",
                    200: "#c7d2fe",
                    300: "#a5b4fc",
                    400: "#818cf8",
                    500: "#6366f1",
                    600: "#5046e5",
                    700: "#433aca",
                    800: "#3730a3",
                    900: "#312e81",
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
            },
            animation: {
                "fade-in-up": "fade-in-up 0.3s ease-out both",
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
