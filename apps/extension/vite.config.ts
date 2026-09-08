import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isRemoteMissionAcceptance = mode === "remote-mission-acceptance";
  if (
    isRemoteMissionAcceptance &&
    env.OPENSIDEBAR_REMOTE_MISSION_ACCEPTANCE !== "true"
  ) {
    throw new Error(
      "Remote-mission acceptance builds require OPENSIDEBAR_REMOTE_MISSION_ACCEPTANCE=true.",
    );
  }
  const fleetTelemetryInternalEndpoint =
    mode === "internal"
      ? (env.FLEET_TELEMETRY_INTERNAL_ENDPOINT || "").trim()
      : "";
  const isProduction = mode === "production";
  const isProductionLike = isProduction || isRemoteMissionAcceptance;
  const remoteMissionsReleaseEnabled =
    isProduction ||
    isRemoteMissionAcceptance ||
    (env.VITE_CLOUD_SESSIONS_ENABLED === "true" &&
      env.VITE_REMOTE_MISSIONS_ENABLED === "true");
  const localObservabilityServerUrl = isProductionLike
    ? ""
    : (
        process.env.LOCAL_OBSERVABILITY_SERVER_URL ||
        env.LOCAL_OBSERVABILITY_SERVER_URL ||
        "http://127.0.0.1:7589"
      ).trim();
  const outDir = isProductionLike
    ? path.resolve(__dirname, "../../dist")
    : path.resolve(__dirname, "../../dist-dev");
  // Dev builds are HMR-tethered to the local Vite server and load from
  // dist-dev/. Suffix the name so the build is identifiable in Chrome.
  const buildManifest = isRemoteMissionAcceptance
    ? { ...manifest, name: `${manifest.name} (remote acceptance)` }
    : isProduction
      ? manifest
      : { ...manifest, name: `${manifest.name} (dev)` };

  return {
    root: __dirname,
    define: {
      __DEV__: JSON.stringify(!isProductionLike),
      __FLEET_TELEMETRY_INTERNAL_ENDPOINT__: JSON.stringify(
        fleetTelemetryInternalEndpoint,
      ),
      __LOCAL_OBSERVABILITY_SERVER_URL__: JSON.stringify(
        localObservabilityServerUrl,
      ),
      __REMOTE_MISSIONS_RELEASE_ENABLED__: JSON.stringify(
        remoteMissionsReleaseEnabled,
      ),
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
        "@trace-sync": path.resolve(__dirname, "../../packages/trace-sync/src"),
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
          ...(isProductionLike || mode === "e2e"
            ? {
                "overlay-harness": path.resolve(
                  __dirname,
                  "src/overlay/index.tsx",
                ),
              }
            : {}),
          ...(!isProductionLike
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
