import { useState, useEffect } from "react";

/**
 * Gmail-like email client fixture.
 * Shows an inbox with one open email and a reply composer (contenteditable).
 * Exposes window.emailResult when reply is composed or sent.
 */

interface Email {
  id: number;
  from: string;
  subject: string;
  preview: string;
  time: string;
  unread: boolean;
}

const inbox: Email[] = [
  { id: 1, from: "David Park", subject: "Q3 Strategy Meeting — Scheduling", preview: "Hi team, I'd like to schedule our Q3 strategy review...", time: "10:15 AM", unread: true },
  { id: 2, from: "HR Department", subject: "Benefits Enrollment Reminder", preview: "Open enrollment closes Friday. Please review...", time: "9:42 AM", unread: false },
  { id: 3, from: "Jira Notifications", subject: "[PROJ-847] Bug: Login timeout", preview: "Status changed to In Progress by Alex Kim...", time: "Yesterday", unread: false },
  { id: 4, from: "newsletter@techdigest.io", subject: "This Week in AI: June 2026", preview: "Top stories: GPT-5.4 benchmarks, new...", time: "Yesterday", unread: false },
];

const openEmail = {
  from: "David Park",
  fromEmail: "david.park@company.com",
  to: "team@company.com",
  subject: "Q3 Strategy Meeting — Scheduling",
  date: "June 6, 2026 at 10:15 AM",
  body: [
    "Hi team,",
    "",
    "I'd like to schedule our Q3 strategy review meeting for next week. We need to cover three main topics:",
    "",
    "1. Product roadmap updates — the board wants to see our progress on the AI integration initiative",
    "2. Budget reallocation — we're $45K over on cloud infrastructure, need to discuss optimization or reallocation from other line items",
    "3. Hiring pipeline — we have 3 open senior engineering positions and 12 candidates in final rounds",
    "",
    "I'm thinking Thursday at 2 PM or Friday at 10 AM. The meeting should be 90 minutes to cover everything properly.",
    "",
    "Can everyone confirm their availability? If neither time works, please suggest alternatives before Wednesday EOD.",
    "",
    "Thanks,",
    "David",
    "",
    "David Park",
    "VP of Engineering",
    "Ext. 4421",
  ].join("\n"),
};

const folders = [
  { name: "Inbox", count: 4, active: true },
  { name: "Starred", count: 0, active: false },
  { name: "Sent", count: 0, active: false },
  { name: "Drafts", count: 1, active: false },
  { name: "Archive", count: 0, active: false },
];

