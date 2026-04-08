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
                    50: "#F5F3FF",
                    100: "#EDE9FE",
                    200: "#DDD6FE",
                    300: "#C4B5FD",
                    400: "#8B7FB8",
                    500: "#6D5F9A",
                    600: "#4C3D80",
                    700: "#312670",
                    800: "#1E1650",
                    900: "#150F35",
                    950: "#0D0A1F",
                },
                primary: {
                    50: "#FAF5FF",
                    100: "#F3E8FF",
                    200: "#E9D5FF",
                    300: "#D8B4FE",
                    400: "#C084FC",
                    500: "#A855F7",
                    600: "#9333EA",
                    700: "#7C3AED",
                    800: "#6D28D9",
                    900: "#5B21B6",
                },
                surface: {
                    light: "#F5F3FF",
                    dark: "#150F35",
                },
                trace: {
                    bg: "#F8F7FF",
                    panel: "#FFFFFF",
                    border: "#E2DDF5",
                    accent: "#7C3AED",
                    "accent-light": "#6D28D9",
                    text: "#1E1650",
                    muted: "#6D5F9A",
                    dim: "#A99FCC",
                    subtle: "#4C3D80",
                },
            },
            boxShadow: {
                soft: "0 1px 3px 0 rgba(0,0,0,0.04), 0 1px 2px -1px rgba(0,0,0,0.03)",
                "soft-md": "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.03)",
                glass: "0 2px 16px 0 rgba(0,0,0,0.06)",
                glow: "0 0 0 4px rgba(147,51,234,0.12)",
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
