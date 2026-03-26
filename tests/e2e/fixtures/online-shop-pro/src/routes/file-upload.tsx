import { useState, useRef } from "react";

export default function FileUpload() {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setFileSize(file.size);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }

    setSubmitted(true);
    (window as any).uploadResult = {
      subject: subject.trim(),
      description: description.trim(),
      priority,
      fileName: fileName || null,
      fileSize,
    };
  };

  if (submitted) {
    return (
      <div className="fixture-static" style={{ minHeight: "100vh" }}>
        <div className="header">
          <h1>Support Ticket</h1>
        </div>
        <div
          className="container"
          style={{ maxWidth: 600, margin: "32px auto", padding: "0 24px" }}
        >
          <div
            className="card"
            id="ticket-confirmation"
            style={{ padding: 32, textAlign: "center" }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "#dcfce7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: 24,
                color: "#16a34a",
                fontWeight: 700,
              }}
            >
              ok
            </div>
            <h2 style={{ marginBottom: 8 }}>Ticket Submitted!</h2>
            <p style={{ color: "#64748b", marginBottom: 20 }}>
              Your support ticket has been created successfully.
            </p>
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 8,
                padding: 16,
                textAlign: "left",
                fontSize: 14,
              }}
            >
              <p>
                <strong>Subject:</strong> {subject}
              </p>
              <p style={{ marginTop: 8 }}>
                <strong>Description:</strong> {description}
              </p>
              <p style={{ marginTop: 8 }}>
                <strong>Priority:</strong> {priority}
              </p>
              {fileName && (
                <p style={{ marginTop: 8 }}>
                  <strong>Attachment:</strong> {fileName} ({fileSize} bytes)
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Submit a Support Ticket</h1>
        <p>Fill out the form below to create a new support ticket.</p>
      </div>

      <div
        className="container"
        style={{ maxWidth: 600, margin: "32px auto", padding: "0 24px" }}
      >
        <div className="card" style={{ padding: 24 }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="ticket-subject"
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Subject
              </label>
              <input
                id="ticket-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief description of the issue"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="ticket-description"
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Description
              </label>
              <textarea
                id="ticket-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detailed description of the problem..."
                rows={4}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="ticket-priority"
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Priority
              </label>
              <select
                id="ticket-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                }}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label
                htmlFor="ticket-file"
                style={{
                  display: "block",
                  marginBottom: 6,
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Attachment (optional)
              </label>
              <input
                id="ticket-file"
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                style={{
                  width: "100%",
                  padding: "8px",
                  fontSize: 14,
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  background: "#f8fafc",
                }}
              />
              {fileName && (
                <p style={{ marginTop: 6, fontSize: 13, color: "#64748b" }}>
                  Selected: {fileName} ({fileSize} bytes)
                </p>
              )}
            </div>

            {error && (
              <p
                id="ticket-error"
                style={{
                  color: "#dc2626",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 14,
                  marginBottom: 16,
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{
                width: "100%",
                padding: "12px 20px",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Submit Ticket
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
