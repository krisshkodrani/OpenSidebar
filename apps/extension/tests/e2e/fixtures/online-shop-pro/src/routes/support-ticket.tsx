import { useState, useEffect } from "react";

/**
 * Zendesk/Jira-style support ticket fixture.
 * Ticket view with status dropdown, priority selector, and internal comment box.
 * Exposes window.ticketResult when status changes or comment is added.
 */

const ticket = {
  id: "TICKET-4271",
  subject: "Cannot export CSV reports — timeout after 30 seconds",
  requester: "Maria Garcia (maria.garcia@clientcorp.com)",
  assignee: "Unassigned",
  created: "June 5, 2026 at 3:42 PM",
  priority: "High",
  status: "Open",
  type: "Bug",
  tags: ["export", "timeout", "reports", "enterprise"],
  description: [
    "When I try to export the monthly sales report as CSV from the Reports dashboard, the export starts but then fails with a \"Request Timeout\" error after about 30 seconds.",
    "",
    "Steps to reproduce:",
    "1. Go to Reports > Monthly Sales",
    "2. Select date range: May 1-31, 2026",
    "3. Click \"Export as CSV\"",
    "4. Loading spinner appears for ~30 seconds",
    "5. Error message: \"Export failed: Request timed out. Please try again.\"",
    "",
    "This affects our end-of-month reporting workflow. We need to export data for 3 different reports by Friday.",
    "",
    "Browser: Chrome 126, OS: Windows 11",
    "Account: Enterprise Plan, Org ID: CLT-9402",
  ].join("\n"),
  history: [
    { time: "June 5, 3:42 PM", actor: "Maria Garcia", action: "created this ticket" },
    { time: "June 5, 3:43 PM", actor: "System", action: "auto-assigned priority: High (SLA: 4h response)" },
    { time: "June 5, 4:15 PM", actor: "Triage Bot", action: "tagged: export, timeout, reports" },
  ],
};

const statusOptions = ["Open", "In Progress", "Waiting on Customer", "Resolved", "Closed"];
const priorityOptions = ["Low", "Medium", "High", "Urgent"];

