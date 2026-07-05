import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";
  const outDir =
    isProduction
      ? path.resolve(__dirname, "../../dist")
      : path.resolve(__dirname, "../../dist-dev");
  // Dev builds are HMR-tethered to the local Vite server and load from
  // dist-dev/. Suffix the name so the build is identifiable in Chrome.
  const buildManifest = isProduction
    ? manifest
    : { ...manifest, name: `${manifest.name} (dev)` };

  return {
    root: __dirname,
    define: {
      __DEV__: JSON.stringify(mode !== "production"),
    },
    plugins: [react(), crx({ manifest: buildManifest })],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@shared-types": path.resolve(
          __dirname,
          "../../packages/shared-types/src",
        ),
        "@observability-schema": path.resolve(
          __dirname,
          "../../packages/observability-schema/src",
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
          "offscreen-audio": path.resolve(
            __dirname,
            "src/offscreen/audio.html",
          ),
          // The overlay harness drives headed E2E; the e2e-mode build
          // (dist-dev with __DEV__ surface) needs it just like prod.
          ...(isProduction || mode === "e2e"
            ? {
                "overlay-harness": path.resolve(
                  __dirname,
                  "src/overlay/index.tsx",
                ),
              }
            : {}),
          ...(!isProduction
            ? {
                // Dev-only observability page; must never ship in dist/.
                "trace-viewer": path.resolve(
                  __dirname,
                  "src/trace-viewer/index.html",
                ),
              }
            : {}),
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
