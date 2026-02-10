import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig(({ mode }) => {
  return {
    define: {
      __DEV__: JSON.stringify(mode !== "production"),
    },
    plugins: [
      react(),
      crx({ manifest }),
      viteStaticCopy({
        targets: [
          {
            src: "node_modules/sql.js/dist/sql-wasm.wasm",
            dest: "wasm",
          },
        ],
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    optimizeDeps: {
      exclude: ["sql.js", "@huggingface/transformers", "voy-search"],
    },
    build: {
      rollupOptions: {
        input: {
          offscreen: "src/offscreen/memory/index.html",
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
    assetsInclude: ["**/*.wasm"],
  };
});
