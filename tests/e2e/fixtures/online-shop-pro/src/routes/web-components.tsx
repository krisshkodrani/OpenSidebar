import { useEffect, useState } from "react";

// Register custom elements with Shadow DOM
function registerCustomElements() {
  if (customElements.get("custom-card")) return;

  class CustomCard extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host { display: block; margin-bottom: 12px; }
          .card {
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.06);
          }
          .card-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
            color: #1e293b;
          }
          .card-body {
            font-size: 14px;
            color: #475569;
            line-height: 1.5;
          }
          button {
            margin-top: 12px;
            padding: 8px 16px;
            background: #3b82f6;
            color: #fff;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
          }
          button:hover { background: #2563eb; }
          .status { margin-top: 8px; font-size: 13px; color: #16a34a; font-weight: 500; }
        </style>
        <div class="card">
          <div class="card-title"><slot name="title"></slot></div>
          <div class="card-body"><slot></slot></div>
          <button id="card-action">Take Action</button>
          <div class="status" id="card-status" style="display:none"></div>
        </div>
      `;

      const btn = shadow.getElementById("card-action")!;
      const status = shadow.getElementById("card-status")!;
      btn.addEventListener("click", () => {
        status.style.display = "block";
        status.textContent = "Action completed!";
        this.dispatchEvent(new CustomEvent("card-action", { bubbles: true, composed: true }));
      });
    }
  }

  class CustomInput extends HTMLElement {
    private _input: HTMLInputElement | null = null;

    constructor() {
      super();
      const shadow = this.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host { display: block; margin-bottom: 12px; }
          label {
            display: block;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 6px;
            color: #334155;
          }
          input {
            width: 100%;
            padding: 10px 14px;
            font-size: 14px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            box-sizing: border-box;
            font-family: inherit;
          }
          input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 2px rgba(59,130,246,0.2);
          }
        </style>
        <label><slot name="label">Input</slot></label>
        <input type="text" />
      `;
      this._input = shadow.querySelector("input");
      this._input!.addEventListener("input", () => {
        this.dispatchEvent(
          new CustomEvent("value-change", {
            bubbles: true,
            composed: true,
            detail: { value: this._input!.value },
          }),
        );
      });
    }

    get value() {
      return this._input?.value || "";
    }

    set value(v: string) {
      if (this._input) this._input.value = v;
    }

    connectedCallback() {
      const placeholder = this.getAttribute("placeholder");
      if (placeholder && this._input) {
        this._input.placeholder = placeholder;
      }
    }
  }

  class CustomToggle extends HTMLElement {
    private _checked = false;

    constructor() {
      super();
      const shadow = this.attachShadow({ mode: "open" });
      shadow.innerHTML = `
        <style>
          :host { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
          .track {
            width: 44px; height: 24px;
            border-radius: 12px;
            background: #cbd5e1;
            position: relative;
            transition: background 0.2s;
          }
          .track.on { background: #3b82f6; }
          .thumb {
            width: 20px; height: 20px;
            border-radius: 50%;
            background: #fff;
            position: absolute;
            top: 2px; left: 2px;
            transition: left 0.2s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          }
          .track.on .thumb { left: 22px; }
          .label { font-size: 14px; color: #334155; }
        </style>
        <div class="track" id="track">
          <div class="thumb"></div>
        </div>
        <span class="label"><slot></slot></span>
      `;

      const track = shadow.getElementById("track")!;
      this.addEventListener("click", () => {
        this._checked = !this._checked;
        if (this._checked) {
          track.classList.add("on");
        } else {
          track.classList.remove("on");
        }
        this.dispatchEvent(
          new CustomEvent("toggle-change", {
            bubbles: true,
            composed: true,
            detail: { checked: this._checked },
          }),
        );
      });
    }

    get checked() {
      return this._checked;
    }
  }

  customElements.define("custom-card", CustomCard);
  customElements.define("custom-input", CustomInput);
  customElements.define("custom-toggle", CustomToggle);
}

// Register custom elements once at module level (before any render)
registerCustomElements();

export default function WebComponents() {
  const [actions, setActions] = useState<string[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [toggleState, setToggleState] = useState(false);

  // React doesn't support custom element events via onXxx props.
  // Use DOM addEventListener after mount for custom events.
  useEffect(() => {
    const notif = document.getElementById("card-notifications");
    const privacy = document.getElementById("card-privacy");
    const toggle = document.getElementById("toggle-darkmode");
    const handlers: Array<[HTMLElement, string, EventListener]> = [];

    if (notif) {
      const h = () => setActions((prev) => [...prev, "notifications"]);
      notif.addEventListener("card-action", h);
      handlers.push([notif, "card-action", h]);
    }
    if (privacy) {
      const h = () => setActions((prev) => [...prev, "privacy"]);
      privacy.addEventListener("card-action", h);
      handlers.push([privacy, "card-action", h]);
    }
    if (toggle) {
      const h = ((e: Event) =>
        setToggleState((e as CustomEvent).detail.checked)) as EventListener;
      toggle.addEventListener("toggle-change", h);
      handlers.push([toggle, "toggle-change", h]);
    }
    return () => {
      for (const [el, evt, fn] of handlers) el.removeEventListener(evt, fn);
    };
  }, []);

  useEffect(() => {
    (window as any).webComponentResult = {
      actionsCompleted: actions.length,
      actions,
      inputValues,
      toggleEnabled: toggleState,
      allDone: actions.length >= 2 && Object.keys(inputValues).length > 0 && toggleState,
    };
  }, [actions, inputValues, toggleState]);

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Web Components (Shadow DOM)</h1>
        <p>
          This page uses custom elements with Shadow DOM. Interact with elements
          inside the shadow roots.
        </p>
      </div>

      <div
        className="container"
        style={{ maxWidth: 600, margin: "32px auto", padding: "0 24px" }}
      >
        {/* Custom cards */}
        <custom-card
          id="card-notifications"
        >
          <span slot="title">Notification Settings</span>
          Configure how you receive notifications from the platform.
        </custom-card>

        <custom-card
          id="card-privacy"
        >
          <span slot="title">Privacy Settings</span>
          Manage your data sharing and privacy preferences.
        </custom-card>

        {/* Custom input */}
        <div style={{ marginTop: 20 }}>
          <custom-input
            id="input-username"
            placeholder="Enter your username"
            // @ts-ignore
            onValue-change={(e: CustomEvent) =>
              setInputValues((prev) => ({ ...prev, username: e.detail.value }))
            }
          >
            <span slot="label">Username</span>
          </custom-input>
        </div>

        {/* Custom toggle */}
        <div style={{ marginTop: 20, padding: "12px 0" }}>
          <custom-toggle
            id="toggle-darkmode"
          >
            Enable Dark Mode
          </custom-toggle>
        </div>

        {/* Status display */}
        {(actions.length > 0 || Object.keys(inputValues).length > 0 || toggleState) && (
          <div
            id="component-status"
            className="card"
            style={{
              marginTop: 20,
              padding: 16,
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
            }}
          >
            <h4 style={{ marginBottom: 8, color: "#166534" }}>Interaction Status</h4>
            {actions.map((a, i) => (
              <p key={i} style={{ fontSize: 13, color: "#475569" }}>
                Action: {a}
              </p>
            ))}
            {Object.entries(inputValues).map(([k, v]) => (
              <p key={k} style={{ fontSize: 13, color: "#475569" }}>
                Input ({k}): {v}
              </p>
            ))}
            {toggleState && (
              <p style={{ fontSize: 13, color: "#475569" }}>Dark Mode: enabled</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
