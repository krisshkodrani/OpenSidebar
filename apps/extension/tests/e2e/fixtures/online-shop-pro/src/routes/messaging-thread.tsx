import { useState, useEffect, useMemo, useRef } from "react";

/**
 * LinkedIn-style messaging thread fixture.
 * Default mode: normal DOM-based thread with textarea reply box.
 * dom-mismatch mode: visually obvious thread/composer rendered into a closed
 * shadow root, while the normal DOM exposes only promo-rail actions. This
 * reproduces a perception-vs-DOM grounding mismatch similar to the LinkedIn run.
 */

interface ThreadMessage {
  id: number;
  author: string;
  avatar: string;
  headline: string;
  time: string;
  text: string;
}

const thread: ThreadMessage[] = [
  {
    id: 1,
    author: "Markus Bauer",
    avatar: "MB",
    headline: "CTO bei TechVentures GmbH",
    time: "vor 2 Std.",
    text: "Hallo zusammen, ich wollte kurz den aktuellen Stand unseres Cloud-Migrationsprojekts besprechen. Wir haben letzte Woche die ersten Microservices erfolgreich auf AWS migriert. Die Latenzzeiten sind deutlich besser als erwartet.",
  },
  {
    id: 2,
    author: "Sabine Keller",
    avatar: "SK",
    headline: "Senior Cloud Architect",
    time: "vor 1 Std.",
    text: "Danke fuer das Update, Markus! Die Ergebnisse der Lasttests sehen vielversprechend aus. Allerdings muessen wir noch die Datenbank-Replikation zwischen den Regionen testen, bevor wir die naechste Phase starten koennen. Gibt es schon einen Zeitplan dafuer?",
  },
  {
    id: 3,
    author: "Thomas Weber",
    avatar: "TW",
    headline: "DevOps Lead",
    time: "vor 45 Min.",
    text: "Die CI/CD-Pipeline fuer die neuen Services steht. Wir haben auch das Monitoring mit Grafana eingerichtet. Ein Problem: Die Kosten fuer die Staging-Umgebung sind hoeher als budgetiert. Wir sollten ueber Reserved Instances nachdenken.",
  },
  {
    id: 4,
    author: "Lisa Hoffmann",
    avatar: "LH",
    headline: "Projektmanagerin - Digital Transformation",
    time: "vor 30 Min.",
    text: "Wichtiger Punkt zu den Kosten, Thomas. Das Steering Committee erwartet naechste Woche einen Fortschrittsbericht. Koennen wir bis Freitag eine Zusammenfassung der bisherigen Ergebnisse und einen ueberarbeiteten Kostenplan liefern? @Markus, koenntest du den technischen Teil uebernehmen?",
  },
];

const contacts = [
  { name: "Cloud-Migration Team", active: true, unread: 0 },
  { name: "Anna Richter", active: false, unread: 2 },
  { name: "DevOps Standup", active: false, unread: 0 },
  { name: "HR Onboarding", active: false, unread: 1 },
];

export default function MessagingThread() {
  const mode =
    new URLSearchParams(window.location.search).get("mode") || "default";

  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (draft.trim().length > 0) {
      (window as any).messagingResult = {
        composed: true,
        sent,
        message: draft.trim(),
        messageLength: draft.trim().length,
        timestamp: new Date().toISOString(),
      };
    }
  }, [draft, sent]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    setSent(true);
    (window as any).messagingResult = {
      composed: true,
      sent: true,
      message: text,
      messageLength: text.length,
      timestamp: new Date().toISOString(),
    };
  };

  return mode === "dom-mismatch" ? (
    <MessagingThreadDomMismatch />
  ) : (
    <MessagingThreadNormal
      draft={draft}
      sent={sent}
      setDraft={setDraft}
      handleSend={handleSend}
    />
  );
}

function MessagingThreadNormal({
  draft,
  setDraft,
  handleSend,
}: {
  draft: string;
  sent: boolean;
  setDraft: (value: string) => void;
  handleSend: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 48px)",
        background: "#fff",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ThreadHeader />
        <ThreadMessages />
        <ReplyBox
          draft={draft}
          setDraft={setDraft}
          handleSend={handleSend}
        />
      </div>
    </div>
  );
}

function MessagingThreadDomMismatch() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const threadMarkup = useMemo(() => renderThreadMarkup(), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = threadMarkup;

    return () => {
      host.innerHTML = "";
    };
  }, [threadMarkup]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "280px minmax(0, 1fr) 300px",
        height: "calc(100vh - 48px)",
        background: "#f7f5f2",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <Sidebar />
      <div
        style={{
          position: "relative",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,243,239,0.98))",
          borderRight: "1px solid #e4ded5",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.02))",
            pointerEvents: "none",
          }}
        />
        <div
          ref={hostRef}
          id="mismatch-visual-thread-host"
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: "0",
          }}
        />
      </div>
      <PromoRail />
    </div>
  );
}

