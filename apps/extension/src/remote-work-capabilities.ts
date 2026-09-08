const compileTimeReleaseEnabled =
  typeof __REMOTE_MISSIONS_RELEASE_ENABLED__ !== "undefined" &&
  __REMOTE_MISSIONS_RELEASE_ENABLED__;

export const REMOTE_BROWSER_WORK_SUPPORTED =
  compileTimeReleaseEnabled ||
  (import.meta.env.VITE_CLOUD_SESSIONS_ENABLED === "true" &&
    import.meta.env.VITE_REMOTE_MISSIONS_ENABLED === "true");
