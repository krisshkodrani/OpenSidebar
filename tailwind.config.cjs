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
                    50: "#f0fdfa",
                    100: "#ccfbf1",
                    200: "#99f6e4",
                    300: "#5eead4",
                    400: "#2dd4bf",
                    500: "#14b8a6",
                    600: "#0d9488",
                    700: "#0f766e",
                    800: "#115e59",
                    900: "#134e4a",
                },
                surface: {
                    light: "#faf9f7",
                    dark: "#1c1917",
                },
                trace: {
                    bg: "#1c1917",
                    panel: "#292524",
                    border: "#44403c",
                    accent: "#0d9488",
                    "accent-light": "#2dd4bf",
                    text: "#e7e5e0",
                    muted: "#78716c",
                    dim: "#57534e",
                    subtle: "#a8a29e",
                },
            },
            boxShadow: {
                soft: "0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)",
                "soft-md": "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
                glass: "0 2px 16px 0 rgba(0,0,0,0.06)",
                glow: "0 0 0 4px rgba(20,184,166,0.08)",
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