function Sidebar() {
  return (
    <div
      style={{
        width: 280,
        borderRight: "1px solid #e0e0e0",
        background: "#f3f2ef",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      <div style={{ padding: "16px", borderBottom: "1px solid #e0e0e0" }}>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: "#191919",
          }}
        >
          Nachrichten
        </h2>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {contacts.map((c) => (
          <div
            key={c.name}
            style={{
              padding: "12px 16px",
              background: c.active ? "#fff" : "transparent",
              borderLeft: c.active
                ? "3px solid #0a66c2"
                : "3px solid transparent",
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 14,
                color: "#191919",
                fontWeight: c.active ? 600 : 400,
              }}
            >
              {c.name}
            </span>
            {c.unread > 0 && (
              <span
                style={{
                  background: "#0a66c2",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "1px 7px",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {c.unread}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThreadHeader() {
  return (
    <div
      style={{
        padding: "14px 20px",
        borderBottom: "1px solid #e0e0e0",
        flexShrink: 0,
      }}
    >
      <h3
        style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#191919" }}
      >
        Cloud-Migration Team
      </h3>
      <span style={{ fontSize: 13, color: "#666" }}>4 Teilnehmer</span>
    </div>
  );
}

function ThreadMessages() {
  return (
    <div
      id="thread-messages"
      style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}
    >
      {thread.map((msg) => (
        <div key={msg.id} style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              flexShrink: 0,
              background:
                msg.avatar === "MB"
                  ? "#0a66c2"
                  : msg.avatar === "SK"
                    ? "#7c3aed"
                    : msg.avatar === "TW"
                      ? "#059669"
                      : "#d97706",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {msg.avatar}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                marginBottom: 2,
              }}
            >
              <span
                style={{ fontWeight: 600, fontSize: 14, color: "#191919" }}
              >
                {msg.author}
              </span>
              <span style={{ fontSize: 12, color: "#666" }}>{msg.headline}</span>
              <span
                style={{
                  fontSize: 12,
                  color: "#999",
                  marginLeft: "auto",
                  flexShrink: 0,
                }}
              >
                {msg.time}
              </span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.6,
                color: "#333",
              }}
            >
              {msg.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReplyBox({
  draft,
  setDraft,
  handleSend,
}: {
  draft: string;
  setDraft: (value: string) => void;
  handleSend: () => void;
}) {
  return (
    <div style={{ padding: "0 20px 16px", flexShrink: 0 }}>
      <div style={{ border: "1px solid #c0c0c0", borderRadius: 8, background: "#fff" }}>
        <textarea
          id="reply-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Schreiben Sie eine Nachricht..."
          rows={4}
          style={{
            width: "100%",
            minHeight: 80,
            maxHeight: 200,
            padding: "12px 14px",
            fontSize: 14,
            lineHeight: 1.6,
            color: "#333",
            border: "none",
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "6px 10px 10px",
            gap: 8,
            borderTop: "1px solid #f0f0f0",
          }}
        >
          <button
            id="reply-send-btn"
            onClick={handleSend}
            style={{
              background: "#0a66c2",
              color: "#fff",
              border: "none",
              borderRadius: 20,
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Senden
          </button>
        </div>
      </div>
    </div>
  );
}

function PromoRail() {
  return (
    <aside
      style={{
        background: "#fcfaf7",
        padding: "18px 16px",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          border: "1px solid #ddd7cf",
          borderRadius: 18,
          background: "#fff",
          padding: 16,
          boxShadow: "0 10px 30px rgba(25, 25, 25, 0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", color: "#8b8278" }}>
              Sponsored
            </div>
            <h4 style={{ margin: "8px 0 0", fontSize: 19, lineHeight: 1.15, color: "#1f1b18" }}>
              Qorvo Connectivity
            </h4>
          </div>
          <button
            data-testid="promoted-badge__button"
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "1px solid #d8d0c6",
              background: "#fff7ef",
              cursor: "pointer",
            }}
          >
            •••
          </button>
        </div>

        <div
          style={{
            height: 140,
            marginTop: 16,
            borderRadius: 16,
            background:
              "linear-gradient(135deg, rgba(244,168,77,0.22), rgba(82,118,255,0.12))",
            border: "1px solid rgba(214,202,187,0.8)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 20,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 22,
              fontWeight: 700,
              color: "#2c2521",
            }}
          >
            QC
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: "#4b433d" }}>
          Improve edge performance with compact RF modules for connected devices.
        </div>

        <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
          <a
            data-testid="follow-company-container__company-image"
            href="#promo-company"
            title="Qorvo Connectivity"
            onClick={(event) => event.preventDefault()}
            style={{
              display: "block",
              width: 70,
              height: 70,
              borderRadius: 18,
              background:
                "linear-gradient(180deg, rgba(252,204,132,0.45), rgba(255,255,255,1))",
              border: "1px solid #d8d0c6",
            }}
          />
          <a
            data-testid="follow-company-container__company-name"
            href="#promo-company"
            title="Qorvo Connectivity"
            onClick={(event) => event.preventDefault()}
            style={{
              color: "#1f1b18",
              fontSize: 18,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Qorvo Connectivity
          </a>
          <a
            data-testid="follow-company-container__button"
            href="#promo-follow"
            title="Follow"
            onClick={(event) => event.preventDefault()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 120,
              padding: "10px 18px",
              borderRadius: 999,
              border: "1px solid #cfc5b8",
              color: "#6a3d06",
              textDecoration: "none",
              fontWeight: 700,
              background: "#fff7ef",
            }}
          >
            Follow
          </a>
        </div>
      </div>
    </aside>
  );
}

function renderThreadMarkup(): string {
  const messagesHtml = thread
    .map(
      (msg) => `
        <div class="msg-row">
          <div class="avatar avatar-${msg.avatar.toLowerCase()}">${msg.avatar}</div>
          <div class="msg-content">
            <div class="msg-meta">
              <span class="author">${escapeHtml(msg.author)}</span>
              <span class="headline">${escapeHtml(msg.headline)}</span>
              <span class="time">${escapeHtml(msg.time)}</span>
            </div>
            <p>${escapeHtml(msg.text)}</p>
          </div>
        </div>
      `,
    )
    .join("");

  return `
    <style>
      * { box-sizing: border-box; }
      .shell {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, #ffffff, #f7f4ef);
        color: #1e1a17;
      }
      .header {
        padding: 16px 22px;
        border-bottom: 1px solid #e6ded4;
        background: rgba(255, 255, 255, 0.94);
      }
      .header h3 {
        margin: 0;
        font: 600 17px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .header span {
        display: block;
        margin-top: 4px;
        font: 13px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #776d63;
      }
      .body {
        flex: 1;
        overflow: auto;
        padding: 18px 22px 0;
      }
      .msg-row {
        display: flex;
        gap: 12px;
        margin-bottom: 18px;
      }
      .avatar {
        width: 42px;
        height: 42px;
        border-radius: 999px;
        color: #fff;
        display: grid;
        place-items: center;
        font: 700 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        flex-shrink: 0;
      }
      .avatar-mb { background: #0a66c2; }
      .avatar-sk { background: #7c3aed; }
      .avatar-tw { background: #059669; }
      .avatar-lh { background: #d97706; }
      .msg-content { min-width: 0; }
      .msg-meta {
        display: flex;
        gap: 8px;
        align-items: baseline;
        flex-wrap: wrap;
      }
      .author {
        font: 600 14px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .headline, .time {
        font: 12px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #786f66;
      }
      .time { margin-left: auto; }
      p {
        margin: 4px 0 0;
        font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #342f2a;
      }
      .composer-wrap {
        padding: 16px 22px 20px;
        background: linear-gradient(180deg, rgba(255,255,255,0), rgba(255,255,255,0.95) 20%);
      }
      .composer {
        border: 1px solid #d3cbc1;
        border-radius: 16px;
        background: #fff;
        overflow: hidden;
        box-shadow: 0 12px 30px rgba(30, 26, 23, 0.06);
      }
      .composer textarea {
        width: 100%;
        min-height: 108px;
        border: 0;
        outline: 0;
        resize: none;
        padding: 14px 16px;
        font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #2b2521;
      }
      .composer-bar {
        display: flex;
        justify-content: flex-end;
        padding: 10px 12px 12px;
        border-top: 1px solid #f0ebe4;
      }
      .send-pill {
        padding: 8px 18px;
        border-radius: 999px;
        background: #0a66c2;
        color: #fff;
        font: 600 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
    </style>
    <div class="shell">
      <div class="header">
        <h3>Cloud-Migration Team</h3>
        <span>4 Teilnehmer</span>
      </div>
      <div class="body">
        ${messagesHtml}
      </div>
      <div class="composer-wrap">
        <div class="composer">
          <textarea placeholder="Schreiben Sie eine Nachricht..."></textarea>
          <div class="composer-bar">
            <div class="send-pill">Senden</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
