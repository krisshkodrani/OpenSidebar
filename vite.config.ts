import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      __DEV__: JSON.stringify(mode !== "production"),
      __OPENROUTER_API_KEY__: JSON.stringify(env.OPENROUTER_API_KEY ?? ""),
      __GROQ_API_KEY__: JSON.stringify(env.GROQ_API_KEY ?? ""),
      __CEREBRAS_API_KEY__: JSON.stringify(env.CEREBRAS_API_KEY ?? ""),
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
