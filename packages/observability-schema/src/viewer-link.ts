export type ViewerSubview =
  | "story"
  | "plan"
  | "turns"
  | "perception"
  | "prompts"
  | "skills"
  | "logs";

export type ViewerTopLevelView = "runs" | "analytics";

export type ViewerModelIOSection = "request" | "response";

export interface ViewerRoute {
  sessionId?: string;
  runId?: string;
  view?: ViewerSubview;
  top?: ViewerTopLevelView;
  turn?: number;
  section?: ViewerModelIOSection;
  skillId?: string;
  review?: "needs";
}

export const DEFAULT_VIEWER_URL = "http://127.0.0.1:7589/viewer";

export function parseViewerHash(hash: string): ViewerRoute {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const turnValue = Number(params.get("turn"));
  const sectionValue = params.get("section");
  return {
    sessionId: params.get("session") || undefined,
    runId: params.get("run") || undefined,
    view: (params.get("view") as ViewerSubview | null) || undefined,
    top: (params.get("top") as ViewerTopLevelView | null) || undefined,
    turn:
      Number.isInteger(turnValue) && turnValue > 0 ? turnValue : undefined,
    section:
      sectionValue === "request" || sectionValue === "response"
        ? sectionValue
        : undefined,
    skillId: params.get("skill") || undefined,
    review: params.get("review") === "needs" ? "needs" : undefined,
  };
}

export function serializeViewerHash(route: ViewerRoute): string {
  const params = new URLSearchParams();
  if (route.skillId) {
    params.set("skill", route.skillId);
  } else if (route.sessionId) {
    params.set("session", route.sessionId);
    if (route.view && route.view !== "story") params.set("view", route.view);
    if (route.turn && route.turn > 0) params.set("turn", String(route.turn));
    if (
      route.view === "prompts" &&
      route.turn &&
      route.section
    ) {
      params.set("section", route.section);
    }
  } else {
    if (route.runId) params.set("run", route.runId);
    if (route.top && route.top !== "runs") params.set("top", route.top);
    if (route.review === "needs") params.set("review", "needs");
  }
  const value = params.toString();
  return value ? `#${value}` : "";
}

export function buildViewerUrl(
  route: ViewerRoute,
  baseUrl = DEFAULT_VIEWER_URL,
): string {
  const url = new URL(baseUrl);
  url.hash = serializeViewerHash(route);
  return url.toString();
}
