import { useState, useRef, useEffect } from "react";

interface Message {
  id: number;
  author: string;
  avatar: string;
  role: string;
  time: string;
  text: string;
}

const initialMessages: Message[] = [
  {
    id: 1,
    author: "Alice Park",
    avatar: "AP",
    role: "Product Manager",
    time: "9:02 AM",
    text: "Hey team, quick sync on the v2.0 release. Where are we on the remaining items?",
  },
  {
    id: 2,
    author: "Bob Chen",
    avatar: "BC",
    role: "Backend Engineer",
    time: "9:05 AM",
    text: "API endpoints are done. Auth middleware migration passes all integration tests now. Performance benchmarks look solid too — p99 latency is under 120ms.",
  },
  {
    id: 3,
    author: "Carol Davis",
    avatar: "CD",
    role: "Frontend Engineer",
    time: "9:08 AM",
    text: "Dashboard redesign is merged and deployed to staging. Still working on the onboarding flow — the new multi-step wizard has a couple of edge cases with the progress indicator. Should be done by Wednesday.",
  },
  {
    id: 4,
    author: "Dave Kim",
    avatar: "DK",
    role: "DevOps",
    time: "9:12 AM",
    text: "CI/CD pipeline is ready for the release branch. Blue-green deployment config tested on staging. Just waiting for the green light to cut the branch.",
  },
  {
    id: 5,
    author: "Elena Torres",
    avatar: "ET",
    role: "Designer",
    time: "9:15 AM",
    text: "All design assets for v2.0 are finalized and handed off. I also updated the style guide with the new component variants. Let me know if anything needs tweaking.",
  },
  {
    id: 6,
    author: "Frank Wu",
    avatar: "FW",
    role: "Backend Engineer",
    time: "9:18 AM",
    text: "Database migrations are tested and ready. I wrote a rollback script just in case. Also updated the seed data for the new user roles feature.",
  },
  {
    id: 7,
    author: "Grace Lee",
    avatar: "GL",
    role: "Technical Writer",
    time: "9:22 AM",
    text: "API docs are updated for all the new endpoints. I still need the changelog content to finish the release notes page. Who's handling that?",
  },
  {
    id: 8,
    author: "Bob Chen",
    avatar: "BC",
    role: "Backend Engineer",
    time: "9:25 AM",
    text: "Good question @Grace. The changelog usually falls on whoever owns the release. @Alice, are we following the same process as last time?",
  },
  {
    id: 9,
    author: "Alice Park",
    avatar: "AP",
    role: "Product Manager",
    time: "9:28 AM",
    text: "Yes, same process. Release owner writes the changelog draft, then Grace polishes it for the docs site. We should have it ready the day before release at the latest.",
  },
  {
    id: 10,
    author: "Sarah Martinez",
    avatar: "SM",
    role: "QA Lead",
    time: "9:34 AM",
    text: "Quick update from QA: regression testing on the core flows is complete. Found 2 minor issues (both P3, logged in Jira). Nothing blocking. We're good to go from the QA side. So — when exactly are we targeting the release? And who's writing the changelog this time around?",
  },
];

const channels = [
  { name: "general", unread: 3 },
  { name: "project-updates", unread: 0, active: true },
  { name: "random", unread: 0 },
  { name: "design-reviews", unread: 1 },
  { name: "deployments", unread: 0 },
];

export default function TeamChat() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;

    const newMsg: Message = {
      id: messages.length + 1,
      author: "You",
      avatar: "ME",
      role: "Engineering Lead",
      time: new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
      text,
    };
    setMessages((prev) => [...prev, newMsg]);
    setDraft("");

    // Export for e2e test detection
    (window as any).chatResult = {
      sent: true,
      message: text,
      sentAt: new Date().toISOString(),
      messageCount: messages.length + 1,
    };
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", background: "#1a1d21", color: "#d1d2d3", fontFamily: "'Lato', -apple-system, sans-serif" }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: "#19171d", borderRight: "1px solid #35363a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #35363a" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>Acme Corp</h2>
          <span style={{ fontSize: 12, color: "#9ea0a5" }}>Engineering Team</span>
        </div>
        <div style={{ padding: "12px 0" }}>
          <div style={{ padding: "0 12px 8px", fontSize: 12, fontWeight: 600, color: "#9ea0a5", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
            Channels
          </div>
          {channels.map((ch) => (
            <div
              key={ch.name}
              style={{
                padding: "4px 16px",
                fontSize: 14,
                cursor: "pointer",
                background: ch.active ? "#1164a3" : "transparent",
                color: ch.active ? "#fff" : ch.unread ? "#fff" : "#9ea0a5",
                fontWeight: ch.unread || ch.active ? 700 : 400,
                borderRadius: 4,
                margin: "0 8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span># {ch.name}</span>
              {ch.unread > 0 && (
                <span style={{ background: "#e01e5a", color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 700 }}>
                  {ch.unread}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Channel header */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid #35363a", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}># project-updates</h3>
          <span style={{ fontSize: 13, color: "#9ea0a5" }}>Release planning and coordination</span>
        </div>

        {/* Messages */}
        <div
          id="chat-messages"
          style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}
        >
          {/* Date separator */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 16px", color: "#9ea0a5", fontSize: 12, fontWeight: 600 }}>
            <div style={{ flex: 1, height: 1, background: "#35363a" }} />
            <span>Today</span>
            <div style={{ flex: 1, height: 1, background: "#35363a" }} />
          </div>

          {messages.map((msg) => (
            <div key={msg.id} style={{ display: "flex", gap: 10, marginBottom: 16, padding: "4px 0" }}>
              <div style={{
                width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                background: msg.author === "You" ? "#2eb67d" : msg.avatar === "SM" ? "#e01e5a" : msg.avatar === "AP" ? "#ecb22e" : "#36c5f0",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: "#fff",
              }}>
                {msg.avatar}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{msg.author}</span>
                  <span style={{ fontSize: 11, color: "#9ea0a5" }}>{msg.role}</span>
                  <span style={{ fontSize: 11, color: "#616061" }}>{msg.time}</span>
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5, color: "#d1d2d3", marginTop: 2 }}>
                  {msg.text}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{ padding: "0 20px 16px", flexShrink: 0 }}>
          <div style={{
            border: "1px solid #565856",
            borderRadius: 8,
            background: "#222529",
            overflow: "hidden",
          }}>
            <textarea
              ref={inputRef}
              id="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message #project-updates"
              rows={3}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#d1d2d3",
                padding: "12px 14px",
                fontSize: 14,
                lineHeight: 1.5,
                resize: "none",
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px 8px", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#616061" }}>Enter to send, Shift+Enter for new line</span>
              <button
                id="chat-send-btn"
                onClick={handleSend}
                disabled={!draft.trim()}
                style={{
                  background: draft.trim() ? "#007a5a" : "#4a4a4a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: draft.trim() ? "pointer" : "default",
                  opacity: draft.trim() ? 1 : 0.5,
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
