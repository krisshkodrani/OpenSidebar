import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
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
      outDir: path.resolve(__dirname, "../../dist"),
      emptyOutDir: true,
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
    // Dev mode uses a different directory to avoid overwriting production builds
    ...(mode !== "production" && {
      build: {
        outDir: path.resolve(__dirname, "../../dist-dev"),
        emptyOutDir: true,
      },
    }),
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