export default function SupportTicket() {
  const [status, setStatus] = useState(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<Array<{ text: string; time: string; author: string; internal: boolean }>>([]);
  const [isInternal, setIsInternal] = useState(true);

  // Expose result for e2e
  useEffect(() => {
    (window as any).ticketResult = {
      statusChanged: status !== ticket.status,
      currentStatus: status,
      priorityChanged: priority !== ticket.priority,
      currentPriority: priority,
      commentsAdded: comments.length,
      lastComment: comments.length > 0 ? comments[comments.length - 1].text : null,
      lastCommentInternal: comments.length > 0 ? comments[comments.length - 1].internal : null,
    };
  }, [status, priority, comments]);

  const handleAddComment = () => {
    const text = comment.trim();
    if (!text) return;
    setComments((prev) => [
      ...prev,
      { text, time: new Date().toLocaleTimeString(), author: "You (Support Agent)", internal: isInternal },
    ]);
    setComment("");
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", background: "#f5f7f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* Main ticket area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflowY: "auto" }}>
        {/* Ticket header */}
        <div style={{ padding: "20px 24px", background: "#fff", borderBottom: "1px solid #dde1e5", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: "#68737d", fontWeight: 600 }}>{ticket.id}</span>
            <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, background: priority === "Urgent" ? "#fde8e8" : priority === "High" ? "#fff3cd" : "#e8f5e9", color: priority === "Urgent" ? "#c62828" : priority === "High" ? "#856404" : "#2e7d32" }}>
              {priority}
            </span>
            <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, background: status === "Open" ? "#e3f2fd" : status === "In Progress" ? "#fff8e1" : status === "Resolved" ? "#e8f5e9" : "#f5f5f5", color: status === "Open" ? "#1565c0" : status === "In Progress" ? "#f57f17" : status === "Resolved" ? "#2e7d32" : "#616161" }}>
              {status}
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#2f3941" }}>{ticket.subject}</h2>
          <div style={{ fontSize: 13, color: "#68737d", marginTop: 4 }}>
            Requested by <strong>{ticket.requester}</strong> — {ticket.created}
          </div>
        </div>

        {/* Ticket body */}
        <div style={{ padding: "20px 24px" }}>
          {/* Description */}
          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #dde1e5", padding: "16px 20px", marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "#2f3941" }}>Description</h3>
            <div id="ticket-description" style={{ fontSize: 14, lineHeight: 1.7, color: "#2f3941", whiteSpace: "pre-wrap" }}>
              {ticket.description}
            </div>
          </div>

          {/* Activity / history */}
          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #dde1e5", padding: "16px 20px", marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#2f3941" }}>Activity</h3>
            {ticket.history.map((h, i) => (
              <div key={i} style={{ fontSize: 13, color: "#68737d", padding: "6px 0", borderBottom: i < ticket.history.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                <span style={{ color: "#2f3941", fontWeight: 500 }}>{h.actor}</span> {h.action}
                <span style={{ marginLeft: 8, fontSize: 12, color: "#98a0a8" }}>{h.time}</span>
              </div>
            ))}
            {comments.map((c, i) => (
              <div key={`comment-${i}`} style={{ fontSize: 13, padding: "8px 0", borderTop: "1px solid #f0f0f0", marginTop: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "#2f3941", fontWeight: 500 }}>{c.author}</span>
                  {c.internal && <span style={{ fontSize: 11, padding: "1px 6px", background: "#fff3cd", color: "#856404", borderRadius: 3, fontWeight: 600 }}>Internal</span>}
                  <span style={{ fontSize: 12, color: "#98a0a8", marginLeft: "auto" }}>{c.time}</span>
                </div>
                <p style={{ margin: "4px 0 0", color: "#2f3941", lineHeight: 1.5 }}>{c.text}</p>
              </div>
            ))}
          </div>

          {/* Add comment */}
          <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #dde1e5", padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2f3941" }}>Add Comment</h3>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#68737d", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                  style={{ accentColor: "#f5a623" }}
                />
                Internal note
              </label>
            </div>
            <textarea
              id="comment-input"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add an internal note or reply to the customer..."
              rows={4}
              style={{ width: "100%", padding: "10px 12px", fontSize: 14, lineHeight: 1.5, border: "1px solid #dde1e5", borderRadius: 4, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button
                id="add-comment-btn"
                onClick={handleAddComment}
                disabled={!comment.trim()}
                style={{ padding: "8px 20px", background: comment.trim() ? "#1f73b7" : "#ccc", color: "#fff", border: "none", borderRadius: 4, fontSize: 14, fontWeight: 500, cursor: comment.trim() ? "pointer" : "default" }}
              >
                {isInternal ? "Add Internal Note" : "Reply"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar — ticket properties */}
      <div style={{ width: 280, background: "#fff", borderLeft: "1px solid #dde1e5", padding: "20px", flexShrink: 0, overflowY: "auto" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600, color: "#2f3941" }}>Properties</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#68737d", marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Status</label>
          <select
            id="status-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", fontSize: 14, border: "1px solid #dde1e5", borderRadius: 4, background: "#fff", color: "#2f3941", outline: "none" }}
          >
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#68737d", marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Priority</label>
          <select
            id="priority-select"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", fontSize: 14, border: "1px solid #dde1e5", borderRadius: 4, background: "#fff", color: "#2f3941", outline: "none" }}
          >
            {priorityOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#68737d", marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Type</label>
          <span style={{ fontSize: 14, color: "#2f3941" }}>{ticket.type}</span>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#68737d", marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Assignee</label>
          <span style={{ fontSize: 14, color: "#2f3941" }}>{ticket.assignee}</span>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#68737d", marginBottom: 4, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Tags</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {ticket.tags.map((t) => (
              <span key={t} style={{ padding: "2px 8px", background: "#eaf0f6", borderRadius: 3, fontSize: 12, color: "#49545c" }}>{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
