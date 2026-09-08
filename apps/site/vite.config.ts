import { defineConfig, type Plugin } from "vite";
import { resolve } from "path";

const root = resolve(__dirname);

// SITE_BASE_URL (e.g. https://opensidebar.com) enables absolute canonical/OG
// URLs at build time. When unset the OG image falls back to a relative path
// and no <link rel="canonical"> is emitted — the site still works.
const baseUrl = process.env.SITE_BASE_URL ?? "";

const cleanUrlPages: Record<string, string> = {
  "/walkthrough": "/walkthrough.html",
  "/ideas": "/ideas/index.html",
  "/ideas/done-means-verified": "/ideas/done-means-verified.html",
  "/ideas/the-sandbox-needs-two-rooms": "/ideas/the-sandbox-needs-two-rooms.html",
};

function cleanUrlRewrites(): Plugin {
  const rewrite = (url: string | undefined): string | undefined => {
    if (!url) return url;
    const queryStart = url.indexOf("?");
    const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
    const destination = cleanUrlPages[pathname];
    return destination
      ? destination + (queryStart === -1 ? "" : url.slice(queryStart))
      : url;
  };

  return {
    name: "opensidebar-clean-url-rewrites",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        request.url = rewrite(request.url);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        request.url = rewrite(request.url);
        next();
      });
    },
  };
}

export default defineConfig({
  root,
  base: "/",
  plugins: [cleanUrlRewrites()],
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
        ideas: resolve(root, "ideas/index.html"),
        doneMeansVerified: resolve(root, "ideas/done-means-verified.html"),
        sandboxNeedsTwoRooms: resolve(root, "ideas/the-sandbox-needs-two-rooms.html"),
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
