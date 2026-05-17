export type E2ERailState = {
  active: boolean;
  status: string;
  detail: string;
  outcome: string;
  updatedAt: number;
  prompt: string;
  planItems: string[];
  feed: Array<{
    id: string;
    kind: "status" | "step" | "plan" | "completion";
    text: string;
    timestamp: number;
  }>;
  finalText: string;
};

const E2E_RAIL_ID = "opensidebar-e2e-rail";
const E2E_RAIL_STYLE_ID = "opensidebar-e2e-rail-style";

function ensureE2ERailStyles() {
  if (document.getElementById(E2E_RAIL_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = E2E_RAIL_STYLE_ID;
  style.textContent = `
    #${E2E_RAIL_ID} {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 2147483646;
      width: 360px;
      max-width: min(360px, 42vw);
      height: 100vh;
      pointer-events: auto;
      user-select: text;
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0f172a;
      background: rgba(255, 255, 255, 0.96);
      border-left: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 0;
      box-shadow:
        -18px 0 45px rgba(15, 23, 42, 0.16),
        0 0 0 1px rgba(255, 255, 255, 0.82);
      backdrop-filter: blur(16px) saturate(1.08);
      -webkit-backdrop-filter: blur(16px) saturate(1.08);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    #${E2E_RAIL_ID} [data-header] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(248, 250, 252, 0.86);
    }

    #${E2E_RAIL_ID} [data-title] {
      font-size: 13px;
      line-height: 18px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
      color: #334155;
    }

    #${E2E_RAIL_ID} [data-state] {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      line-height: 17px;
      font-weight: 600;
      color: #475569;
    }

    #${E2E_RAIL_ID} [data-dot] {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #94a3b8;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.16);
    }

    #${E2E_RAIL_ID}[data-active="true"] [data-dot] {
      background: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.16);
    }

    #${E2E_RAIL_ID}[data-outcome="completed"] [data-dot] {
      background: #16a34a;
      box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.16);
    }

    #${E2E_RAIL_ID}[data-outcome="failed"] [data-dot] {
      background: #dc2626;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.16);
    }

    #${E2E_RAIL_ID}[data-outcome="stopped"] [data-dot] {
      background: #d97706;
      box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.16);
    }

    #${E2E_RAIL_ID} [data-body] {
      flex: 1;
      min-height: 0;
      padding: 12px;
      display: grid;
      align-content: start;
      gap: 10px;
      grid-template-rows:
        minmax(70px, auto)
        minmax(72px, auto)
        minmax(120px, 1fr)
        minmax(104px, auto)
        minmax(110px, auto)
        minmax(24px, auto);
      overflow: hidden;
    }

    #${E2E_RAIL_ID} [data-section] {
      display: grid;
      gap: 6px;
      padding: 10px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 8px;
      background: rgba(248, 250, 252, 0.72);
      min-height: 0;
      overflow: hidden;
    }

    #${E2E_RAIL_ID} [data-section-title] {
      font-size: 10px;
      line-height: 14px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
      color: #64748b;
    }

    #${E2E_RAIL_ID} [data-label] {
      font-size: 14px;
      line-height: 20px;
      font-weight: 650;
      color: #0f172a;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-detail] {
      font-size: 12px;
      line-height: 17px;
      color: #64748b;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-plan-list],
    #${E2E_RAIL_ID} [data-feed-list] {
      display: grid;
      gap: 7px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    #${E2E_RAIL_ID} [data-plan-list] li {
      position: relative;
      padding-left: 14px;
      font-size: 12px;
      line-height: 17px;
      color: #334155;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-plan-list] li::before {
      content: "";
      position: absolute;
      top: 7px;
      left: 2px;
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: #2563eb;
    }

    #${E2E_RAIL_ID} [data-feed-list] li {
      display: grid;
      gap: 2px;
      padding: 6px 8px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(15, 23, 42, 0.06);
    }

    #${E2E_RAIL_ID} [data-feed-kind] {
      font-size: 10px;
      line-height: 13px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
      color: #64748b;
    }

    #${E2E_RAIL_ID} [data-feed-text] {
      font-size: 12px;
      line-height: 17px;
      color: #1e293b;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-final-text] {
      font-size: 12px;
      line-height: 18px;
      color: #0f172a;
      white-space: pre-wrap;
      display: -webkit-box;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    #${E2E_RAIL_ID} [data-timestamp] {
      font-size: 11px;
      line-height: 15px;
      color: #94a3b8;
    }

    #${E2E_RAIL_ID} [data-meta-row] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 0 2px;
      min-height: 20px;
    }

    @media (max-width: 900px) {
      #${E2E_RAIL_ID} {
        width: 300px;
        max-width: 50vw;
      }
    }
  `;
  document.documentElement.appendChild(style);
}

export function removeE2ERail() {
  document.getElementById(E2E_RAIL_ID)?.remove();
}

export async function renderE2ERail(
  state: E2ERailState,
  options: {
    isPanelMounted: () => boolean;
    isEnabled: () => Promise<boolean>;
  },
) {
  if (options.isPanelMounted()) {
    removeE2ERail();
    return;
  }
  if (!(await options.isEnabled())) return;
  ensureE2ERailStyles();

  let rail = document.getElementById(E2E_RAIL_ID);
  if (!rail) {
    rail = document.createElement("div");
    rail.id = E2E_RAIL_ID;
    rail.innerHTML = `
      <div data-header>
        <div data-title>OpenSidebar E2E</div>
        <div data-state><span data-dot></span><span data-status></span></div>
      </div>
      <div data-body>
        <div data-section>
          <div data-section-title>Prompt</div>
          <div data-detail data-prompt>Waiting for prompt.</div>
        </div>
        <div data-section>
          <div data-section-title>Current Step</div>
          <div data-label></div>
          <div data-detail></div>
        </div>
        <div data-section>
          <div data-section-title>Plan</div>
          <ul data-plan-list></ul>
        </div>
        <div data-section>
          <div data-section-title>Live Feed</div>
          <ul data-feed-list></ul>
        </div>
        <div data-section>
          <div data-section-title>Final Output</div>
          <div data-final-text>Waiting for completion.</div>
        </div>
        <div data-meta-row>
          <div data-section-title>Last Update</div>
          <div data-timestamp></div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(rail);
  }

  rail.dataset.active = String(state.active);
  rail.dataset.outcome = state.outcome;
  const status = rail.querySelector("[data-status]");
  const label = rail.querySelector("[data-label]");
  const detail = rail.querySelector("[data-detail]");
  const timestamp = rail.querySelector("[data-timestamp]");
  const prompt = rail.querySelector("[data-prompt]");
  const planList = rail.querySelector("[data-plan-list]");
  const feedList = rail.querySelector("[data-feed-list]");
  const finalText = rail.querySelector("[data-final-text]");
  if (status) status.textContent = state.status;
  if (label) {
    label.textContent = state.detail;
    label.setAttribute("title", state.detail);
  }
  if (detail) {
    detail.textContent = state.active
      ? "Watch the page. Agent actions happen here."
      : state.outcome
        ? `Task ${state.outcome}.`
        : "Ready for visible demo.";
  }
  if (timestamp) {
    timestamp.textContent = state.updatedAt
      ? new Date(state.updatedAt).toLocaleTimeString()
      : "Not started";
  }
  if (prompt) {
    prompt.textContent = state.prompt || "Waiting for prompt.";
    prompt.setAttribute("title", state.prompt || "");
  }
  if (planList) {
    planList.replaceChildren(
      ...(state.planItems.length > 0
        ? state.planItems.slice(0, 5)
        : ["Waiting for plan/progress."]
      ).map((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        li.title = item;
        return li;
      }),
    );
  }
  if (feedList) {
    feedList.replaceChildren(
      ...state.feed.slice(-3).map((item) => {
        const li = document.createElement("li");
        const kind = document.createElement("div");
        kind.dataset.feedKind = "";
        kind.textContent = item.kind;
        const text = document.createElement("div");
        text.dataset.feedText = "";
        text.textContent = item.text;
        text.title = item.text;
        li.append(kind, text);
        return li;
      }),
    );
  }
  if (finalText) {
    finalText.textContent = state.finalText || "Waiting for completion.";
    finalText.setAttribute("title", state.finalText || "");
  }
}
