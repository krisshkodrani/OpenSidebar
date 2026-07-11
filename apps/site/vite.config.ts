import { defineConfig } from "vite";
import { resolve } from "path";

const root = resolve(__dirname);

// SITE_BASE_URL (e.g. https://opensidebar.com) enables absolute canonical/OG
// URLs at build time. When unset the OG image falls back to a relative path
// and no <link rel="canonical"> is emitted — the site still works.
const baseUrl = process.env.SITE_BASE_URL ?? "";

export default defineConfig({
  root,
  base: "/",
  define: {
    __SITE_BASE_URL__: JSON.stringify(baseUrl),
  },
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    target: "es2020",
    // No vendor chunking needed — the site ships one tiny hand-written module.
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        walkthrough: resolve(root, "walkthrough.html"),
      },
    },
  },
  server: {
    port: 4321,
    open: false,
  },
  preview: {
    port: 4322,
  },
});
