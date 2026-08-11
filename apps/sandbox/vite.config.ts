import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@sandbox-contracts": resolve(
        __dirname,
        "../../packages/sandbox-contracts/src/index.ts",
      ),
      "@trace-sync": resolve(
        __dirname,
        "../../packages/trace-sync/src/index.ts",
      ),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    assetsDir: "playground/assets",
    emptyOutDir: true,
    manifest: true,
    target: "es2020",
    rollupOptions: {
      input: {
        control: resolve(__dirname, "index.html"),
        target: resolve(__dirname, "target.html"),
      },
    },
  },
  server: { port: 4323, strictPort: true },
});
