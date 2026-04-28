import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const outDir =
    mode === "production"
      ? path.resolve(__dirname, "../../dist")
      : path.resolve(__dirname, "../../dist-dev");

  return {
    root: __dirname,
    define: {
      __DEV__: JSON.stringify(mode !== "production"),
    },
    plugins: [react(), crx({ manifest })],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@shared-types": path.resolve(
          __dirname,
          "../../packages/shared-types/src",
        ),
        "@prompts": path.resolve(__dirname, "../../packages/prompts/src"),
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      // The MV3 background service worker is intentionally bundled as a single
      // module; Chrome extension workers are more reliable with static imports
      // than with lazy runtime chunks. Keep the warning useful for future growth.
      chunkSizeWarningLimit: 750,
      rollupOptions: {
        input: {
          "trace-viewer": path.resolve(
            __dirname,
            "src/trace-viewer/index.html",
          ),
        },
        external: [],
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