export default function EmailCompose() {
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const [sentMessage, setSentMessage] = useState("");
  const [showReplyBox, setShowReplyBox] = useState(true);

  useEffect(() => {
    if (draft.trim().length > 0) {
      (window as any).emailResult = {
        composed: true,
        sent,
        message: draft.trim(),
        messageLength: draft.trim().length,
        subject: openEmail.subject,
        to: openEmail.fromEmail,
        timestamp: new Date().toISOString(),
      };
    }
  }, [draft, sent]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    setSentMessage(text);
    setSent(true);
    setShowReplyBox(false);
    setDraft("");
    (window as any).emailResult = {
      composed: true,
      sent: true,
      message: text,
      messageLength: text.length,
      subject: openEmail.subject,
      to: openEmail.fromEmail,
      timestamp: new Date().toISOString(),
    };
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", background: "#fff", fontFamily: "'Google Sans', Roboto, -apple-system, sans-serif" }}>
      {/* Sidebar */}
      <div style={{ width: 200, background: "#f6f8fc", borderRight: "1px solid #e0e0e0", display: "flex", flexDirection: "column", flexShrink: 0, paddingTop: 8 }}>
        <button style={{ margin: "8px 16px 16px", padding: "10px 24px", background: "#c2e7ff", border: "none", borderRadius: 16, fontSize: 14, fontWeight: 500, cursor: "pointer", color: "#001d35", textAlign: "left" }}>
          + Compose
        </button>
        {folders.map((f) => (
          (() => {
            const isSentFolder = f.name === "Sent";
            const isDraftsFolder = f.name === "Drafts";
            const isActive = sent ? isSentFolder : f.active;
            const count = sent && isSentFolder ? 1 : sent && isDraftsFolder ? 0 : f.count;
            return (
          <div
            key={f.name}
            style={{
              padding: "8px 24px",
              fontSize: 14,
              fontWeight: isActive ? 700 : 400,
              background: isActive ? "#d3e3fd" : "transparent",
              borderRadius: "0 16px 16px 0",
              marginRight: 12,
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              color: isActive ? "#001d35" : "#444746",
            }}
          >
            <span>{f.name}</span>
            {count > 0 && <span style={{ fontWeight: 700 }}>{count}</span>}
          </div>
            );
          })()
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Email header */}
        {!sent && (
        <div style={{ padding: "20px 24px 12px", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 400, color: "#1f1f1f" }}>{openEmail.subject}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#1a73e8", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 16, fontWeight: 500 }}>
              DP
            </div>
            <div>
              <div style={{ fontSize: 14 }}>
                <strong>{openEmail.from}</strong>{" "}
                <span style={{ color: "#5f6368" }}>&lt;{openEmail.fromEmail}&gt;</span>
              </div>
              <div style={{ fontSize: 12, color: "#5f6368" }}>
                to {openEmail.to} — {openEmail.date}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Email body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {sent ? (
            <div id="sent-mail-view" style={{ maxWidth: 760 }}>
              <div
                id="send-confirmation"
                role="status"
                style={{
                  marginBottom: 16,
                  padding: "10px 14px",
                  background: "#e6f4ea",
                  border: "1px solid #b7dfc1",
                  borderRadius: 6,
                  color: "#137333",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Message sent to {openEmail.from} &lt;{openEmail.fromEmail}&gt;
              </div>
              <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 400, color: "#1f1f1f" }}>Sent</h2>
              <div
                id="sent-message"
                style={{
                  border: "1px solid #dadce0",
                  borderRadius: 8,
                  background: "#fff",
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 14, color: "#202124", fontWeight: 600 }}>{openEmail.subject}</div>
                    <div style={{ fontSize: 12, color: "#5f6368", marginTop: 4 }}>
                      To: {openEmail.from} &lt;{openEmail.fromEmail}&gt;
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#5f6368", whiteSpace: "nowrap" }}>Sent just now</div>
                </div>
                <div style={{ padding: "14px 16px", fontSize: 14, lineHeight: 1.7, color: "#222", whiteSpace: "pre-wrap" }}>
                  {sentMessage}
                </div>
              </div>
            </div>
          ) : (
          <>
          <div id="email-body" style={{ fontSize: 14, lineHeight: 1.7, color: "#222", whiteSpace: "pre-wrap", maxWidth: 680 }}>
            {openEmail.body}
          </div>

          {/* Reply box */}
          {showReplyBox && (
            <div style={{ marginTop: 24, border: "1px solid #dadce0", borderRadius: 8, maxWidth: 680 }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 12, color: "#5f6368" }}>
                Reply to {openEmail.from} &lt;{openEmail.fromEmail}&gt;
              </div>
              <textarea
                id="reply-editor"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your reply..."
                rows={5}
                style={{
                  width: "100%",
                  minHeight: 100,
                  maxHeight: 300,
                  padding: "12px 14px",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "#222",
                  border: "none",
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderTop: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ padding: "4px 8px", background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#5f6368" }} title="Bold">B</button>
                  <button style={{ padding: "4px 8px", background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#5f6368", fontStyle: "italic" }} title="Italic">I</button>
                  <button style={{ padding: "4px 8px", background: "none", border: "none", fontSize: 16, cursor: "pointer", color: "#5f6368", textDecoration: "underline" }} title="Underline">U</button>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    id="discard-btn"
                    onClick={() => setDraft("")}
                    style={{ padding: "8px 16px", background: "none", border: "1px solid #dadce0", borderRadius: 4, fontSize: 14, cursor: "pointer", color: "#5f6368" }}
                  >
                    Discard
                  </button>
                  <button
                    id="send-btn"
                    onClick={handleSend}
                    style={{ padding: "8px 24px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 4, fontSize: 14, fontWeight: 500, cursor: "pointer" }}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
