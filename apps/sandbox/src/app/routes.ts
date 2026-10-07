export const routes = {
  overview: "/app",
  mcpConsent: "/app/connect/codex",
  sessions: "/app/sessions",
  playground: "/app/playground",
  viewer: "/app/viewer",
  settings: "/app/settings",
  connections: "/app/settings/connections",
  providers: "/app/settings/providers",
  security: "/app/settings/security",
  signIn: "/app/sign-in",
  activation: "/app/internal/activation",
} as const;

const aliases: Record<string, string> = {
  "/dashboard": routes.overview,
  "/dashboard/activation": routes.activation,
  "/sessions": routes.sessions,
  "/account": routes.settings,
  "/settings": routes.settings,
  "/app/account": routes.settings,
  "/app/dashboard": routes.overview,
  "/playground": routes.playground,
  "/viewer": routes.viewer,
};
const canonical = new Set<string>(Object.values(routes));

/** Only known same-origin workspace destinations can survive authentication. */
export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return routes.overview;
  try {
    const url = new URL(value, "https://opensidebar.com");
    const path =
      aliases[url.pathname.replace(/\/+$/, "")] ??
      url.pathname.replace(/\/+$/, "");
    if (
      url.origin !== "https://opensidebar.com" ||
      !canonical.has(path) ||
      path === routes.signIn
    )
      return routes.overview;
    url.searchParams.delete("auth");
    url.searchParams.delete("return");
    return path + url.search + url.hash;
  } catch {
    return routes.overview;
  }
}
export function signInHref(
  destination = location.pathname + location.search + location.hash,
) {
  return `${routes.signIn}?return=${encodeURIComponent(safeReturnPath(destination))}`;
}
export function normalizeAppUrl(url: URL): string | null {
  const clean = url.pathname.replace(/\/+$/, "") || "/";
  const path = aliases[clean] ?? clean;
  const search = new URLSearchParams(url.search);
  if (
    search.get("auth") === "1" &&
    (path === routes.playground || clean === "/app")
  ) {
    search.delete("auth");
    return signInHref(path + (search.size ? `?${search}` : "") + url.hash);
  }
  if (path !== url.pathname && (canonical.has(path) || aliases[clean]))
    return path + url.search + url.hash;
  return null;
}
export function isSettingsRoute(path = location.pathname) {
  return [
    routes.settings,
    routes.connections,
    routes.providers,
    routes.security,
  ].includes(path as typeof routes.settings);
}
export function isAppRoute(path = location.pathname) {
  return canonical.has(path);
}
export function pageTitle(path = location.pathname) {
  return (
    (
      {
        [routes.overview]: "Overview",
        [routes.mcpConsent]: "Connect Codex",
        [routes.sessions]: "Sessions",
        [routes.playground]: "Playground",
        [routes.viewer]: "Run viewer",
        [routes.settings]: "Settings",
        [routes.connections]: "Connections",
        [routes.providers]: "Provider connections",
        [routes.security]: "Security",
        [routes.signIn]: "Sign in",
        [routes.activation]: "Activation",
      } as Record<string, string>
    )[path] ?? "Page not found"
  );
}
